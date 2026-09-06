"""
Stage 2: Authentic Multi-Subgenre Community Playlist Harvesting.
Harvests public user-created playlists from YouTube Music across all EveryNoise subgenres equally.
Implements:
1. Equal Analysis Across All Subgenres: No hardcoded artists or subgenre favoritism.
2. Zero "The Sound of [genre]" / Zero Spotify Embeds: Exclusively queries genuine user-created playlists.
3. Search Expansion (>= 20 playlists checked per subgenre) across natural queries:
   - "{genre} playlist"
   - "{genre} mix"
   - "best of {genre}"
4. System & Algorithmic Guard:
   - Rejects system authors ("YouTube Music", "Spotify", "Various Artists - Topic", etc.)
   - Rejects algorithmic mixes ("My Supermix", "Supermix", rdampl)
   - Rejects "Sound of" / auto-generated playlist titles
5. Quality & Anti-Discography Filters:
   - Tracklist boundary strictly 10 <= tracks <= 150
   - Anti-discography guard: single-artist share <= 50%
   - Global curator cap: max 2 playlists per curator
6. Subgenre Provenance Tracking:
   - Accumulates authentic subgenre co-presence (artist_subgenre_occurrences[artist][genre] += 1)
7. Resilient pacing, rate-limiting backoff, and atomic checkpointing.
"""

import os
import sys
import json
import time
import re
import random
import hashlib
import argparse
from collections import Counter, defaultdict
from typing import Dict, List, Optional, Tuple, Any, Set

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

from ytmusicapi import YTMusic
from sanitizer import sanitize_artist_name, split_artist_names

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

DISALLOWED_TITLE_PATTERNS = [
    re.compile(r"\bthe sound of\b", re.IGNORECASE),
    re.compile(r"\bsound of\b", re.IGNORECASE),
    re.compile(r"^intro to\b", re.IGNORECASE),
    re.compile(r"^pulse of\b", re.IGNORECASE),
    re.compile(r"^edge of\b", re.IGNORECASE),
]

def normalize_artist_id(name: str, channel_id: Optional[str] = None) -> str:
    """Creates a deterministic, unique identifier for an artist."""
    if channel_id and channel_id.strip():
        return f"yt_{channel_id.strip()}"
    clean = name.strip().lower()
    return f"name_{hashlib.md5(clean.encode('utf-8')).hexdigest()[:12]}"

def is_system_or_algorithmic_playlist(title: str, author_name: str, author_id: str, browse_id: str) -> bool:
    """Rejects algorithmic, auto-generated, system, or 'Sound of' playlists."""
    t_clean = title.lower().strip()
    a_clean = author_name.lower().strip()
    b_clean = browse_id.lower().strip()

    if a_clean in SYSTEM_AUTHORS:
        return True
    if any(token in b_clean for token in DISALLOWED_TOKENS):
        return True
    if any(token in t_clean for token in DISALLOWED_TOKENS):
        return True
    for pattern in DISALLOWED_TITLE_PATTERNS:
        if pattern.search(t_clean):
            return True
    return False

def load_preexisting_cache(all_known_genres: List[str]) -> Tuple[List[Dict], Dict[str, Dict[str, int]], Dict[str, int]]:
    """Loads existing crawled playlists cache with strictly authentic taxonomy matching (zero hardcoding)."""
    if not os.path.exists(CACHE_FILE):
        return [], {}, {}
    try:
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            print(f"Found {len(data)} pre-cached playlists in {CACHE_FILE}.")
    except Exception as e:
        print(f"Warning: Could not read pre-cached playlists: {e}")
        return [], {}, {}

    loaded_playlists = []
    occ_map = defaultdict(lambda: defaultdict(int))
    seen_authors = Counter()

    for pl_id, pl_data in data.items():
        title = pl_data.get("title", "")
        t_lower = title.lower()

        # Reject sound of or algorithmic titles
        if any(p.search(t_lower) for p in DISALLOWED_TITLE_PATTERNS):
            continue

        raw_artists = pl_data.get("artists", [])
        if not (10 <= len(raw_artists) <= 150):
            continue

        # Anti-discography check: max single-artist share <= 50%
        freq = Counter(raw_artists)
        if not freq or (max(freq.values()) / float(len(raw_artists))) > 0.50:
            continue

        author_id = pl_data.get("author_id") or f"cached_{pl_id}"
        if seen_authors[author_id] >= 2:
            continue

        # Match genre purely from EveryNoise taxonomy (longest match first, zero hardcoded artist overrides)
        pl_genre = None
        for g_name in all_known_genres:
            if g_name in t_lower:
                pl_genre = g_name
                break

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
                seen_in_pl.add(clean_name)

        if len(track_items) >= 10:
            if pl_genre:
                for clean_name in seen_in_pl:
                    occ_map[clean_name][pl_genre] += 1

            seen_authors[author_id] += 1
            loaded_playlists.append({
                "id": pl_id,
                "title": title,
                "author": "Community Curator",
                "author_id": author_id,
                "genre": pl_genre or "general",
                "tracks": track_items
            })

    return loaded_playlists, occ_map, seen_authors

def load_checkpoint() -> Tuple[List[Dict], Dict[str, Dict[str, int]], Dict[str, int], Set[str]]:
    """Loads existing harvesting state, sanitizing against legacy 'Sound of' or algorithmic playlists."""
    if not os.path.exists(STATE_FILE) or not os.path.exists(PLAYLISTS_FILE) or not os.path.exists(OCCURRENCES_FILE):
        return [], {}, {}, set()

    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            state = json.load(f)
        with open(PLAYLISTS_FILE, "r", encoding="utf-8") as f:
            raw_playlists = json.load(f)

        # Sanitize against any legacy "The Sound of" or system playlists
        valid_playlists = []
        occ_map = defaultdict(lambda: defaultdict(int))
        seen_authors = Counter()

        for pl in raw_playlists:
            title = pl.get("title", "")
            author = pl.get("author", "")
            author_id = pl.get("author_id", "")
            browse_id = pl.get("id", "")
            genre = pl.get("genre", "general")
            tracks = pl.get("tracks", [])

            if is_system_or_algorithmic_playlist(title, author, author_id, browse_id):
                continue
            if not (10 <= len(tracks) <= 150):
                continue
            if seen_authors[author_id] >= 2:
                continue

            # Anti-discography check
            artist_names = [t.get("artist_name", "") for t in tracks if t.get("artist_name")]
            freq = Counter(artist_names)
            if freq and (max(freq.values()) / float(len(artist_names))) > 0.50:
                continue

            seen_authors[author_id] += 1
            valid_playlists.append(pl)
            if genre and genre != "general":
                for a_name in set(artist_names):
                    occ_map[a_name][genre] += 1

        completed_genres = set(state.get("completed_genres", []))
        # Keep completed_genres consistent
        print(f"Resuming from checkpoint: {len(completed_genres)} genres recorded, {len(valid_playlists)} valid community playlists retained ({len(raw_playlists) - len(valid_playlists)} legacy/disallowed pruned).")
        return valid_playlists, occ_map, dict(seen_authors), completed_genres
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

def main():
    parser = argparse.ArgumentParser(description="Stage 2: Authentic Multi-Subgenre Community Playlist Harvesting.")
    parser.add_argument("--limit-genres", type=int, default=None, help="Limit number of genres to crawl in this run")
    parser.add_argument("--playlists-per-genre", type=int, default=20, help="Candidate playlists to check per genre (default: 20)")
    parser.add_argument("--max-accepted-per-genre", type=int, default=10, help="Max qualifying playlists to accept per genre (default: 10)")
    parser.add_argument("--rate-limit", type=float, default=2.5, help="Max requests per second for YTM (default: 2.5)")
    parser.add_argument("--use-cache", action="store_true", default=True, help="Incorporate pre-existing crawled playlist cache")
    parser.add_argument("--fresh", action="store_true", help="Start fresh without loading existing checkpoint")
    args = parser.parse_args()

    if not os.path.exists(GENRES_FILE):
        raise FileNotFoundError(f"Missing {GENRES_FILE}. Please run 00_harvest_genres.py first.")

    with open(GENRES_FILE, "r", encoding="utf-8") as f:
        genres_data = json.load(f)

    if args.limit_genres:
        genres_data = genres_data[:args.limit_genres]

    print("=" * 70)
    print(f" STAGE 2: AUTHENTIC USER COMMUNITY PLAYLIST HARVESTING ({len(genres_data)} genres queued)")
    print(f" Target: Checking at least {args.playlists_per_genre} community playlists per genre")
    print(f" Equal Analysis: Every subgenre processed through identical quality pipeline")
    print("=" * 70)
    start_time = time.time()

    if args.fresh:
        playlists, occurrences, seen_authors, completed_genres = [], {}, {}, set()
    else:
        playlists, occurrences, seen_authors, completed_genres = load_checkpoint()

    occ_map = defaultdict(lambda: defaultdict(int))
    for a_name, g_counts in occurrences.items():
        for g, c in g_counts.items():
            occ_map[a_name][g] = c

    existing_playlist_ids = {p["id"] for p in playlists}
    all_known_genres = sorted([g["genre"] for g in genres_data], key=lambda x: len(x), reverse=True)

    # 1. Ingest qualified offline cache if requested
    if args.use_cache and not playlists:
        cached_pl, cached_occ, cached_auth = load_preexisting_cache(all_known_genres)
        for pl in cached_pl:
            if pl["id"] not in existing_playlist_ids:
                playlists.append(pl)
                existing_playlist_ids.add(pl["id"])
        for a_name, g_map in cached_occ.items():
            for g, count in g_map.items():
                occ_map[a_name][g] += count
        for a_id, count in cached_auth.items():
            seen_authors[a_id] = seen_authors.get(a_id, 0) + count
        print(f"Incorporated {len(playlists)} qualifying user playlists from offline cache.")

    # 2. YouTube Music Community Playlist Harvesting
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

    for g_idx, g_info in enumerate(genres_data):
        genre = g_info["genre"]
        if genre in completed_genres:
            continue

        search_queries = [
            g_info.get("primary_query", f"{genre} playlist"),
            g_info.get("secondary_query", f"{genre} mix"),
            g_info.get("tertiary_query", f"best of {genre}")
        ]

        # Gather at least args.playlists_per_genre candidate playlists across queries
        candidates = []
        seen_cand_ids = set()

        for q in search_queries:
            if len(candidates) >= args.playlists_per_genre:
                break
            try:
                pace_request()
                needed_cands = max(10, args.playlists_per_genre - len(candidates))
                results = yt.search(q, filter="playlists", limit=needed_cands)
                for item in results or []:
                    bid = item.get("browseId")
                    if bid and bid not in seen_cand_ids and bid not in existing_playlist_ids:
                        candidates.append(item)
                        seen_cand_ids.add(bid)
            except Exception as e:
                err_str = str(e).lower()
                if "429" in err_str or "quota" in err_str:
                    print(f"  YTM 429 rate limit hit at genre '{genre}'. Backing off for 15s...")
                    time.sleep(15.0)
                break

        accepted_for_genre = 0
        for cand in candidates:
            if accepted_for_genre >= args.max_accepted_per_genre:
                break

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

            # 1. System, Algorithmic & "Sound of" Guard
            if is_system_or_algorithmic_playlist(title, author_name, author_id, browse_id):
                continue

            # 2. Global Author Cap (seen_authors < 2)
            if seen_authors.get(author_id, 0) >= 2:
                continue

            # 3. Full Tracklist Ingestion
            try:
                pace_request()
                pl_details = yt.get_playlist(browse_id, limit=150)
            except Exception:
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

            # 6. Passed all filters: record tracks & subgenre occurrences
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

        completed_genres.add(genre)
        completed_genre_list.append(genre)
        genres_processed_in_run += 1

        if genres_processed_in_run % 20 == 0:
            print(f"  Progress: [{len(completed_genre_list)}/{len(genres_data)}] genres processed ({len(playlists)} user playlists collected). Saving state...")
            save_checkpoint(playlists, occ_map, seen_authors, completed_genre_list)

    # Final checkpoint save
    save_checkpoint(playlists, occ_map, seen_authors, completed_genre_list)
    print(f"\nStage 2 completed in {time.time() - start_time:.2f}s!")
    print(f"Total surviving authentic playlists: {len(playlists)}")
    print(f"Total tracked artists with provenance tags: {len(occ_map)}")
    print("=" * 70)

if __name__ == "__main__":
    main()
