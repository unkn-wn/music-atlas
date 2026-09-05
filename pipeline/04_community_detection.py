"""
Step 4: Raw Apple iTunes Genre Grouping.
Groups artists directly by their raw Apple iTunes API primaryGenreName output.
Zero hardcoding, zero quotas, zero heuristic mapping.
Assigns distinct, vibrant colors from a perceptual palette.
"""

import os
import json
from collections import defaultdict

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")

# Vibrant palette for raw Apple iTunes API genres
GENRE_PALETTE = {
    "Hip-Hop/Rap": "#10B981",          # Emerald Green
    "Pop": "#EC4899",                  # Hot Pink / Magenta
    "Alternative": "#F59E0B",          # Warm Amber / Orange
    "Dance": "#06B6D4",                # Electric Cyan
    "Electronic": "#06B6D4",           # Electric Cyan
    "Rock": "#EF4444",                 # Crimson Red
    "Hard Rock": "#EF4444",            # Crimson Red
    "Metal": "#DC2626",                # Deep Red
    "R&B/Soul": "#8B5CF6",             # Deep Violet
    "Country": "#D97706",              # Terracotta / Ochre
    "K-Pop": "#F43F5E",                # Coral Rose
    "Latin": "#EAB308",                # Sunshine Gold
    "Urbano latino": "#EAB308",        # Sunshine Gold
    "Pop Latino": "#FBBF24",           # Amber Yellow
    "Música Mexicana": "#CA8A04",      # Dark Gold
    "Música tropical": "#F59E0B",      # Orange Gold
    "Classical": "#6366F1",            # Cosmic Indigo
    "Soundtrack": "#6366F1",           # Cosmic Indigo
    "Singer/Songwriter": "#A855F7",    # Bright Purple
    "Afro-fusion": "#14B8A6",          # Bright Teal
}

PALETTE_FALLBACK = [
    "#10B981", "#EC4899", "#F59E0B", "#06B6D4", "#EF4444",
    "#8B5CF6", "#D97706", "#F43F5E", "#EAB308", "#14B8A6",
    "#6366F1", "#3B82F6", "#84CC16", "#A855F7", "#22D3EE",
    "#F97316", "#E11D48"
]

def main():
    catalog_file = os.path.join(OUTPUT_DIR, "artists_catalog.json")
    cache_file = os.path.join(OUTPUT_DIR, "itunes_genre_cache.json")

    if not os.path.exists(catalog_file):
        raise FileNotFoundError(f"Missing {catalog_file}")

    with open(catalog_file, "r", encoding="utf-8") as f:
        catalog = json.load(f)

    itunes_cache = {}
    if os.path.exists(cache_file):
        with open(cache_file, "r", encoding="utf-8") as f:
            itunes_cache = json.load(f)

    # Group artists strictly by their raw Apple iTunes primaryGenreName
    genre_to_artists = defaultdict(list)
    for a in catalog:
        item = itunes_cache.get(a["name"]) or itunes_cache.get(a["name"].lower())
        if isinstance(item, dict):
            raw_g = item.get("primaryGenreName") or a.get("macro_genre") or "Pop"
        elif isinstance(item, str):
            raw_g = item
        else:
            raw_g = a.get("macro_genre") or "Pop"
        
        raw_g = raw_g.strip() or "Pop"
        genre_to_artists[raw_g].append(a["id"])

    # Sort genres by artist count descending
    sorted_genres = sorted(genre_to_artists.keys(), key=lambda g: len(genre_to_artists[g]), reverse=True)

    continents = []
    artist_continent_map = {}

    for idx, genre_name in enumerate(sorted_genres, start=1):
        artist_ids = genre_to_artists[genre_name]
        color = GENRE_PALETTE.get(genre_name, PALETTE_FALLBACK[idx % len(PALETTE_FALLBACK)])

        continent_info = {
            "id": idx,
            "name": genre_name,
            "color": color,
            "artistCount": len(artist_ids),
            "artistIds": artist_ids
        }
        continents.append(continent_info)

        for a_id in artist_ids:
            artist_continent_map[a_id] = {
                "continentId": idx,
                "continentName": genre_name,
                "color": color
            }

    print(f"Grouped {len(catalog)} artists into {len(continents)} raw Apple iTunes genre groups:")
    for c in continents:
        print(f"  - [{c['color']}] Group #{c['id']}: {c['name']} ({c['artistCount']} artists)")

    # Save output
    out_file = os.path.join(OUTPUT_DIR, "communities.json")
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump({
            "continents": continents,
            "artist_continent_map": artist_continent_map
        }, f, indent=2)

    print(f"Step 4 complete. Saved {out_file}")

if __name__ == "__main__":
    main()
