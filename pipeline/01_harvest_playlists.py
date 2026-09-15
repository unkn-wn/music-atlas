"""
Stage 1: Authentic Multi-Subgenre Community Playlist Harvesting.
Harvests public user-created playlists from YouTube Music across all EveryNoise subgenres equally.
Implements:
1. Equal Analysis Across All Subgenres: No hardcoded artists, promo keyword overrides, or subgenre favoritism.
2. Hybrid 2-Tier Harvesting:
   - Tier 1: Direct search for "{genre} playlist" (with fallback to bare "{genre}" if < 6 results) via filter="community_playlists" (target: up to 12 playlists).
   - Tier 2: Collaborative expansion via Song Recommendations (target: up to 8 playlists).
3. Anchor Track Selection with Catalog Release Qualification Guard:
   - Consensus frequency ranking across direct playlists.
   - Must be an official catalog release (not a raw user video upload lacking recommendation shelves).
   - Strict Diversity: max 1 track per artist.
4. System & Algorithmic Guard:
   - Rejects system authors ("YouTube Music", "Spotify", "Various Artists - Topic", etc.)
   - Rejects algorithmic mixes ("RDCLAK...", "My Supermix", "Supermix", rdampl)
   - Rejects "Sound of" / auto-generated titles
5. Quality & Anti-Discography Filters:
   - Tracklist boundary strictly 10 <= tracks <= 150
   - Anti-discography guard: single-artist share <= 50%
   - Global curator cap: max 2 playlists per curator ID
6. Intra-Playlist Multi-Prefix Principle:
   - Mathematically detects uploader/curator channels having >= 2 distinct "Artist - Title" prefixes.
   - Extracts true recording artist candidate from prefix without hardcoded keyword lists.
7. Zero External API Calls in Stage 01 (Runs purely on YouTube Music; iTunes verification is deferred to Stage 02).
8. Atomic checkpointing every 5 subgenres.
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
from tqdm import tqdm
from sanitizer import sanitize_artist_name, split_artist_names

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(PIPELINE_DIR, "output")
os.makedirs(OUTPUT_DIR, exist_ok=True)

GENRES_FILE = os.path.join(OUTPUT_DIR, "everynoise_ranked_genres.json")
PLAYLISTS_FILE = os.path.join(OUTPUT_DIR, "harvested_playlists.json")
OCCURRENCES_FILE = os.path.join(OUTPUT_DIR, "artist_subgenre_occurrences.json")
STATE_FILE = os.path.join(OUTPUT_DIR, "harvest_state.json")

SYSTEM_AUTHORS = {
    "youtube music", "spotify", "various artists - topic", "youtube", "music", "vevo"
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
    if channel_id and channel_id.strip() and channel_id.startswith("UC"):
        return f"yt_{channel_id.strip()}"
    clean = name.strip().lower()
    return f"name_{hashlib.md5(clean.encode('utf-8')).hexdigest()[:12]}"

def is_system_or_algorithmic_playlist(title: str, author_name: str, author_id: str, browse_id: str) -> bool:
    """Rejects algorithmic, auto-generated, system, or 'Sound of' playlists."""
    t_clean = (title or "").lower().strip()
    a_clean = (author_name or "").lower().strip()
    b_clean = (browse_id or "").strip()

    # Algorithmic shelf mixes start with RDCLAK
    if b_clean.startswith("RDCLAK") or "rdclak" in b_clean.lower():
        return True
    if a_clean in SYSTEM_AUTHORS:
        return True
    if any(token in b_clean.lower() for token in DISALLOWED_TOKENS):
        return True
    if any(token in t_clean for token in DISALLOWED_TOKENS):
        return True
    for pattern in DISALLOWED_TITLE_PATTERNS:
        if pattern.search(t_clean):
            return True
    return False

def analyze_uploader_channels(raw_tracks: List[Dict]) -> Set[str]:
    """
    Intra-Playlist Multi-Prefix Principle:
    Analyzes all tracks in a playlist to detect uploader/curator channels.
    If a channel uploads tracks with >= 2 distinct title prefixes ('Artist - Title')
    that do not match the channel's own name, that channel is 100% an uploader channel.
    """
    channel_prefixes = defaultdict(set)
    for t in raw_tracks:
        artists_list = t.get("artists") or []
        channel_name = artists_list[0].get("name", "").strip().lower() if artists_list and isinstance(artists_list[0], dict) else ""
        title = t.get("title") or ""
        if " - " in title and channel_name:
            prefix = title.split(" - ")[0].strip().lower()
            if prefix and prefix != channel_name:
                channel_prefixes[channel_name].add(prefix)

    uploader_channels = set()
    for ch, prefixes in channel_prefixes.items():
        if len(prefixes) >= 2:
            uploader_channels.add(ch)
    return uploader_channels

def extract_track_artist(track: Dict, uploader_channels: Set[str]) -> Tuple[str, Optional[str]]:
    """
    Extracts the authentic candidate artist name and channel ID from a track.
    If the uploader is a detected curator/label, extracts the true artist from the title prefix.
    """
    artists_list = track.get("artists") or []
    primary_channel_name = artists_list[0].get("name", "").strip() if artists_list else ""
    channel_id = artists_list[0].get("id") if artists_list else None
    title = track.get("title", "")

    clean_ch = primary_channel_name.lower().strip()
    if clean_ch in uploader_channels and " - " in title:
        prefix = title.split(" - ")[0].strip()
        # Clean prefix from numbering like '01. Artist' or '01 - Artist'
        prefix = re.sub(r"^\d+[\.\-_–—]+\s*", "", prefix).strip()
        if len(prefix) > 1:
            return sanitize_artist_name(prefix), None

    if primary_channel_name:
        return sanitize_artist_name(primary_channel_name), channel_id

    return "", None

DISALLOWED_TRACK_PATTERNS = [
    re.compile(r"\bplaylist\b", re.IGNORECASE),
    re.compile(r"\bcompilation\b", re.IGNORECASE),
    re.compile(r"\b\d+\s*hours?\b", re.IGNORECASE),
    re.compile(r"\b\d+\s*hrs?\b", re.IGNORECASE),
    re.compile(r"\bfull album\b", re.IGNORECASE),
    re.compile(r"\bbest of 20\d\d\b", re.IGNORECASE),
    re.compile(r"\btop \d+ songs\b", re.IGNORECASE),
    re.compile(r"\bcontinuous mix\b", re.IGNORECASE),
    re.compile(r"\bdj mix\b", re.IGNORECASE),
    re.compile(r"\bdj set\b", re.IGNORECASE),
    re.compile(r"\bnonstop\b", re.IGNORECASE),
]

def parse_duration_to_seconds(dur_str: str) -> int:
    """Parses 'MM:SS' or 'HH:MM:SS' to seconds."""
    if not dur_str:
        return 0
    parts = dur_str.strip().split(":")
    try:
        if len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
        elif len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    except Exception:
        return 0
    return 0

def is_catalog_qualified(track: Dict) -> bool:
    """
    Strict Catalog Release Qualification Guard:
    Verifies that a track is an authentic, official catalog release,
    preventing 15m/1h/2h DJ mixes, video loops, and raw UGC uploads
    (which lack 'Recommended playlists' shelves) from being chosen as anchor songs.
    """
    title = track.get("title", "")
    for pat in DISALLOWED_TRACK_PATTERNS:
        if pat.search(title):
            return False

    dur_sec = track.get("duration_seconds")
    if not dur_sec and track.get("duration"):
        dur_sec = parse_duration_to_seconds(track.get("duration"))

    # Legitimate singles/tracks are between 30 seconds and 10 minutes (600s)
    if dur_sec is not None and dur_sec > 0:
        if dur_sec < 30 or dur_sec > 600:
            return False
        if dur_sec > 600 and re.search(r"\bmix\b", title, re.IGNORECASE):
            return False

    vtype = track.get("videoType", "")
    has_official_vtype = vtype in ("MUSIC_VIDEO_TYPE_ATV", "MUSIC_VIDEO_TYPE_OMV")
    album = track.get("album")
    has_album = bool(album and isinstance(album, dict) and album.get("name") and album.get("name").strip())

    if not (has_official_vtype or has_album):
        return False

    return True

def load_checkpoint() -> Tuple[List[Dict], Dict[str, Dict[str, int]], Dict[str, int], Set[str]]:
    """Loads existing harvesting state, sanitizing against legacy 'Sound of' or algorithmic playlists."""
    if not os.path.exists(STATE_FILE) or not os.path.exists(PLAYLISTS_FILE) or not os.path.exists(OCCURRENCES_FILE):
        return [], {}, {}, set()

    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            state = json.load(f)
        with open(PLAYLISTS_FILE, "r", encoding="utf-8") as f:
            raw_playlists = json.load(f)

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

            cleaned_tracks = []
            for t in tracks:
                t_title = t.get("title", "")
                if any(p.search(t_title) for p in DISALLOWED_TRACK_PATTERNS):
                    continue
                cleaned_tracks.append(t)

            if not (10 <= len(cleaned_tracks) <= 150):
                continue
            if author_id and seen_authors[author_id] >= 2 and author_id != "Community Curator":
                continue

            artist_names = [t.get("artist_name", "") for t in cleaned_tracks if t.get("artist_name")]
            freq = Counter(artist_names)
            if freq and (max(freq.values()) / float(len(artist_names))) > 0.50:
                continue

            if author_id and author_id != "Community Curator":
                seen_authors[author_id] += 1
            pl["tracks"] = cleaned_tracks
            valid_playlists.append(pl)
            if genre and genre != "general":
                for a_name in set(artist_names):
                    occ_map[a_name][genre] += 1

        seen_authors.pop("Community Curator", None)
        completed_genres = set(state.get("completed_genres", []))
        print(f"Resuming from checkpoint: {len(completed_genres)} genres recorded, {len(valid_playlists)} valid community playlists retained.")
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
        json.dump(playlists, f, indent=2, ensure_ascii=False)
    os.replace(temp_pl, PLAYLISTS_FILE)

    temp_occ = OCCURRENCES_FILE + ".tmp"
    with open(temp_occ, "w", encoding="utf-8") as f:
        json.dump(occurrences, f, indent=2, ensure_ascii=False)
    os.replace(temp_occ, OCCURRENCES_FILE)

def main():
    parser = argparse.ArgumentParser(description="Stage 1: Authentic Multi-Subgenre Community Playlist Harvesting.")
    parser.add_argument("--limit-genres", type=int, default=None, help="Limit number of genres to crawl")
    parser.add_argument("--target-playlists", type=int, default=20, help="Target qualifying playlists per genre (default: 20)")
    parser.add_argument("--tier1-limit", type=int, default=12, help="Max playlists from direct search (default: 12)")
    parser.add_argument("--max-anchors", type=int, default=8, help="Max anchor artists for Tier 2 recommendation discovery (default: 8)")
    parser.add_argument("--rate-limit", type=float, default=3.0, help="Max requests per second for YTM (default: 3.0)")
    parser.add_argument("--fresh", action="store_true", help="Start fresh without loading existing checkpoint")
    args = parser.parse_args()

    if not os.path.exists(GENRES_FILE):
        raise FileNotFoundError(f"Missing {GENRES_FILE}. Please run 00_harvest_genres.py first.")

    with open(GENRES_FILE, "r", encoding="utf-8") as f:
        genres_data = json.load(f)

    if args.limit_genres:
        genres_data = genres_data[:args.limit_genres]

    print("=" * 70)
    print(f" STAGE 1: AUTHENTIC COMMUNITY PLAYLIST HARVESTING ({len(genres_data)} genres queued)")
    print(f" Target: {args.target_playlists} qualifying community playlists per subgenre")
    print(f" Structure: Tier 1 Direct (up to {args.tier1_limit}) + Tier 2 Song Recommendations (up to {args.target_playlists - args.tier1_limit})")
    print(f" Equal Analysis: Every subgenre processed through identical quality pipeline")
    print("=" * 70)
    start_time = time.time()

    if args.fresh:
        playlists, occurrences, seen_authors, completed_genres = [], {}, {}, set()
        for fpath in [STATE_FILE, PLAYLISTS_FILE, OCCURRENCES_FILE]:
            if os.path.exists(fpath):
                try:
                    os.remove(fpath)
                except Exception:
                    pass
        print("Fresh run requested: Cleared previous checkpoints.")
    else:
        playlists, occurrences, seen_authors, completed_genres = load_checkpoint()

    occ_map = defaultdict(lambda: defaultdict(int))
    for a_name, g_counts in occurrences.items():
        for g, c in g_counts.items():
            occ_map[a_name][g] = c

    existing_playlist_ids = {p["id"] for p in playlists}
    existing_genre_counts = Counter(p.get("genre") for p in playlists)
    existing_genre_tracks = defaultdict(list)
    for p in playlists:
        g = p.get("genre")
        if g:
            for t in p.get("tracks", []):
                if t.get("videoId"):
                    existing_genre_tracks[g].append(t)

    # A genre is only completed if it meets or exceeds the current target_playlists
    completed_genres = {g for g in completed_genres if existing_genre_counts[g] >= args.target_playlists}
    completed_genre_list = list(completed_genres)

    yt = YTMusic()
    min_interval = 1.0 / max(0.5, args.rate_limit)
    last_req_time = 0.0

    def pace_request():
        nonlocal last_req_time
        elapsed = time.time() - last_req_time
        jitter = random.uniform(0.1, 0.25)
        needed = (min_interval + jitter) - elapsed
        if needed > 0:
            time.sleep(needed)
        last_req_time = time.time()

    def fetch_playlist_safely(bid: str) -> Optional[Dict]:
        """Fetches playlist details with exponential backoff on rate limits."""
        for retry in range(3):
            try:
                pace_request()
                return yt.get_playlist(bid, limit=150)
            except Exception as e:
                err_str = str(e).lower()
                if "429" in err_str or "quota" in err_str or "rate" in err_str:
                    cooldown = 10.0 * (2 ** retry) + random.uniform(1.0, 3.0)
                    time.sleep(cooldown)
                else:
                    return None
        return None

    def process_and_validate_playlist(raw_pl: Dict, browse_id: str, genre: str, author_name: str, author_id: str) -> Optional[Dict]:
        """Validates track count, anti-discography, detects uploaders, and parses tracks."""
        title = raw_pl.get("title", "")
        if is_system_or_algorithmic_playlist(title, author_name, author_id, browse_id):
            return None

        raw_tracks = raw_pl.get("tracks", [])
        if not (10 <= len(raw_tracks) <= 150):
            return None

        uploader_channels = analyze_uploader_channels(raw_tracks)

        parsed_tracks = []
        track_artist_names = []
        for t in raw_tracks:
            t_title = t.get("title", "")
            if any(p.search(t_title) for p in DISALLOWED_TRACK_PATTERNS):
                continue
            dur_sec = t.get("duration_seconds")
            if not dur_sec and t.get("duration"):
                dur_sec = parse_duration_to_seconds(t.get("duration"))
            if dur_sec is not None and dur_sec > 600:
                continue

            clean_name, channel_id = extract_track_artist(t, uploader_channels)
            if not clean_name:
                continue
            canonical_id = normalize_artist_id(clean_name, channel_id)
            parsed_tracks.append({
                "videoId": t.get("videoId", ""),
                "title": t_title,
                "artist_name": clean_name,
                "artist_id": canonical_id,
                "channel_id": channel_id or "",
                "is_qualified": is_catalog_qualified(t)
            })
            track_artist_names.append(clean_name)

        if len(parsed_tracks) < 10:
            return None

        # Anti-discography guard: max artist share <= 50%
        freq = Counter(track_artist_names)
        if (max(freq.values()) / float(len(track_artist_names))) > 0.50:
            return None

        return {
            "id": browse_id,
            "title": title,
            "author": author_name,
            "author_id": author_id,
            "genre": genre,
            "tracks": parsed_tracks
        }

    genres_processed_in_run = 0
    genre_pbar = tqdm(genres_data, desc="Harvesting Subgenres", unit="genre")

    for g_info in genre_pbar:
        genre = g_info["genre"]
        existing_count = existing_genre_counts[genre]
        if existing_count >= args.target_playlists:
            if genre not in completed_genres:
                completed_genres.add(genre)
                completed_genre_list.append(genre)
            continue

        genre_pbar.set_postfix({"genre": genre[:16], "total_pl": len(playlists), "genre_pl": existing_count})
        accepted_for_genre = existing_count
        direct_tracks_for_anchors = list(existing_genre_tracks[genre])

        # =====================================================================
        # TIER 1: Direct Community Search ("{genre} playlist" -> fallback bare)
        # =====================================================================
        if accepted_for_genre < args.tier1_limit:
            primary_query = f"{genre} playlist"
            direct_candidates = []
            seen_cand_ids = set()

            for q in [primary_query, genre]:
                if len(direct_candidates) >= 15:
                    break
                for retry in range(2):
                    try:
                        pace_request()
                        results = yt.search(q, filter="community_playlists", limit=20)
                        for item in results or []:
                            bid = item.get("browseId")
                            if bid and bid not in seen_cand_ids and bid not in existing_playlist_ids:
                                direct_candidates.append(item)
                                seen_cand_ids.add(bid)
                        break
                    except Exception:
                        time.sleep(1.0)

            for cand in direct_candidates:
                if accepted_for_genre >= args.tier1_limit or accepted_for_genre >= args.target_playlists:
                    break

                bid = cand.get("browseId")
                if not bid or bid in existing_playlist_ids:
                    continue

                author = cand.get("author") or {}
                author_name = author.get("name", "") if isinstance(author, dict) else str(author)
                author_id = author.get("id") or author_name if isinstance(author, dict) else author_name
                if not author_id:
                    author_id = f"anon_{bid[:8]}"

                if seen_authors.get(author_id, 0) >= 2:
                    continue

                pl_data = fetch_playlist_safely(bid)
                if not pl_data:
                    continue

                valid_pl = process_and_validate_playlist(pl_data, bid, genre, author_name, author_id)
                if valid_pl:
                    seen_authors[author_id] = seen_authors.get(author_id, 0) + 1
                    existing_playlist_ids.add(bid)
                    playlists.append(valid_pl)
                    accepted_for_genre += 1
                    existing_genre_counts[genre] += 1

                    for t in valid_pl["tracks"]:
                        occ_map[t["artist_name"]][genre] += 1
                        if t.get("videoId"):
                            direct_tracks_for_anchors.append(t)
                            existing_genre_tracks[genre].append(t)

        # =====================================================================
        # TIER 2: Collaborative Expansion via Song Recommendations
        # =====================================================================
        needed_tier2 = args.target_playlists - accepted_for_genre
        if needed_tier2 > 0 and direct_tracks_for_anchors:
            # 1. Consensus Frequency Ranking
            track_counts = Counter(
                (t.get("videoId", ""), t.get("artist_name", ""), t.get("title", ""), t.get("is_qualified", False))
                for t in direct_tracks_for_anchors
            )

            # 2. Select Diverse, Catalog-Qualified Anchors (1 Track per Artist)
            anchors = []
            seen_anchor_artists = set()

            # First pass: qualified catalog releases
            for (vid, art, title, qualified), count in track_counts.most_common():
                art_low = art.lower().strip()
                if qualified and art_low not in seen_anchor_artists and len(art_low) > 1:
                    anchors.append({"videoId": vid, "artist": art, "title": title})
                    seen_anchor_artists.add(art_low)
                    if len(anchors) >= args.max_anchors:
                        break

            # Fallback pass if needed
            if len(anchors) < args.max_anchors:
                for (vid, art, title, qualified), count in track_counts.most_common():
                    art_low = art.lower().strip()
                    if art_low not in seen_anchor_artists and len(art_low) > 1:
                        anchors.append({"videoId": vid, "artist": art, "title": title})
                        seen_anchor_artists.add(art_low)
                        if len(anchors) >= args.max_anchors:
                            break

            # 3. Query Recommendations for Anchors
            for a in anchors:
                if accepted_for_genre >= args.target_playlists:
                    break

                try:
                    pace_request()
                    watch = yt.get_watch_playlist(videoId=a["videoId"], limit=5)
                    rel_token = watch.get("related")
                    if not rel_token:
                        continue

                    pace_request()
                    related = yt.get_song_related(rel_token)
                    rec_pl_items = []
                    for shelf in related or []:
                        shelf_title = shelf.get("title", "").lower()
                        if "playlist" in shelf_title:
                            for item in shelf.get("contents", []):
                                pl_id = item.get("browseId") or item.get("playlistId")
                                if pl_id and (pl_id.startswith("PL") or pl_id.startswith("VLPL")):
                                    rec_pl_items.append(item)

                    for r_item in rec_pl_items:
                        if accepted_for_genre >= args.target_playlists:
                            break

                        r_bid = r_item.get("browseId") or r_item.get("playlistId")
                        if not r_bid or r_bid in existing_playlist_ids:
                            continue

                        r_pl_data = fetch_playlist_safely(r_bid)
                        if not r_pl_data:
                            continue

                        r_author_obj = r_pl_data.get("author") or {}
                        if isinstance(r_author_obj, dict):
                            r_author_name = r_author_obj.get("name", "")
                            r_author_id = r_author_obj.get("id") or r_author_name or f"anon_{r_bid[:8]}"
                        else:
                            r_author_name = str(r_author_obj)
                            r_author_id = r_author_name or f"anon_{r_bid[:8]}"

                        if seen_authors.get(r_author_id, 0) >= 2:
                            continue

                        r_valid_pl = process_and_validate_playlist(r_pl_data, r_bid, genre, r_author_name, r_author_id)
                        if r_valid_pl:
                            seen_authors[r_author_id] = seen_authors.get(r_author_id, 0) + 1
                            existing_playlist_ids.add(r_bid)
                            playlists.append(r_valid_pl)
                            accepted_for_genre += 1
                            existing_genre_counts[genre] += 1

                            for t in r_valid_pl["tracks"]:
                                occ_map[t["artist_name"]][genre] += 1
                                if t.get("videoId"):
                                    existing_genre_tracks[genre].append(t)
                except Exception:
                    continue

        completed_genres.add(genre)
        completed_genre_list.append(genre)
        genres_processed_in_run += 1

        if genres_processed_in_run % 5 == 0:
            save_checkpoint(playlists, occ_map, seen_authors, completed_genre_list)

    save_checkpoint(playlists, occ_map, seen_authors, completed_genre_list)
    print(f"\nStage 1 completed in {time.time() - start_time:.2f}s!")
    print(f"Total surviving authentic playlists: {len(playlists)}")
    print(f"Total tracked artists with provenance tags: {len(occ_map)}")
    print("=" * 70)

if __name__ == "__main__":
    main()
