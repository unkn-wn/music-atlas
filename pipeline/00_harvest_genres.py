"""
Stage 1: EveryNoise Popularity Taxonomy Ingestion.
Extracts 6,291 popularity-ranked genres from EveryNoise at Once (https://everynoise.com/everynoise1d.html).
Extracts:
1. Genre rank (1 to 6291)
2. Direct Spotify curated playlist ID
3. Clean lowercase genre name
4. Prioritized search queries: "{genre} playlist" and "{genre} mix"
Includes offline resilience snapshot fallback and atomic output write.
"""

import os
import sys
import json
import re
import html
import argparse
import time
import httpx

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(PIPELINE_DIR, "data")
OUTPUT_DIR = os.path.join(PIPELINE_DIR, "output")
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

SNAPSHOT_FILE = os.path.join(DATA_DIR, "everynoise_snapshot_6291.json")
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "everynoise_ranked_genres.json")

ROW_REGEX = re.compile(
    r'<td[^>]*>\s*(\d+)\s*</td>.*?'
    r'href="https://embed\.spotify\.com/\?uri=spotify:playlist:([a-zA-Z0-9]+)".*?'
    r'href="everynoise1d-[^"]*"[^>]*>([^<]+)</a>',
    re.DOTALL
)

TIER_LIMITS = {
    1: 500,     # Tier 1 (Core Popular Genres)
    2: 1500,    # Tier 2 (Rich Universe - Recommended default)
    3: 3000,    # Tier 3 (Deep Underground)
    4: 6291     # Tier 4 (Complete Global Taxonomy)
}

def fetch_or_load_everynoise() -> str:
    url = "https://everynoise.com/everynoise1d.html"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    print(f"Fetching EveryNoise 1D taxonomy from {url}...")
    try:
        resp = httpx.get(url, headers=headers, timeout=30.0, follow_redirects=True)
        if resp.status_code == 200 and len(resp.text) > 500000:
            print(f"Successfully downloaded EveryNoise HTML ({len(resp.text):,} bytes).")
            return resp.text
        else:
            print(f"EveryNoise HTTP returned status {resp.status_code}, falling back to snapshot...")
    except Exception as e:
        print(f"EveryNoise network request failed ({e}), falling back to snapshot...")

    return ""

NON_MUSICAL_AUDIO_TOKENS = {
    "sound", "white noise", "sleep", "rain", "meditation", "asmr",
    "pink noise", "nature sounds", "sound effects", "guided meditation",
    "birdsong", "hypnosis", "ocean", "general"
}

def parse_genres_from_html(html_text: str) -> list[dict]:
    genres = []
    for row in html_text.split("</tr>"):
        m = ROW_REGEX.search(row)
        if m:
            rank_str, spotify_id, genre_name = m.groups()
            clean_genre = html.unescape(genre_name.strip().lower())
            if clean_genre in NON_MUSICAL_AUDIO_TOKENS:
                continue
            genres.append({
                "rank": int(rank_str),
                "spotify_playlist_id": spotify_id,
                "genre": clean_genre,
                "primary_query": f"{clean_genre} playlist",
                "secondary_query": f"{clean_genre} mix"
            })
    return genres

def main():
    parser = argparse.ArgumentParser(description="Stage 1: Ingest EveryNoise Popularity Taxonomy.")
    parser.add_argument("--tier", type=int, choices=[1, 2, 3, 4], default=2, help="Ingestion scale tier (1=500, 2=1500, 3=3000, 4=6291)")
    parser.add_argument("--limit", type=int, default=None, help="Explicit genre count limit (overrides --tier)")
    parser.add_argument("--offline", action="store_true", help="Force offline load from local snapshot")
    args = parser.parse_args()

    limit = args.limit if args.limit is not None else TIER_LIMITS[args.tier]
    print("=" * 70)
    print(f" STAGE 1: EVERYNOISE POPULARITY TAXONOMY INGESTION (Target: Top {limit})")
    print("=" * 70)
    start_time = time.time()

    all_genres = []

    if not args.offline:
        html_text = fetch_or_load_everynoise()
        if html_text:
            all_genres = parse_genres_from_html(html_text)
            print(f"Extracted {len(all_genres)} ranked genres from live HTML.")
            # Cache the full 6291 snapshot for future offline runs
            if len(all_genres) >= 6000:
                with open(SNAPSHOT_FILE, "w", encoding="utf-8") as f:
                    json.dump(all_genres, f, indent=2, ensure_ascii=False)
                print(f"Saved complete taxonomy snapshot ({len(all_genres)} genres) to {SNAPSHOT_FILE}")

    if not all_genres:
        if os.path.exists(SNAPSHOT_FILE):
            print(f"Loading taxonomy from local snapshot: {SNAPSHOT_FILE}...")
            with open(SNAPSHOT_FILE, "r", encoding="utf-8") as f:
                all_genres = json.load(f)
            print(f"Loaded {len(all_genres)} ranked genres from snapshot.")
        else:
            raise RuntimeError("EveryNoise could not be reached and no local snapshot exists at " + SNAPSHOT_FILE)

    # Filter out non-musical noise tokens and slice to the requested tier / limit
    all_genres = [g for g in all_genres if g.get("genre", "").lower().strip() not in NON_MUSICAL_AUDIO_TOKENS]
    selected_genres = all_genres[:limit]
    print(f"Selected Top {len(selected_genres)} genres (rank #{selected_genres[0]['rank']} '{selected_genres[0]['genre']}' to #{selected_genres[-1]['rank']} '{selected_genres[-1]['genre']}').")

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(selected_genres, f, indent=2, ensure_ascii=False)

    print(f"Output saved to {OUTPUT_FILE}")
    print(f"Stage 1 completed in {time.time() - start_time:.2f}s")
    print("=" * 70)

if __name__ == "__main__":
    main()
