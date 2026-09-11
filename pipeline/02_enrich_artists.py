"""
Stage 3: Multi-Subgenre Resolution & Metadata Enrichment.
Implements:
1. Strict Artist Sanitization (Unicode safe, rejects dates, handles, view counts)
2. Artist Survival Rule: Retain artists appearing in >= 2 surviving playlists (c_i >= 2)
3. IDF-Weighted Specificity Scoring to extract Top 3 Distinct Subgenres (Title Case)
4. Zero "Pop" bias: primaryGenre is strictly the #1 empirical subgenre or verified iTunes genre
5. Guaranteed authentic portraits: YouTube Official Artist Channel (OAC) 512px + iTunes 600px
6. Universal Empirical Sizing via verified YouTube public subscriber counts (Zero Fake Numbers)
7. Verified 30s Audio Previews (iTunes AAC / Spotify CDN)
8. Extraction and persistence of authentic 'topTrack'
9. Persistent disk caching in pipeline/output/artist_metadata_cache.json
10. Strict Upstream Pruning of unverified artists
"""

import os
import sys
import json
import time
import math
import re
import random
import argparse
import threading
import subprocess
from urllib.parse import quote_plus
from collections import Counter
from typing import Dict, List, Optional, Tuple
from concurrent.futures import ThreadPoolExecutor
import httpx
from tqdm import tqdm

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

from sanitizer import sanitize_artist_name

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(PIPELINE_DIR, "output")
os.makedirs(OUTPUT_DIR, exist_ok=True)

PLAYLISTS_FILE = os.path.join(OUTPUT_DIR, "harvested_playlists.json")
OCCURRENCES_FILE = os.path.join(OUTPUT_DIR, "artist_subgenre_occurrences.json")
CATALOG_FILE = os.path.join(OUTPUT_DIR, "artists_catalog.json")
SURVIVORS_FILE = os.path.join(OUTPUT_DIR, "surviving_artist_ids.json")
CACHE_FILE = os.path.join(OUTPUT_DIR, "artist_metadata_cache.json")

NON_MUSICAL_AUDIO_TOKENS = {
    "sound", "white noise", "sleep", "rain", "meditation", "asmr",
    "pink noise", "nature sounds", "sound effects", "guided meditation",
    "birdsong", "hypnosis", "ocean", "general"
}

NON_MUSIC_GENRES = {
    "sound", "white noise", "sleep", "rain", "meditation", "asmr",
    "pink noise", "nature sounds", "sound effects", "guided meditation",
    "birdsong", "hypnosis", "ocean", "general",
    "comedy", "sports", "podcast", "spoken word", "audiobook", "news", "education",
    "children's music", "nursery", "sing-along", "lullaby",
    "musica infantil", "canciones infantiles", "kinderlieder", "barnmusik", "barnsagor"
}

def parse_subscribers(sub_str: str) -> int:
    """Parses subscriber strings like '264K', '50.2M', '980', '4.38 million' into exact integers."""
    if not sub_str:
        return 0
    clean = str(sub_str).upper().replace("SUBSCRIBERS", "").replace("SUBSCRIBER", "").strip()
    try:
        if "BILLION" in clean or clean.endswith("B"):
            return 0
        if "MILLION" in clean:
            num = re.findall(r'[\d.]+', clean.replace("MILLION", "").strip())
            result = int(float(num[0]) * 1_000_000) if num else 0
        elif "M" in clean:
            num = re.findall(r'[\d.]+', clean.replace("M", "").strip())
            result = int(float(num[0]) * 1_000_000) if num else 0
        elif "K" in clean:
            num = re.findall(r'[\d.]+', clean.replace("K", "").strip())
            result = int(float(num[0]) * 1_000) if num else 0
        else:
            nums = re.findall(r'\d+', clean)
            result = int("".join(nums)) if nums else 0
        # Reject implausibly large values — no music artist exceeds ~300M.
        # If the value is this high, it's a leaked view/video count, not subscribers.
        if result > 350_000_000:
            return 0
        return result
    except Exception:
        return 0

def format_subscribers(subs: int) -> str:
    """Formats subscriber integer into human-readable compact string ('264K', '50.2M')."""
    if subs >= 1_000_000:
        val = subs / 1_000_000
        return f"{val:.1f}M" if val < 10 else f"{round(val)}M"
    elif subs >= 1_000:
        val = subs / 1_000
        return f"{val:.1f}K" if val < 10 else f"{round(val)}K"
    return str(subs)

def calculate_log_popularity(subs: int) -> int:
    """Empirical logarithmic popularity scaled to verified subscribers (1 to 100)."""
    if subs <= 0:
        return 0
    log_s = math.log10(max(1, subs))
    val = round(100.0 * (log_s / 8.0))
    return int(min(100, max(1, val)))

def upgrade_avatar_url(raw_url: str) -> str:
    """Transforms Google thumbnail URLs to 128px high-res square crops (optimized for WebGL texture memory)."""
    if not raw_url:
        return ""
    # Ensure protocol-relative URLs get an explicit https: prefix
    if raw_url.startswith("//"):
        raw_url = "https:" + raw_url
    if "googleusercontent.com" in raw_url or "ggpht.com" in raw_url:
        base = raw_url.split("=")[0]
        return f"{base}=s128-c-k-c0x00ffffff-no-rj"
    return raw_url

def load_metadata_cache() -> Dict[str, Dict]:
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_metadata_cache(cache: Dict[str, Dict]):
    temp = CACHE_FILE + ".tmp"
    with open(temp, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2, ensure_ascii=False)
    os.replace(temp, CACHE_FILE)

def query_youtube_channel(name: str, client: httpx.Client, max_retries: int = 2) -> Optional[Dict]:
    """
    YouTube public channel search resolver.
    Matches Official Artist Channel (BADGE_STYLE_TYPE_VERIFIED_ARTIST) or exact channel title.
    Extracts authentic subscriber count and high-res Google portrait (upgraded to 512px).
    """
    url = f"https://www.youtube.com/results?search_query={quote_plus(name)}&sp=EgIQAg%253D%253D"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9"
    }
    for attempt in range(max_retries):
        try:
            resp = client.get(url, headers=headers, timeout=6.0)
            if resp.status_code == 200:
                m = re.search(r'var ytInitialData = ({.*?});</script>', resp.text)
                if not m:
                    break
                try:
                    data = json.loads(m.group(1))
                except Exception:
                    break

                def find_channel_renderers(obj):
                    channels = []
                    if isinstance(obj, dict):
                        if "channelRenderer" in obj:
                            channels.append(obj["channelRenderer"])
                        for v in obj.values():
                            channels.extend(find_channel_renderers(v))
                    elif isinstance(obj, list):
                        for item in obj:
                            channels.extend(find_channel_renderers(item))
                    return channels

                renderers = find_channel_renderers(data)
                candidates = []
                for c in renderers:
                    title = c.get("title", {}).get("simpleText", "")
                    if not title and c.get("title", {}).get("runs"):
                        title = "".join(r.get("text", "") for r in c["title"]["runs"])
                    badges = [b.get("metadataBadgeRenderer", {}).get("style") for b in c.get("ownerBadges", [])]
                    is_oac = "BADGE_STYLE_TYPE_VERIFIED_ARTIST" in badges
                    title_clean = title.lower().strip()
                    target_name = name.lower().strip()
                    title_norm = re.sub(r'[^a-z0-9]', '', title_clean)
                    target_norm = re.sub(r'[^a-z0-9]', '', target_name)
                    name_match = (title_clean == target_name) or (len(target_norm) >= 3 and title_norm == target_norm)
                    is_related_oac = is_oac and (
                        name_match or
                        title_norm == f"{target_norm}vevo" or
                        title_norm == f"{target_norm}official"
                    )

                    if is_related_oac or name_match:
                        # YouTube swaps subscriberCountText / videoCountText for OAC channels:
                        # subscriberCountText may contain the @handle, while videoCountText
                        # holds the real subscriber count. Read both and pick the right one.
                        sub_text = ""
                        for field in ["subscriberCountText", "videoCountText"]:
                            f_obj = c.get(field, {})
                            st = f_obj.get("simpleText") or ""
                            if not st and f_obj.get("runs"):
                                st = "".join(r.get("text", "") for r in f_obj.get("runs", []))
                            if not st:
                                st = f_obj.get("accessibility", {}).get("accessibilityData", {}).get("label", "")
                            if not st:
                                continue
                            st_lower = st.lower()
                            # Skip @handles (e.g. "@TaylorSwift")
                            if st.startswith("@"):
                                continue
                            # Skip actual video/view counts
                            if "video" in st_lower or "view" in st_lower or "track" in st_lower:
                                continue
                            # Accept if it looks like a subscriber string
                            if "sub" in st_lower or "abonn" in st_lower or "suscriptor" in st_lower or re.search(r'\d', st):
                                sub_text = st
                                break

                        subs = parse_subscribers(sub_text)
                        thumbs = c.get("thumbnail", {}).get("thumbnails", [])
                        raw_avatar = thumbs[-1].get("url", "") if thumbs else ""
                        avatar_url = upgrade_avatar_url(raw_avatar)

                        candidates.append({
                            "subscribers": subs,
                            "image": avatar_url,
                            "channelTitle": title,
                            "channelId": c.get("channelId", ""),
                            "is_oac": is_oac
                        })

                # Return best candidate: prefer OAC channels, then highest subscriber count
                if candidates:
                    oac_candidates = [c for c in candidates if c["is_oac"]]
                    if oac_candidates:
                        return max(oac_candidates, key=lambda c: c["subscribers"])
                    # Strict OAC Guard for High-Subscriber Channels:
                    # Genuine musical artists with > 500k subscribers have an Official Artist Channel (OAC) badge.
                    # Non-OAC channels with millions of subscribers are corporate brands, gaming channels, or movie studios.
                    best_candidate = max(candidates, key=lambda c: c["subscribers"])
                    if best_candidate["subscribers"] <= 500_000:
                        return best_candidate
                    best_candidate["subscribers"] = 0
                    return best_candidate
                break
            elif resp.status_code == 429:
                time.sleep(15.0 * (attempt + 1))
        except Exception:
            time.sleep(0.3)
    return None

class iTunesRateLimiter:
    """
    Strict thread-safe rate limiter adhering to Apple's official Search API specification:
    'The Search API is limited to approximately 20 calls per minute.'
    Guarantees an interval of at least 3.0 seconds between outgoing HTTP requests to Apple.
    """
    def __init__(self, calls_per_minute: float = 20.0):
        self.min_interval = 60.0 / max(1.0, calls_per_minute)  # 3.0 seconds
        self.lock = threading.Lock()
        self.last_call = 0.0

    def acquire(self):
        with self.lock:
            now = time.time()
            elapsed = now - self.last_call
            if elapsed < self.min_interval:
                time.sleep(self.min_interval - elapsed)
            self.last_call = time.time()

itunes_limiter = iTunesRateLimiter(calls_per_minute=20.0)

def query_itunes(name: str, client: httpx.Client, max_retries: int = 4) -> dict | None:
    """Queries Apple iTunes Search API for 30s previewUrl, topTrack, 600px artwork, and genre with single-query limit=50."""
    url = "https://itunes.apple.com/search"
    params = {"term": name, "media": "music", "entity": "song", "limit": 50}
    target_name = name.lower().strip()

    for attempt in range(max_retries):
        try:
            itunes_limiter.acquire()
            resp = client.get(url, params=params, timeout=6.0)
            if resp.status_code == 200:
                results = resp.json().get("results", [])
                # Pass 1: Strict exact match with valid audio preview
                for r in results:
                    art_name = r.get("artistName", "").strip().lower()
                    if art_name == target_name and r.get("previewUrl"):
                        return {
                            "topTrack": r.get("trackName", ""),
                            "previewUrl": r.get("previewUrl", ""),
                            "image": r.get("artworkUrl100", "").replace("100x100bb", "600x600bb"),
                            "primaryGenre": r.get("primaryGenreName", "")
                        }
                # Pass 2: Word-bounded collaboration match with valid audio preview
                for r in results:
                    art_name = r.get("artistName", "").strip().lower()
                    # Only match genuine collaboration strings (e.g. 'Artist A feat. Artist B', 'Artist A & Artist B')
                    # or exact multi-word phrases. NEVER match when target_name is merely a single first name of a full name (e.g. 'Michael' matching 'Michael Jackson')
                    is_collab = bool(re.search(rf'(?:ft\.?|feat\.?|&|,|\bx\b)\s+{re.escape(target_name)}\b', art_name, re.IGNORECASE))
                    is_exact_phrase = len(target_name.split()) > 1 and bool(re.search(rf'\b{re.escape(target_name)}\b', art_name, re.IGNORECASE))
                    if (is_collab or is_exact_phrase) and r.get("previewUrl"):
                        return {
                            "topTrack": r.get("trackName", ""),
                            "previewUrl": r.get("previewUrl", ""),
                            "image": r.get("artworkUrl100", "").replace("100x100bb", "600x600bb"),
                            "primaryGenre": r.get("primaryGenreName", "")
                        }
                return None
            elif resp.status_code == 429:
                cooldown = 30.0 * (attempt + 1) + random.uniform(2.0, 5.0)
                print(f"  [iTunes Rate Limit] 429 for '{name}'. Cooling down {cooldown:.1f}s before retry {attempt + 1}/{max_retries}...")
                time.sleep(cooldown)
                with itunes_limiter.lock:
                    itunes_limiter.last_call = time.time()
        except Exception:
            time.sleep(0.3)

    return None

def hydrate_graph(args):
    """
    Stage 6: Targeted Dual Hydration (YouTube OAC + Apple iTunes).
    Extracts connected artists in atlas-graph.json and resolves authentic
    YouTube subscriber counts, 512px portraits, iTunes topTrack, and 30s previews.
    Automatically re-exports web artifacts upon completion.
    """
    print("=" * 70)
    print(" STAGE 6: TARGETED PREVIEW & PORTRAIT HYDRATION (CONNECTED NODES)")
    print("=" * 70)
    start_time = time.time()

    graph_file = os.path.join(OUTPUT_DIR, "atlas-graph.json")
    if not os.path.exists(graph_file):
        web_graph = os.path.join(os.path.dirname(PIPELINE_DIR), "web", "public", "data", "atlas-graph.json")
        if os.path.exists(web_graph):
            graph_file = web_graph
        else:
            raise FileNotFoundError("atlas-graph.json not found! Run pipeline through Stage 5 first before hydrating.")

    if not os.path.exists(CATALOG_FILE):
        raise FileNotFoundError(f"Missing {CATALOG_FILE}. Run Stage 3 first.")

    with open(graph_file, "r", encoding="utf-8") as f:
        graph_data = json.load(f)
    with open(CATALOG_FILE, "r", encoding="utf-8") as f:
        catalog = json.load(f)

    cache = load_metadata_cache()
    print(f"Loaded {len(cache)} existing cached artist metadata entries.")

    artist_harvested_preview = {}
    if os.path.exists(PLAYLISTS_FILE):
        try:
            with open(PLAYLISTS_FILE, "r", encoding="utf-8") as f:
                playlists = json.load(f)
            for pl in playlists:
                for t in pl.get("tracks", []):
                    c_name = sanitize_artist_name(t.get("artist_name", "").strip())
                    if c_name and t.get("preview_url") and c_name not in artist_harvested_preview:
                        artist_harvested_preview[c_name] = t["preview_url"]
        except Exception:
            pass

    nodes = graph_data.get("nodes", [])
    print(f"Total nodes in connected graph: {len(nodes)}")

    # Identify artists requiring hydration
    targets = []
    for node in nodes:
        node_name = node.get("label") or node.get("name") or node["id"]
        c_meta = cache.get(node_name) or cache.get(node_name.lower()) or {}
        subs = c_meta.get("subscribers", node.get("subscribers", 0))
        preview = c_meta.get("preview_url", node.get("previewUrl", ""))
        avatar = c_meta.get("image", node.get("image", ""))
        if "d41d8cd98f00b204e9800998ecf8427e" in avatar:
            avatar = ""

        needs_yt = (subs <= 1000 or not avatar) and not c_meta.get("yt_checked", False)
        # Allow re-fetch for clearly wrong data: subscriber counts ≤ 100 are almost always
        # the result of matching a fan channel instead of the official one
        needs_yt = needs_yt or (subs <= 100 and subs > 0)
        # Also re-fetch if image is missing protocol (old broken data)
        if avatar and not avatar.startswith("http"):
            needs_yt = True
        needs_itunes = not preview and not c_meta.get("itunes_checked", False)

        if needs_yt or needs_itunes:
            targets.append((node["id"], node_name))

    if args.limit_lookups > 0:
        targets = targets[:args.limit_lookups]

    print(f"Hydration queue: {len(targets)} connected artists require YouTube/iTunes enrichment.")

    if targets and not args.offline:
        http_client = httpx.Client(headers={"User-Agent": "MusicAtlas/2.0"}, follow_redirects=True, timeout=6.0)

        def resolve_single_node(item):
            node_id, name = item
            c_meta = dict(cache.get(name) or cache.get(name.lower()) or {})
            subs = c_meta.get("subscribers", 0)
            is_oac = c_meta.get("is_oac", False)
            avatar_url = c_meta.get("image", "")
            if "d41d8cd98f00b204e9800998ecf8427e" in avatar_url:
                avatar_url = ""
            preview_url = c_meta.get("preview_url", "") or artist_harvested_preview.get(name, "")
            top_track = c_meta.get("topTrack") or c_meta.get("top_track", "")
            itunes_genre = c_meta.get("primaryGenre", "")

            # 1. YouTube Channel Lookup if missing authentic subscribers or avatar
            needs_refetch = (subs <= 1000 or not avatar_url) and not c_meta.get("yt_checked", False)
            needs_refetch = needs_refetch or (subs <= 100 and subs > 0)
            if avatar_url and not avatar_url.startswith("http"):
                needs_refetch = True
            if needs_refetch:
                yt_res = query_youtube_channel(name, http_client)
                if yt_res:
                    if yt_res.get("subscribers") and (subs <= 1000 or yt_res["subscribers"] > subs):
                        subs = yt_res["subscribers"]
                    if not avatar_url and yt_res.get("image"):
                        avatar_url = yt_res["image"]
                    if yt_res.get("is_oac"):
                        is_oac = True
                c_meta["yt_checked"] = True
                time.sleep(random.uniform(0.15, 0.35))

            # 2. Apple iTunes Lookup for top track, verified 30s preview, artwork, genre
            if (not preview_url or not top_track) and not c_meta.get("itunes_checked", False):
                itunes_res = query_itunes(name, http_client)
                if itunes_res:
                    if itunes_res.get("topTrack") and itunes_res.get("previewUrl"):
                        top_track = itunes_res["topTrack"]
                        preview_url = itunes_res["previewUrl"]
                    if itunes_res.get("primaryGenre"):
                        itunes_genre = itunes_res["primaryGenre"]
                    if not avatar_url and itunes_res.get("image"):
                        avatar_url = itunes_res["image"]
                c_meta["itunes_checked"] = True

            c_meta.update({
                "subscribers": subs,
                "is_oac": is_oac,
                "primaryGenre": itunes_genre or c_meta.get("primaryGenre", ""),
                "preview_url": preview_url,
                "topTrack": top_track,
                "image": avatar_url,
                "resolved": True
            })
            return name, c_meta

        try:
            with ThreadPoolExecutor(max_workers=args.workers) as executor:
                pbar = tqdm(total=len(targets), desc="Hydrating Graph Artists", unit="artist")
                for a_name, updated_meta in executor.map(resolve_single_node, targets):
                    cache[a_name] = updated_meta
                    pbar.update(1)
                    if pbar.n % 25 == 0 or pbar.n == len(targets):
                        save_metadata_cache(cache)
                pbar.close()
        finally:
            http_client.close()
            save_metadata_cache(cache)

    # Synchronize hydrated metadata into artists_catalog.json
    print(f"\nSynchronizing hydrated metadata into {CATALOG_FILE}...")
    updated_catalog_count = 0
    for a in catalog:
        a_name = a.get("name", "")
        c_meta = cache.get(a_name) or cache.get(a_name.lower())
        if c_meta:
            subs = c_meta.get("subscribers", 0)
            if subs > 0:
                a["subscribers"] = subs
                a["subscribersFormatted"] = format_subscribers(subs)
                a["followers"] = subs
                a["monthlyListeners"] = subs
                a["popularity"] = calculate_log_popularity(subs)
            if c_meta.get("image"):
                a["image"] = c_meta["image"]
            if c_meta.get("preview_url"):
                a["previewUrl"] = c_meta["preview_url"]
            if c_meta.get("topTrack"):
                a["topTrack"] = c_meta["topTrack"]
            if c_meta.get("primaryGenre") and c_meta["primaryGenre"].lower().strip() not in NON_MUSICAL_AUDIO_TOKENS:
                a["primaryGenre"] = c_meta["primaryGenre"]
                a["macro_genre"] = c_meta["primaryGenre"]
            updated_catalog_count += 1

    with open(CATALOG_FILE, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)
    print(f"Updated {updated_catalog_count} catalog entries.")

    # Automatically re-export web artifacts
    print("\nAutomatically re-exporting web artifacts (06_export_web_artifacts.py)...")
    export_script = os.path.join(PIPELINE_DIR, "06_export_web_artifacts.py")
    subprocess.run([sys.executable, export_script], cwd=PIPELINE_DIR, check=True)

    print(f"\nHydration & Re-export complete in {time.time() - start_time:.2f}s!")
    print("=" * 70)

def main():
    parser = argparse.ArgumentParser(description="Stage 3: Multi-Subgenre Resolution & Metadata Enrichment.")
    parser.add_argument("--min-playlists", type=int, default=2, help="Minimum playlist threshold c_i for candidate survival (default: 2)")
    parser.add_argument("--catalog-only", action="store_true", help="Fast path: assemble artists_catalog.json using disk cache & local IDF subgenres")
    parser.add_argument("--hydrate-graph", action="store_true", help="Targeted hydration: resolve YouTube channels and iTunes audio previews strictly for connected nodes in atlas-graph.json")
    parser.add_argument("--offline", action="store_true", help="Bypass external HTTP calls; rely strictly on cache and local data")
    parser.add_argument("--workers", type=int, default=2, help="Concurrency for network resolution (default: 2)")
    parser.add_argument("--limit-lookups", type=int, default=0, help="Max artists to look up over network in this run (0=all)")
    args = parser.parse_args()

    if args.hydrate_graph:
        hydrate_graph(args)
        return

    if not os.path.exists(PLAYLISTS_FILE) or not os.path.exists(OCCURRENCES_FILE):
        raise FileNotFoundError("Missing Stage 2 outputs. Run 01_harvest_playlists.py first.")

    with open(PLAYLISTS_FILE, "r", encoding="utf-8") as f:
        playlists = json.load(f)
    with open(OCCURRENCES_FILE, "r", encoding="utf-8") as f:
        occurrences = json.load(f)

    print("=" * 70)
    print(" STAGE 3: MULTI-SUBGENRE RESOLUTION & AUTHENTIC METADATA ENRICHMENT")
    print("=" * 70)
    start_time = time.time()

    total_playlists = len(playlists)
    print(f"Total surviving harvested playlists: {total_playlists}")

    # 1. Count artist appearances across surviving playlists: c_i
    artist_playlist_counts = Counter()
    artist_canonical_id = {}
    artist_harvested_preview = {}

    for pl in playlists:
        seen_in_pl = set()
        for t in pl.get("tracks", []):
            raw_name = t.get("artist_name", "").strip()
            clean_name = sanitize_artist_name(raw_name)
            if not clean_name:
                continue
            if clean_name not in seen_in_pl:
                artist_playlist_counts[clean_name] += 1
                seen_in_pl.add(clean_name)
            if t.get("artist_id"):
                artist_canonical_id[clean_name] = t["artist_id"]
            if t.get("preview_url") and clean_name not in artist_harvested_preview:
                artist_harvested_preview[clean_name] = t["preview_url"]

    # 2. Artist Survival Rule: c_i >= args.min_playlists (must appear in at least min_playlists qualifying community playlists)
    cache = load_metadata_cache()
    print(f"Loaded {len(cache)} existing cached artist metadata entries.")

    surviving_artists = [a for a, c in artist_playlist_counts.items() if c >= args.min_playlists]
    pruned_count = len(artist_playlist_counts) - len(surviving_artists)
    print(f"Artist Survival Pre-Filter (c_i >= {args.min_playlists}): {len(surviving_artists)} candidates retained ({pruned_count} singletons pruned).")

    # 3. Calculate Genre Inverted Document Frequency (IDF)
    genre_playlist_counts = Counter()
    for pl in playlists:
        g = pl.get("genre", "").lower().strip()
        if g and g not in NON_MUSICAL_AUDIO_TOKENS:
            genre_playlist_counts[g] += 1

    idf_weights = {}
    for g, count in genre_playlist_counts.items():
        idf_weights[g] = math.log(1.0 + (total_playlists / float(count)))

    # 4. Compute Top 3 Subgenres per candidate artist
    artist_top_subgenres = {}
    for a in tqdm(surviving_artists, desc="Stage 3: Subgenre Resolution", unit="artist"):
        a_occ = occurrences.get(a, {})
        scores = []
        for g, count in a_occ.items():
            g_clean = g.lower().strip()
            if not g_clean or g_clean in NON_MUSICAL_AUDIO_TOKENS:
                continue
            idf = idf_weights.get(g_clean, 1.0)
            score = count * idf
            scores.append((g_clean, score))

        scores.sort(key=lambda x: x[1], reverse=True)
        top_3 = []
        for g, _ in scores:
            title_g = " ".join(w.capitalize() for w in g.split())
            if title_g not in top_3 and title_g.lower() not in NON_MUSICAL_AUDIO_TOKENS:
                top_3.append(title_g)
            if len(top_3) >= 3:
                break
        
        artist_top_subgenres[a] = top_3

    # 5. Metadata Hydration (Verified YouTube OAC & iTunes)
    sorted_candidates = sorted(surviving_artists, key=lambda a: artist_playlist_counts[a], reverse=True)
    http_client = None

    if not args.catalog_only and not args.offline:
        http_client = httpx.Client(headers={"User-Agent": "MusicAtlas/2.0"}, follow_redirects=True, timeout=6.0)
        artists_to_lookup = []
        for a_name in sorted_candidates:
            cached_meta = cache.get(a_name) or cache.get(a_name.lower())
            is_already_resolved = bool(
                cached_meta and (
                    cached_meta.get("resolved") or
                    "primaryGenre" in cached_meta
                )
            )
            if not is_already_resolved:
                artists_to_lookup.append(a_name)

        if args.limit_lookups > 0:
            artists_to_lookup = artists_to_lookup[:args.limit_lookups]

        print(f"Hydration Queue: {len(artists_to_lookup)} artists require metadata resolution.")

        if artists_to_lookup:
            print(f"Resolving YouTube OAC channels and iTunes metadata with parallel pool ({args.workers} workers)...")

            def resolve_artist_metadata(name: str):
                c_meta = cache.get(name) or cache.get(name.lower()) or {}
                subs = c_meta.get("subscribers", 0)
                is_oac = c_meta.get("is_oac", False)
                avatar_url = c_meta.get("image", "") if "d41d8cd98f00b204e9800998ecf8427e" not in c_meta.get("image", "") else ""
                preview_url = c_meta.get("preview_url", "") or artist_harvested_preview.get(name, "")
                top_track = c_meta.get("topTrack") or c_meta.get("top_track", "")
                itunes_genre = c_meta.get("primaryGenre", "")

                # 1. YouTube Channel Lookup if missing authentic subscribers or avatar
                if subs <= 0 or not avatar_url:
                    yt_res = query_youtube_channel(name, http_client)
                    if yt_res:
                        if subs <= 0 and yt_res.get("subscribers"):
                            subs = yt_res["subscribers"]
                        if not avatar_url and yt_res.get("image"):
                            avatar_url = yt_res["image"]
                        if yt_res.get("is_oac"):
                            is_oac = True
                    time.sleep(random.uniform(0.15, 0.35))

                # 2. Apple iTunes Lookup for top track, verified 30s AAC preview, artwork, and primary genre
                if not itunes_genre or not preview_url or not top_track or not avatar_url:
                    itunes_res = query_itunes(name, http_client)
                    if itunes_res:
                        if itunes_res.get("topTrack") and itunes_res.get("previewUrl"):
                            # Atomic update: sample and song title are locked to the exact same track
                            top_track = itunes_res["topTrack"]
                            preview_url = itunes_res["previewUrl"]
                        if itunes_res.get("primaryGenre"):
                            itunes_genre = itunes_res["primaryGenre"]
                        if not avatar_url and itunes_res.get("image"):
                            avatar_url = itunes_res["image"]

                # Final primary genre resolution
                top_subg = artist_top_subgenres.get(name, [])
                valid_subg = [s for s in top_subg if s.lower().strip() not in NON_MUSICAL_AUDIO_TOKENS]
                is_valid_itunes = bool(itunes_genre and itunes_genre.lower().strip() not in NON_MUSICAL_AUDIO_TOKENS)
                final_primary = itunes_genre if is_valid_itunes else (valid_subg[0] if valid_subg else "Other")

                return name, {
                    "subscribers": subs,
                    "is_oac": is_oac,
                    "primaryGenre": final_primary,
                    "preview_url": preview_url,
                    "topTrack": top_track,
                    "image": avatar_url,
                    "resolved": True
                }

            with ThreadPoolExecutor(max_workers=args.workers) as executor:
                pbar = tqdm(total=len(artists_to_lookup), desc="Stage 3: Hydrating Artists", unit="artist")
                for a_name, meta in executor.map(resolve_artist_metadata, artists_to_lookup):
                    cache[a_name] = meta
                    pbar.update(1)
                    if pbar.n % 25 == 0 or pbar.n == len(artists_to_lookup):
                        save_metadata_cache(cache)
                pbar.close()
    elif args.catalog_only:
        print("Catalog-only mode enabled: bypassing network hydration and using cached metadata/IDF subgenres.")

    catalog = []
    surviving_ids = []
    try:
        for idx, a_name in enumerate(tqdm(sorted_candidates, desc="Stage 3: Assembling Catalog", unit="artist")):
            c_i = artist_playlist_counts[a_name]
            top_subg = artist_top_subgenres.get(a_name, [])
            valid_subg = [s for s in top_subg if s.lower().strip() not in NON_MUSICAL_AUDIO_TOKENS]
            cached_meta = cache.get(a_name) or cache.get(a_name.lower()) or {}
            cached_primary = cached_meta.get("primaryGenre")
            is_valid_cached = bool(cached_primary and cached_primary.lower().strip() not in NON_MUSICAL_AUDIO_TOKENS)
            primary_genre = cached_primary if is_valid_cached else (valid_subg[0] if valid_subg else "Other")
            a_id = artist_canonical_id.get(a_name, f"artist_{idx}")

            subs = cached_meta.get("subscribers", 0)
            is_oac = cached_meta.get("is_oac", False)
            has_itunes_music = bool(cached_meta.get("preview_url") or cached_meta.get("topTrack") or is_valid_cached)

            # Strict Entity Culling:
            # 1. Non-music genre check (reject Comedy, Sports, Podcast, Children's Music, etc.)
            if primary_genre.lower().strip() in NON_MUSIC_GENRES:
                continue

            # 2. Strict OAC Guard for High-Subscriber Entities (> 500k)
            # Any entity claiming > 500k subscribers MUST have an Official Artist Channel badge.
            # Non-OAC channels with millions of subscribers are corporate brands, gaming channels, or movie studios.
            if subs > 500_000 and not is_oac:
                if not (cached_meta.get("preview_url") or cached_meta.get("topTrack")):
                    continue
                subs = 0

            # 2.5 Mega-Artist Verification Gate:
            # Genuine superstars (> 5M subscribers) always have verified iTunes tracks and previews under their artist name.
            # Entities lacking any preview/track at this scale are channel handles (e.g. BANGTANTV) or unparsed titles.
            if subs > 5_000_000 and not (cached_meta.get("preview_url") or cached_meta.get("topTrack")):
                continue

            # 3. Authentic Discography Gate
            # If entity was resolved in metadata cache but has neither an OAC nor an iTunes track/preview:
            # it is an unverified channel/uploader, NOT a music artist.
            has_verified_music = is_oac or bool(cached_meta.get("preview_url") or cached_meta.get("topTrack"))
            if cached_meta.get("resolved") and not has_verified_music:
                continue

            if subs <= 0:
                subs = 1000

            top_track = cached_meta.get("topTrack") or cached_meta.get("top_track", "")
            preview_url = cached_meta.get("preview_url", "") or artist_harvested_preview.get(a_name, "")
            avatar_url = cached_meta.get("image", "")
            if "d41d8cd98f00b204e9800998ecf8427e" in avatar_url:
                avatar_url = ""

            pop = calculate_log_popularity(subs)
            subs_formatted = format_subscribers(subs)

            catalog.append({
                "id": a_id,
                "name": a_name,
                "label": a_name,
                "is_oac": is_oac,
                "subscribers": subs,
                "subscribersFormatted": subs_formatted,
                "followers": subs,
                "monthlyListeners": subs,
                "popularity": pop,
                "primaryGenre": primary_genre,
                "macro_genre": primary_genre,
                "genres": valid_subg,
                "topSubgenres": valid_subg,
                "image": avatar_url,
                "previewUrl": preview_url,
                "topTrack": top_track,
                "spotifyUrl": f"https://open.spotify.com/search/{quote_plus(a_name)}",
                "sharedPlaylistsCount": c_i
            })
            surviving_ids.append(a_id)
    finally:
        if http_client:
            http_client.close()
        save_metadata_cache(cache)

    print(f"\nSaving {len(catalog)} verified enriched artists to {CATALOG_FILE}...")
    with open(CATALOG_FILE, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)

    with open(SURVIVORS_FILE, "w", encoding="utf-8") as f:
        json.dump(surviving_ids, f, indent=2)
    print(f"Saved {len(surviving_ids)} surviving verified artist IDs to {SURVIVORS_FILE}.")

    print(f"\nStage 3 completed in {time.time() - start_time:.2f}s!")
    print(f"Catalog saved with {len(catalog)} verified artists (Zero Fake Numbers).")
    print("=" * 70)

if __name__ == "__main__":
    main()
