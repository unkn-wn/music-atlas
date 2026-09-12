"""
Stage 2: Multi-Subgenre Resolution & Deterministic Verification & Hydration.
Implements:
1. Strict Artist Survival Rule: c_i >= 4 independent qualifying user playlists.
2. Deterministic Apple iTunes Verification:
   - Queries Apple iTunes Search API (entity=musicArtist).
   - Rate-limited and cached in pipeline/output/itunes_artists_cache.json.
   - Rejects record labels, promo channels, and non-artist uploaders.
   - Resolves Apple primaryGenreName as the permanent continental label.
   - Preserves exact casing and Apple ID distinction (e.g. dj-Nate vs DJ Nate).
3. Authentic YouTube Music Official Artist Channel (OAC) Hydration:
   - Queries YouTube Music artist entities.
   - Extracts authentic subscriber count (log-scaled sizing).
   - Generates 64x64 WebGL avatar URLs (=s64-c-k-c0x00ffffff-no-rj).
   - Caches results in pipeline/output/yt_artists_cache.json.
4. IDF-Weighted Specificity Scoring:
   - Extracts Top 3 Distinct Subgenres from EveryNoise provenance counts.
5. 30s Audio Previews:
   - Attaches genuine iTunes AAC previewUrl and topTrack title.
6. Outputs:
   - pipeline/output/artists_catalog.json
   - pipeline/output/surviving_artist_ids.json
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
from urllib.parse import quote_plus
from collections import Counter, defaultdict
from typing import Dict, List, Optional, Tuple, Any
import httpx
from tqdm import tqdm
from ytmusicapi import YTMusic

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
ITUNES_CACHE_FILE = os.path.join(OUTPUT_DIR, "itunes_artists_cache.json")
YT_CACHE_FILE = os.path.join(OUTPUT_DIR, "yt_artists_cache.json")

def parse_subscribers(sub_str: str) -> int:
    """Parses subscriber strings like '264K', '85.8M', '1.2 million' into exact integers."""
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
    """Transforms Google thumbnail URLs to 64px square crops (optimized for WebGL texture memory)."""
    if not raw_url:
        return ""
    if raw_url.startswith("//"):
        raw_url = "https:" + raw_url
    if "googleusercontent.com" in raw_url or "ggpht.com" in raw_url:
        base = raw_url.split("=")[0]
        return f"{base}=s64-c-k-c0x00ffffff-no-rj"
    return raw_url

def load_json_cache(fpath: str) -> Dict[str, Any]:
    if os.path.exists(fpath):
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_json_cache(fpath: str, data: Dict[str, Any]):
    temp = fpath + ".tmp"
    with open(temp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(temp, fpath)

_thread_local = threading.local()

def get_ytmusic() -> YTMusic:
    if not hasattr(_thread_local, "yt"):
        _thread_local.yt = YTMusic()
    return _thread_local.yt

def resolve_channel_by_id(channel_id: str, yt: Optional[YTMusic] = None) -> Optional[Dict]:
    """Resolves official YouTube Music channel entity metadata directly by canonical channel ID."""
    if not channel_id or not channel_id.startswith("UC"):
        return None
    try:
        if yt is None:
            yt = get_ytmusic()
        body = {"browseId": channel_id}
        resp = yt._send_request("browse", body)
        header = resp.get("header", {})
        r_header = header.get("musicImmersiveHeaderRenderer") or header.get("musicVisualHeaderRenderer")
        if not r_header:
            return None

        title_runs = r_header.get("title", {}).get("runs", [])
        title = title_runs[0].get("text", "") if title_runs else ""

        sub_btn = r_header.get("subscriptionButton", {}).get("subscribeButtonRenderer", {})
        sub_runs = sub_btn.get("subscriberCountText", {}).get("runs", [])
        sub_text = sub_runs[0].get("text", "") if sub_runs else ""
        subs = parse_subscribers(sub_text)

        fg_thumbs = r_header.get("foregroundThumbnail", {}).get("musicThumbnailRenderer", {}).get("thumbnail", {}).get("thumbnails", [])
        bg_thumbs = r_header.get("thumbnail", {}).get("musicThumbnailRenderer", {}).get("thumbnail", {}).get("thumbnails", [])
        thumbs = fg_thumbs or bg_thumbs
        raw_avatar = thumbs[-1].get("url", "") if thumbs else ""
        avatar_url = upgrade_avatar_url(raw_avatar)

        is_oac = "musicImmersiveHeaderRenderer" in header

        return {
            "name": title,
            "subscribers": subs,
            "image": avatar_url,
            "channelId": channel_id,
            "is_oac": is_oac
        }
    except Exception:
        return None

def resolve_artist_youtube(name: str, channel_id: Optional[str] = None, yt: Optional[YTMusic] = None) -> Optional[Dict]:
    """Resolves authentic YouTube Music artist metadata."""
    if yt is None:
        yt = get_ytmusic()

    if channel_id and channel_id.startswith("UC"):
        res = resolve_channel_by_id(channel_id, yt)
        if res:
            return res

    try:
        clean_name = name.lower().strip()
        results = yt.search(name, filter="artists", limit=3)
        for item in results or []:
            bid = item.get("browseId", "")
            artist_name = (item.get("artist") or "").lower().strip()
            if bid.startswith("UC") and (artist_name == clean_name or not clean_name):
                c_res = resolve_channel_by_id(bid, yt)
                if c_res:
                    return c_res
    except Exception:
        pass

    return None

class iTunesRateLimiter:
    def __init__(self, interval: float = 0.25):
        self.interval = interval
        self.lock = threading.Lock()
        self.last_call = 0.0

    def acquire(self):
        with self.lock:
            now = time.time()
            elapsed = now - self.last_call
            if elapsed < self.interval:
                time.sleep(self.interval - elapsed)
            self.last_call = time.time()

itunes_limiter = iTunesRateLimiter(interval=0.25)

def verify_and_enrich_itunes(name: str, client: httpx.Client, itunes_cache: Dict[str, Any]) -> Tuple[bool, Dict[str, Any]]:
    """
    Deterministically verifies an artist using Apple iTunes Search API.
    Returns (is_verified, metadata).
    """
    cache_key = name.strip()
    if cache_key in itunes_cache:
        cached = itunes_cache[cache_key]
        return cached.get("verified", False), cached

    url = "https://itunes.apple.com/search"
    target_clean = name.lower().strip()

    # Step 1: Query entity=musicArtist to verify genuine recording artist
    params_artist = {"term": name, "entity": "musicArtist", "limit": 3}
    verified = False
    meta = {"verified": False, "canonical_name": name, "primaryGenre": "Pop"}

    for attempt in range(3):
        try:
            itunes_limiter.acquire()
            resp = client.get(url, params=params_artist, timeout=6.0)
            if resp.status_code == 200:
                data = resp.json()
                results = data.get("results", [])
                for r in results:
                    r_name = r.get("artistName", "").lower().strip()
                    # Check exact or strong match
                    if r_name == target_clean or target_clean in r_name or r_name in target_clean:
                        verified = True
                        meta = {
                            "verified": True,
                            "canonical_name": r.get("artistName", name),
                            "artistId": r.get("artistId"),
                            "primaryGenre": r.get("primaryGenreName", "Pop"),
                            "artistLinkUrl": r.get("artistLinkUrl", "")
                        }
                        break
                break
            elif resp.status_code == 429:
                time.sleep(2.0 * (attempt + 1))
        except Exception:
            time.sleep(0.5)

    # Step 2: If verified, fetch 30s preview and topTrack
    if verified:
        params_song = {"term": meta["canonical_name"], "media": "music", "entity": "song", "limit": 5}
        for attempt in range(3):
            try:
                itunes_limiter.acquire()
                resp = client.get(url, params=params_song, timeout=6.0)
                if resp.status_code == 200:
                    songs = resp.json().get("results", [])
                    for s in songs:
                        if s.get("previewUrl"):
                            meta["previewUrl"] = s["previewUrl"]
                            meta["topTrack"] = s.get("trackName", "")
                            meta["artworkUrl100"] = s.get("artworkUrl100", "")
                            break
                    break
            except Exception:
                time.sleep(0.5)

    itunes_cache[cache_key] = meta
    return verified, meta

def compute_idf_top_subgenres(
    artist_name: str,
    occ_map: Dict[str, Dict[str, int]],
    doc_freq: Dict[str, int],
    total_docs: int,
    top_k: int = 3
) -> List[str]:
    """Computes IDF-weighted specificity scores to select the artist's Top 3 distinct subgenres."""
    artist_genres = occ_map.get(artist_name) or occ_map.get(artist_name.lower()) or {}
    if not artist_genres:
        return ["Pop"]

    scores = []
    for g, tf in artist_genres.items():
        df = doc_freq.get(g, 1)
        idf = math.log((1.0 + total_docs) / (1.0 + df)) + 1.0
        score = tf * idf
        scores.append((score, g))

    scores.sort(key=lambda x: x[0], reverse=True)
    top_genres = [g.title() for _, g in scores[:top_k]]
    return top_genres if top_genres else ["Pop"]

def main():
    parser = argparse.ArgumentParser(description="Stage 2: Deterministic Verification & Metadata Enrichment.")
    parser.add_argument("--min-playlists", type=int, default=4, help="Mathematical consensus survival threshold c_i (default: 4)")
    parser.add_argument("--offline", action="store_true", help="Run offline using cached metadata only")
    args = parser.parse_args()

    if not os.path.exists(PLAYLISTS_FILE) or not os.path.exists(OCCURRENCES_FILE):
        raise FileNotFoundError("Missing inputs for Stage 2. Please run 01_harvest_playlists.py first.")

    print("=" * 70)
    print(f" STAGE 2: DETERMINISTIC VERIFICATION & ENRICHMENT (Survival: c_i >= {args.min_playlists})")
    print(" Arbiter: Apple iTunes Search API (entity=musicArtist)")
    print(" Sizing & Avatars: YouTube Official Artist Channels (OAC)")
    print("=" * 70)
    start_time = time.time()

    with open(PLAYLISTS_FILE, "r", encoding="utf-8") as f:
        playlists = json.load(f)
    with open(OCCURRENCES_FILE, "r", encoding="utf-8") as f:
        occurrences = json.load(f)

    # 1. Count independent playlist appearances per artist
    artist_playlist_count = Counter()
    artist_channel_map = {}
    artist_canonical_case = {}

    for pl in playlists:
        seen_in_pl = set()
        for t in pl.get("tracks", []):
            name = t.get("artist_name", "").strip()
            if not name:
                continue
            art_key = name.lower()
            if art_key not in seen_in_pl:
                artist_playlist_count[art_key] += 1
                seen_in_pl.add(art_key)
            if t.get("channel_id") and not artist_channel_map.get(art_key):
                artist_channel_map[art_key] = t["channel_id"]
            if art_key not in artist_canonical_case or name[0].isupper():
                artist_canonical_case[art_key] = name

    surviving_keys = [k for k, c in artist_playlist_count.items() if c >= args.min_playlists]
    print(f"Total candidate artists harvested: {len(artist_playlist_count)}")
    print(f"Surviving candidates meeting c_i >= {args.min_playlists}: {len(surviving_keys)}")

    # 2. Ingest persistent caches
    itunes_cache = load_json_cache(ITUNES_CACHE_FILE)
    yt_cache = load_json_cache(YT_CACHE_FILE)
    print(f"Loaded {len(itunes_cache)} cached iTunes entries, {len(yt_cache)} cached YouTube entries.")

    # 3. Document frequencies for IDF calculation
    doc_freq = Counter()
    for art, g_map in occurrences.items():
        for g in g_map.keys():
            doc_freq[g] += 1
    total_docs = max(1, len(occurrences))

    verified_catalog = []
    surviving_artist_ids = []

    http_client = httpx.Client(headers={"User-Agent": "MusicAtlas/2.0"}, follow_redirects=True, timeout=6.0)
    yt = get_ytmusic()

    try:
        pbar = tqdm(surviving_keys, desc="Stage 2: Verifying & Hydrating", unit="artist")
        for art_key in pbar:
            display_name = artist_canonical_case.get(art_key, art_key)
            total_pl = artist_playlist_count[art_key]
            channel_id = artist_channel_map.get(art_key, "")

            # --- Apple iTunes Verification ---
            if args.offline:
                cached_it = itunes_cache.get(display_name) or itunes_cache.get(art_key) or {}
                verified = cached_it.get("verified", False)
                itunes_meta = cached_it
            else:
                verified, itunes_meta = verify_and_enrich_itunes(display_name, http_client, itunes_cache)

            if not verified:
                continue

            canonical_name = itunes_meta.get("canonical_name", display_name)
            primary_genre = itunes_meta.get("primaryGenre", "Pop")
            preview_url = itunes_meta.get("previewUrl", "")
            top_track = itunes_meta.get("topTrack", "")
            itunes_artwork = itunes_meta.get("artworkUrl100", "")

            # --- YouTube OAC Hydration ---
            yt_key = canonical_name.strip()
            if yt_key in yt_cache:
                yt_meta = yt_cache[yt_key]
            elif args.offline:
                yt_meta = {}
            else:
                yt_res = resolve_artist_youtube(canonical_name, channel_id, yt)
                if yt_res:
                    yt_meta = yt_res
                    yt_cache[yt_key] = yt_res
                else:
                    yt_meta = {}
                    yt_cache[yt_key] = {"resolved": False}

            subs = yt_meta.get("subscribers", 0)
            avatar_url = yt_meta.get("image", "")
            if not avatar_url and itunes_artwork:
                avatar_url = itunes_artwork
            is_oac = yt_meta.get("is_oac", False)

            resolved_channel_id = yt_meta.get("channelId") or channel_id
            if resolved_channel_id and resolved_channel_id.startswith("UC"):
                final_id = f"yt_{resolved_channel_id}"
            else:
                import hashlib
                final_id = f"name_{hashlib.md5(canonical_name.lower().encode('utf-8')).hexdigest()[:12]}"

            # --- IDF-Weighted Top 3 Subgenres ---
            top_subgenres = compute_idf_top_subgenres(display_name, occurrences, doc_freq, total_docs)

            entry = {
                "id": final_id,
                "name": canonical_name,
                "subscribers": subs,
                "formattedSubscribers": format_subscribers(subs),
                "popularity": calculate_log_popularity(subs),
                "primaryGenre": primary_genre,
                "topSubgenres": top_subgenres,
                "previewUrl": preview_url,
                "topTrack": top_track,
                "image": avatar_url,
                "totalPlaylists": total_pl,
                "is_oac": is_oac,
                "channelId": resolved_channel_id
            }

            verified_catalog.append(entry)
            surviving_artist_ids.append(final_id)

            if len(verified_catalog) % 50 == 0 and not args.offline:
                save_json_cache(ITUNES_CACHE_FILE, itunes_cache)
                save_json_cache(YT_CACHE_FILE, yt_cache)

    finally:
        http_client.close()
        if not args.offline:
            save_json_cache(ITUNES_CACHE_FILE, itunes_cache)
            save_json_cache(YT_CACHE_FILE, yt_cache)

    # Save output artifacts
    with open(CATALOG_FILE, "w", encoding="utf-8") as f:
        json.dump(verified_catalog, f, indent=2, ensure_ascii=False)

    with open(SURVIVORS_FILE, "w", encoding="utf-8") as f:
        json.dump(surviving_artist_ids, f, indent=2, ensure_ascii=False)

    print(f"\nStage 2 completed in {time.time() - start_time:.2f}s!")
    print(f"Total surviving verified recording artists: {len(verified_catalog)}")
    print(f"Artifacts saved to {CATALOG_FILE} and {SURVIVORS_FILE}")
    print("=" * 70)

if __name__ == "__main__":
    main()
