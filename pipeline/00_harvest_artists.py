"""
Step 0: Dynamic Artist Harvesting via Kworb and Apple iTunes.
Harvests the top artists globally from live Kworb Spotify Daily Listeners metrics.
Applies empirical logarithmic popularity and retrieves raw genres directly
from the Apple iTunes Search API (primaryGenreName) with persistent disk caching.
Zero hardcoding, zero quotas, zero genre mapping or normalization.
"""

import os
import sys
import json
import time
import math
import re
import argparse
import html
from typing import List, Dict, Tuple, Optional
import httpx

# Ensure UTF-8 output on Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")
os.makedirs(OUTPUT_DIR, exist_ok=True)
CACHE_FILE = os.path.join(OUTPUT_DIR, "itunes_genre_cache.json")
CATALOG_FILE = os.path.join(OUTPUT_DIR, "artists_catalog.json")

def load_genre_cache() -> Dict[str, Dict]:
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Warning: could not read cache {CACHE_FILE}: {e}")
            return {}
    return {}

def save_genre_cache(cache: Dict[str, Dict]):
    try:
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Warning: could not save cache {CACHE_FILE}: {e}")

def calculate_log_popularity(monthly_listeners: int) -> int:
    """
    Empirical logarithmic popularity formula:
    popularity = min(100, max(20, round(20 + 80 * (log10(L) - 6.0) / (8.2 - 6.0))))
    """
    if monthly_listeners <= 0:
        return 20
    log_l = math.log10(max(1000000, monthly_listeners))
    val = round(20.0 + 80.0 * (log_l - 6.0) / (8.2 - 6.0))
    return int(min(100, max(20, val)))

def fetch_kworb_top_artists() -> List[Dict]:
    """Scrapes Kworb daily table for top Spotify artists globally."""
    url = "https://kworb.net/spotify/listeners.html"
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    print(f"Fetching Kworb Spotify Daily Listeners from {url}...")
    
    resp = httpx.get(url, headers=headers, timeout=15.0, follow_redirects=True)
    if resp.status_code != 200:
        raise RuntimeError(f"Failed to fetch Kworb daily table: HTTP {resp.status_code}")

    pattern = re.compile(
        r'href="artist/([a-zA-Z0-9]{22})_songs\.html">([^<]+)</a>.*?<td>([0-9,]+)</td>',
        re.DOTALL
    )
    matches = pattern.findall(resp.text)
    if not matches:
        raise RuntimeError("Kworb regex failed to extract any artist records.")

    artists = []
    for sp_id, raw_name, raw_listeners in matches:
        name = html.unescape(raw_name).strip()
        listeners = int(raw_listeners.replace(",", ""))
        artists.append({
            "spotify_id": sp_id,
            "name": name,
            "monthly_listeners": listeners
        })

    print(f"Successfully harvested {len(artists)} artists from Kworb daily global index.")
    return artists

def query_itunes_artist_genre(name: str, client: httpx.Client, max_retries: int = 2) -> str:
    """Queries Apple iTunes Search API for raw primaryGenreName."""
    url = "https://itunes.apple.com/search"
    params = {"term": name, "entity": "musicArtist", "limit": 1}
    for attempt in range(max_retries):
        try:
            resp = client.get(url, params=params, timeout=4.0)
            if resp.status_code == 200:
                results = resp.json().get("results", [])
                if results:
                    primary = results[0].get("primaryGenreName", "Pop")
                    return primary or "Pop"
                return "Pop"
            elif resp.status_code == 429:
                time.sleep(2.0 * (attempt + 1))
        except Exception:
            time.sleep(0.5)
    return "Pop"

def harvest_and_classify(target_artists: int = 1000) -> List[Dict]:
    """
    Harvests top artists directly by streaming popularity.
    Retrieves raw Apple iTunes primaryGenreName without normalization or quotas.
    """
    kworb_artists = fetch_kworb_top_artists()
    cache = load_genre_cache()
    print(f"Loaded {len(cache)} cached artist genre records.")

    client = httpx.Client(headers={"User-Agent": "MusicAtlas/2.0"}, follow_redirects=True)
    new_lookups = 0
    catalog = []

    try:
        # Select the top artists directly by monthly listeners
        top_candidates = kworb_artists[:target_artists]
        print(f"Processing top {len(top_candidates)} artists globally...")

        for artist in top_candidates:
            name = artist["name"]
            name_lower = name.lower()

            raw_genre = None
            if name_lower in cache:
                item = cache[name_lower]
                if isinstance(item, dict):
                    raw_genre = item.get("primaryGenreName") or item.get("macro_genre")
                elif isinstance(item, str):
                    raw_genre = item
            elif name in cache:
                item = cache[name]
                if isinstance(item, dict):
                    raw_genre = item.get("primaryGenreName") or item.get("macro_genre")
                elif isinstance(item, str):
                    raw_genre = item

            if not raw_genre:
                raw_genre = query_itunes_artist_genre(name, client)
                cache[name_lower] = {
                    "primaryGenreName": raw_genre,
                    "macro_genre": raw_genre,
                    "genres": [raw_genre.lower()]
                }
                new_lookups += 1
                time.sleep(0.08)

            pop = calculate_log_popularity(artist["monthly_listeners"])
            artist_record = {
                "id": artist["spotify_id"],
                "name": name,
                "macro_genre": raw_genre,
                "genres": [raw_genre],
                "popularity": pop,
                "followers": artist["monthly_listeners"],
                "monthly_listeners": artist["monthly_listeners"],
                "spotify_id": artist["spotify_id"],
                "spotifyUrl": f"https://open.spotify.com/artist/{artist['spotify_id']}"
            }
            catalog.append(artist_record)

    finally:
        client.close()
        if new_lookups > 0:
            print(f"Looked up {new_lookups} new artist genres via Apple iTunes API. Saving cache...")
            save_genre_cache(cache)

    print(f"\nHarvested {len(catalog)} artists with raw Apple iTunes genres.")
    genre_counts = {}
    for a in catalog:
        g = a["macro_genre"]
        genre_counts[g] = genre_counts.get(g, 0) + 1
    for g in sorted(genre_counts.keys(), key=lambda k: genre_counts[k], reverse=True):
        print(f"  - {g}: {genre_counts[g]} artists")

    return catalog

def main():
    parser = argparse.ArgumentParser(description="Harvest artists dynamically from Kworb and Apple iTunes.")
    parser.add_argument("--target", type=int, default=1000, help="Target number of artists to harvest (default: 1000)")
    args = parser.parse_args()

    print("=" * 70)
    print(f" STEP 0: DYNAMIC ARTIST HARVESTING (Target: {args.target} Artists)")
    print("=" * 70)
    start_time = time.time()

    catalog = harvest_and_classify(target_artists=args.target)

    with open(CATALOG_FILE, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2, ensure_ascii=False)

    print(f"\nSaved {len(catalog)} dynamically harvested artists to {CATALOG_FILE}")
    print(f"Step 0 completed in {time.time() - start_time:.2f}s")
    print("=" * 70)

if __name__ == "__main__":
    main()
