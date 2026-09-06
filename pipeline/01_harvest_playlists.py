"""
Stage 2: Multi-Vector Quality-Filtered Playlist Harvesting & Provenance Tagging.
Harvests EveryNoise curated playlists and public YouTube Music community playlists across EveryNoise genres.
Implements:
1. EveryNoise Taxonomy Ingestion: Curated genre playlists via Spotify embed (__NEXT_DATA__)
2. YouTube Music Community Harvesting: 2-Pass search & tracklist ingestion
3. Strict Unicode-safe artist sanitization (rejects dates, handles, view counts, video metadata)
4. Zero "Pop" bias: Accumulates authentic subgenre provenance (artist_subgenre_occurrences[artist][genre] += 1)
5. Anti-Discography filter (discard if max single-artist share > 50%)
6. Tracklist size boundary (strictly 10 <= tracks <= 150)
7. Resilient pacing, rate-limiting backoff, and atomic checkpointing
"""

import os
import sys
import json
import time
import re
import random
import hashlib
import html
import argparse
from collections import Counter, defaultdict
from typing import Dict, List, Optional, Tuple, Any, Set
from concurrent.futures import ThreadPoolExecutor
import httpx

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

from ytmusicapi import YTMusic
from sanitizer import sanitize_artist_name, is_valid_artist, split_artist_names

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(PIPELINE_DIR, "data")
OUTPUT_DIR = os.path.join(PIPELINE_DIR, "output")
os.makedirs(OUTPUT_DIR, exist_ok=True)

GENRES_FILE = os.path.join(OUTPUT_DIR, "everynoise_ranked_genres.json")
PLAYLISTS_FILE = os.path.join(OUTPUT_DIR, "harvested_playlists.json")
OCCURRENCES_FILE = os.path.join(OUTPUT_DIR, "artist_subgenre_occurrences.json")
STATE_FILE = os.path.join(OUTPUT_DIR, "harvest_state.json")
CACHE_FILE = os.path.join(DATA_DIR, "crawled_playlists", "yt_playlists_cache.json")

SYSTEM_AUTHORS = {
    "youtube music", "spotify", "various artists - topic", "youtube", "music"
}

DISALLOWED_TOKENS = ["rdampl", "my supermix", "supermix"]

def normalize_artist_id(name: str, channel_id: Optional[str] = None) -> str:
    """Creates a deterministic, unique identifier for an artist."""
    if channel_id and channel_id.strip():
        return f"yt_{channel_id.strip()}"
    clean = name.strip().lower()
    return f"name_{hashlib.md5(clean.encode('utf-8')).hexdigest()[:12]}"

def is_system_or_algorithmic_playlist(title: str, author_name: str, author_id: str, browse_id: str) -> bool:
    """Rejects algorithmic, auto-generated, or system playlists."""
    t_clean = title.lower().strip()
    a_clean = author_name.lower().strip()
    b_clean = browse_id.lower().strip()

    if a_clean in SYSTEM_AUTHORS:
        return True
    if any(token in b_clean for token in DISALLOWED_TOKENS):
        return True
    if any(token in t_clean for token in DISALLOWED_TOKENS):
        return True
    return False

def load_preexisting_cache() -> Dict[str, Dict]:
    """Loads existing crawled playlists cache if present on disk."""
    if not os.path.exists(CACHE_FILE):
        return {}
    try:
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            print(f"Found {len(data)} pre-cached playlists in {CACHE_FILE}.")
            return data
    except Exception as e:
        print(f"Warning: Could not read pre-cached playlists: {e}")
        return {}

def load_checkpoint() -> Tuple[List[Dict], Dict[str, Dict[str, int]], Dict[str, int], Set[str]]:
    """Loads existing harvesting state or initializes empty containers."""
    if not os.path.exists(STATE_FILE) or not os.path.exists(PLAYLISTS_FILE) or not os.path.exists(OCCURRENCES_FILE):
        return [], {}, {}, set()

    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            state = json.load(f)
        with open(PLAYLISTS_FILE, "r", encoding="utf-8") as f:
            playlists = json.load(f)
        with open(OCCURRENCES_FILE, "r", encoding="utf-8") as f:
            occurrences = json.load(f)
        seen_authors = state.get("seen_authors", {})
        completed_genres = set(state.get("completed_genres", []))
        print(f"Resuming from checkpoint: {len(completed_genres)} genres processed, {len(playlists)} playlists collected.")
        return playlists, occurrences, seen_authors, completed_genres
    except Exception as e:
        print(f"Checkpoint corrupted ({e}), starting fresh.")
        return [], {}, {}, set()

def save_checkpoint(playlists: List[Dict], occurrences: Dict[str, Dict[str, int]], seen_authors: Dict[str, int], completed_genres: List[str]):
    """Atomically saves the harvesting state."""
    state = {
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "playlistsCount": len(playlists),
        "genresCount": len(completed_genres),
        "completed_genres": completed_genres,
        "seen_authors": seen_authors
    }
    temp_state = STATE_FILE + ".tmp"
    with open(temp_state, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)
    os.replace(temp_state, STATE_FILE)

    temp_pl = PLAYLISTS_FILE + ".tmp"
    with open(temp_pl, "w", encoding="utf-8") as f:
        json.dump(playlists, f, indent=2)
    os.replace(temp_pl, PLAYLISTS_FILE)

    temp_occ = OCCURRENCES_FILE + ".tmp"
    with open(temp_occ, "w", encoding="utf-8") as f:
        json.dump(occurrences, f, indent=2)
    os.replace(temp_occ, OCCURRENCES_FILE)

def fetch_spotify_genre_playlist(spotify_id: str, genre: str, client: httpx.Client) -> Optional[List[Dict]]:
    """Fetches official EveryNoise curated playlist tracks from Spotify embed or direct EveryNoise engenremap."""
    # 1. Try Spotify embed first
    if spotify_id:
        url = f"https://open.spotify.com/embed/playlist/{spotify_id}"
        try:
            resp = client.get(url, timeout=4.0)
            if resp.status_code == 200:
                m = re.search(r'<script id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>', resp.text)
                if m:
                    data = json.loads(m.group(1))
                    entity = data.get("props", {}).get("pageProps", {}).get("state", {}).get("data", {}).get("entity", {})
                    track_list = entity.get("trackList", [])
                    if track_list:
                        parsed_tracks = []
                        for t in track_list:
                            raw_a = t.get("subtitle") or ""
                            artists = split_artist_names(raw_a)
                            if not artists:
                                continue
                            preview = t.get("audioPreview", {}).get("url") or ""
                            title = t.get("title") or ""
                            for clean_a in artists:
                                parsed_tracks.append({
                                    "artist_name": clean_a,
                                    "artist_id": normalize_artist_id(clean_a, None),
                                    "title": title,
                                    "preview_url": preview,
                                    "channel_id": ""
                                })
                        if len(parsed_tracks) >= 10:
                            return parsed_tracks
        except Exception:
            pass

    # 2. Resilient fallback: Direct EveryNoise engenremap HTML
    compact = re.sub(r'[^a-z0-9]', '', genre.lower())
    en_url = f"https://everynoise.com/engenremap-{compact}.html"
    try:
        resp = client.get(en_url, timeout=8.0)
        if resp.status_code == 200:
            items = re.findall(r'<div id=item\d+[^>]*>.*?</div>', resp.text)
            parsed_tracks = []
            for item in items:
                m = re.search(r'>([^<]+)<a class=navlink', item)
                if not m:
                    continue
                raw_name = html.unescape(m.group(1).strip())
                p_match = re.search(r'preview_url="([^"]+)"', item)
                preview = p_match.group(1) if p_match else ""
                for clean_a in split_artist_names(raw_name):
                    parsed_tracks.append({
                        "artist_name": clean_a,
                        "artist_id": normalize_artist_id(clean_a, None),
                        "title": f"The Sound of {genre.title()}",
                        "preview_url": preview,
                        "channel_id": ""
                    })
            if len(parsed_tracks) >= 10:
                return parsed_tracks
    except Exception:
        pass

    return None

def main():
    parser = argparse.ArgumentParser(description="Stage 2: Quality-Filtered Community Playlist Harvesting.")
    parser.add_argument("--limit-genres", type=int, default=None, help="Limit number of genres to crawl in this run")
    parser.add_argument("--use-cache", action="store_true", default=True, help="Incorporate pre-existing crawled playlist cache")
    parser.add_argument("--rate-limit", type=float, default=2.5, help="Max requests per second for YTM (default: 2.5)")
    parser.add_argument("--ytm-limit", type=int, default=120, help="Max genres to crawl with YTM (default: 120)")
    args = parser.parse_args()

    if not os.path.exists(GENRES_FILE):
        raise FileNotFoundError(f"Missing {GENRES_FILE}. Please run 00_harvest_genres.py first.")

    with open(GENRES_FILE, "r", encoding="utf-8") as f:
        genres_data = json.load(f)

    if args.limit_genres:
        genres_data = genres_data[:args.limit_genres]

    print("=" * 70)
    print(f" STAGE 2: COMMUNITY PLAYLIST HARVESTING ({len(genres_data)} genres queued)")
    print("=" * 70)
    start_time = time.time()

    playlists, occurrences, seen_authors, completed_genres = load_checkpoint()
    occ_map = defaultdict(lambda: defaultdict(int))
    for a_name, g_counts in occurrences.items():
        for g, c in g_counts.items():
            occ_map[a_name][g] = c

    existing_playlist_ids = {p["id"] for p in playlists}

    # Pre-sort all known EveryNoise genres by length descending for greedy title matching
    all_known_genres = sorted([g["genre"] for g in genres_data], key=lambda x: len(x), reverse=True)

    # 1. Incorporate pre-existing crawled playlists if available
    if args.use_cache:
        pre_cache = load_preexisting_cache()
        cached_added = 0
        for pl_id, pl_data in pre_cache.items():
            if pl_id in existing_playlist_ids:
                continue
            
            raw_artists = pl_data.get("artists", [])
            title = pl_data.get("title", "")
            if not (10 <= len(raw_artists) <= 150):
                continue
            
            # Anti-discography check
            freq = Counter(raw_artists)
            if not freq or (max(freq.values()) / len(raw_artists)) > 0.50:
                continue

            # Identify genre from title by matching against EveryNoise taxonomy
            # NO default to "pop"! If no match, tag as "general" and do not pollute occ_map.
            pl_genre = None
            t_lower = title.lower()
            for g_name in all_known_genres:
                if g_name in t_lower:
                    pl_genre = g_name
                    break

            # Build track items with strict sanitization and multi-artist decomposition
            track_items = []
            seen_in_pl = set()
            for a_name in raw_artists:
                for clean_name in split_artist_names(a_name):
                    canonical_id = normalize_artist_id(clean_name, None)
                    track_items.append({
                        "artist_name": clean_name,
                        "artist_id": canonical_id,
                        "channel_id": ""
                    })
                    if clean_name not in seen_in_pl:
                        # ONLY accumulate subgenre if an authentic EveryNoise genre matched
                        if pl_genre:
                            occ_map[clean_name][pl_genre] += 1
                        seen_in_pl.add(clean_name)

            author_id = pl_data.get("author_id") or f"cached_{pl_id}"
            if seen_authors.get(author_id, 0) >= 2:
                continue

            if len(track_items) >= 10:
                seen_authors[author_id] = seen_authors.get(author_id, 0) + 1
                playlists.append({
                    "id": pl_id,
                    "title": title,
                    "author": "Community Curator",
                    "author_id": author_id,
                    "genre": pl_genre or "general",
                    "tracks": track_items
                })
                existing_playlist_ids.add(pl_id)
                cached_added += 1

        if cached_added > 0:
            print(f"Incorporated {cached_added} qualified playlists from offline cache.")

    # 2. Ingest EveryNoise Curated Playlists across top 450 genres in parallel
    target_genres = genres_data[:450]
    print(f"\nHarvesting EveryNoise official curated playlists across {len(target_genres)} genres in parallel...")

    tasks_to_fetch = []
    for g_info in target_genres:
        genre = g_info["genre"]
        spotify_id = g_info.get("spotify_playlist_id")
        pl_id = f"everynoise_{spotify_id}" if spotify_id else f"everynoise_{genre}"
        if pl_id not in existing_playlist_ids and spotify_id:
            tasks_to_fetch.append((spotify_id, genre, pl_id))

    print(f"Queued {len(tasks_to_fetch)} EveryNoise playlists to harvest...")
    spotify_harvested = 0

    if tasks_to_fetch:
        http_client = httpx.Client(
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
            timeout=8.0,
            limits=httpx.Limits(max_connections=25, max_keepalive_connections=15)
        )

        def worker_fetch(task):
            sid, gen, pid = task
            tr = fetch_spotify_genre_playlist(sid, gen, http_client)
            return sid, gen, pid, tr

        try:
            from concurrent.futures import as_completed
            with ThreadPoolExecutor(max_workers=10) as executor:
                futures = [executor.submit(worker_fetch, t) for t in tasks_to_fetch]
                for idx, fut in enumerate(as_completed(futures)):
                    sid, gen, pid, tracks = fut.result()
                    if tracks and len(tracks) >= 10:
                        seen_in_pl = set()
                        for t in tracks:
                            a_name = t["artist_name"]
                            if a_name not in seen_in_pl:
                                occ_map[a_name][gen] += 1
                                seen_in_pl.add(a_name)

                        playlists.append({
                            "id": pid,
                            "title": f"The Sound of {gen.title()}",
                            "author": "Every Noise at Once",
                            "author_id": "everynoise_curator",
                            "genre": gen,
                            "tracks": tracks
                        })
                        existing_playlist_ids.add(pid)
                        spotify_harvested += 1

                    if (idx + 1) % 50 == 0 or (idx + 1) == len(tasks_to_fetch):
                        print(f"  EveryNoise Ingestion: [{idx + 1}/{len(tasks_to_fetch)}] genres checked ({spotify_harvested} playlists added).")
        finally:
            http_client.close()

    print(f"Added {spotify_harvested} EveryNoise official genre playlists with authentic subgenre provenance.")

    # 3. Harvest YouTube Music Community Playlists (for top genres)
    yt = YTMusic()
    min_interval = 1.0 / max(0.5, args.rate_limit)
    last_req_time = 0.0

    def pace_request():
        nonlocal last_req_time
        elapsed = time.time() - last_req_time
        jitter = random.uniform(0.15, 0.35)
        needed = (min_interval + jitter) - elapsed
        if needed > 0:
            time.sleep(needed)
        last_req_time = time.time()

    genres_processed_in_run = 0
    completed_genre_list = list(completed_genres)

    # Crawl YTM community playlists for top uncompleted genres
    ytm_genre_slice = genres_data[:args.ytm_limit]
    for g_idx, g_info in enumerate(ytm_genre_slice):
        genre = g_info["genre"]
        if genre in completed_genres:
            continue

        query = g_info.get("primary_query", f"{genre} playlist")

        candidates = []
        try:
            pace_request()
            results = yt.search(query, filter="playlists", limit=4)
            candidates = results[:4] if results else []
        except Exception as e:
            err_str = str(e).lower()
            if "429" in err_str or "quota" in err_str:
                print(f"  YTM 429 rate limit hit at genre '{genre}'. Backing off for 15s...")
                time.sleep(15.0)
            completed_genres.add(genre)
            completed_genre_list.append(genre)
            continue

        accepted_for_genre = 0
        for cand in candidates:
            browse_id = cand.get("browseId")
            if not browse_id or browse_id in existing_playlist_ids:
                continue

            title = cand.get("title", "")
            author = cand.get("author", {})
            if isinstance(author, dict):
                author_name = author.get("name", "")
                author_id = author.get("id") or author_name
            elif isinstance(author, str):
                author_name = author
                author_id = author
            elif isinstance(author, list) and author:
                author_name = author[0].get("name", "") if isinstance(author[0], dict) else str(author[0])
                author_id = author[0].get("id", author_name) if isinstance(author[0], dict) else author_name
            else:
                author_name = "Community Curator"
                author_id = f"anon_{browse_id[:8]}"

            # 1. Category & Channel Guard
            if is_system_or_algorithmic_playlist(title, author_name, author_id, browse_id):
                continue

            # 2. Global Author Cap (seen_authors < 2)
            if seen_authors.get(author_id, 0) >= 2:
                continue

            # 3. Pass 2B: Full Tracklist Ingestion
            try:
                pace_request()
                pl_details = yt.get_playlist(browse_id, limit=150)
            except Exception as e:
                continue

            raw_tracks = pl_details.get("tracks", [])
            total_tracks = len(raw_tracks)

            # 4. Track Range Filter: strictly 10 <= trackCount <= 150
            if total_tracks < 10 or total_tracks > 150:
                continue

            # 5. Anti-Discography Filter: max artist track share <= 50%
            track_artist_names = []
            for t in raw_tracks:
                artists_list = t.get("artists", [])
                if artists_list and isinstance(artists_list, list):
                    primary_a = artists_list[0].get("name") if isinstance(artists_list[0], dict) else str(artists_list[0])
                    clean_a = sanitize_artist_name(primary_a)
                    if clean_a:
                        track_artist_names.append(clean_a)

            if len(track_artist_names) < 10:
                continue

            freq = Counter(track_artist_names)
            max_share = max(freq.values()) / float(len(track_artist_names))
            if max_share > 0.50:
                continue

            # Passed all filters! Accept playlist
            seen_authors[author_id] = seen_authors.get(author_id, 0) + 1
            existing_playlist_ids.add(browse_id)

            parsed_tracks = []
            seen_artists_in_this_pl = set()

            for t in raw_tracks:
                t_title = t.get("title", "")
                artists_list = t.get("artists", [])
                if not artists_list or not isinstance(artists_list, list):
                    continue
                a_obj = artists_list[0] if isinstance(artists_list[0], dict) else {"name": str(artists_list[0]), "id": None}
                raw_name = a_obj.get("name", "").strip()
                clean_name = sanitize_artist_name(raw_name)
                if not clean_name:
                    continue
                channel_id = a_obj.get("id")
                canonical_id = normalize_artist_id(clean_name, channel_id)

                parsed_tracks.append({
                    "title": t_title,
                    "artist_name": clean_name,
                    "artist_id": canonical_id,
                    "channel_id": channel_id or ""
                })

                if clean_name not in seen_artists_in_this_pl:
                    occ_map[clean_name][genre] += 1
                    seen_artists_in_this_pl.add(clean_name)

            if len(parsed_tracks) >= 10:
                playlists.append({
                    "id": browse_id,
                    "title": title,
                    "author": author_name,
                    "author_id": author_id,
                    "genre": genre,
                    "tracks": parsed_tracks
                })
                accepted_for_genre += 1
                if accepted_for_genre >= 2:
                    break

        completed_genres.add(genre)
        completed_genre_list.append(genre)
        genres_processed_in_run += 1

        if genres_processed_in_run % 25 == 0:
            print(f"  Checkpoint: {len(completed_genre_list)} genres done, {len(playlists)} playlists collected. Saving state...")
            save_checkpoint(playlists, occ_map, seen_authors, completed_genre_list)

    # Final checkpoint save
    save_checkpoint(playlists, occ_map, seen_authors, completed_genre_list)
    print(f"\nStage 2 completed in {time.time() - start_time:.2f}s!")
    print(f"Total surviving playlists: {len(playlists)}")
    print(f"Total tracked artists with provenance tags: {len(occ_map)}")
    print("=" * 70)

if __name__ == "__main__":
    main()
