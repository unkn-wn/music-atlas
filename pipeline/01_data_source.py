"""
Step 1: Data Ingestion & Bipartite Playlist-Artist Generation.
Supports:
1. Real Spotify MPD (Million Playlist Dataset) slice JSON files from 'data/mpd/'
2. High-fidelity realistic playlist simulator that models real Spotify co-occurrence,
   cross-genre bridges, and power-law listening distributions across all continents.
"""

import os
import json
import glob
import random
from typing import List, Dict, Tuple, Set
from collections import defaultdict, Counter
DATA_DIR = os.path.join(os.path.dirname(__file__), "data", "mpd")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")
os.makedirs(OUTPUT_DIR, exist_ok=True)

def get_all_catalog_artists() -> List[Dict]:
    """Loads catalog artists from pipeline/output/artists_catalog.json."""
    catalog_path = os.path.join(OUTPUT_DIR, "artists_catalog.json")
    if not os.path.exists(catalog_path):
        raise FileNotFoundError(
            f"Missing {catalog_path}. Please run 00_harvest_artists.py to generate the artist catalog."
        )
    with open(catalog_path, "r", encoding="utf-8") as f:
        return json.load(f)


def ingest_from_mpd(mpd_files: List[str], catalog_artists: List[Dict], top_n: int = 5000) -> Tuple[List[Tuple[int, str]], List[Dict]]:
    """
    Parses real Spotify Million Playlist Dataset JSON slices.
    Extracts (playlist_id, canonical_artist_id) pairs for top artists.
    """
    print(f"Ingesting real MPD slices from {len(mpd_files)} files...")
    from collections import Counter
    artist_freq = Counter()
    playlists_raw = []

    for fpath in mpd_files:
        with open(fpath, 'r', encoding='utf-8') as f:
            data = json.load(f)
            for pl in data.get("playlists", []):
                pl_id = pl.get("pid", random.randint(100000, 999999))
                # Get unique artists in this playlist
                pl_artists = {t.get("artist_name") for t in pl.get("tracks", []) if t.get("artist_name")}
                for a in pl_artists:
                    artist_freq[a] += 1
                playlists_raw.append((pl_id, list(pl_artists)))

    # Select top N artists
    top_artists = [name for name, _ in artist_freq.most_common(top_n)]
    print(f"Selected Top {len(top_artists)} artists from MPD.")

    # Match or create IDs
    name_to_id = {a["name"].lower(): a["id"] for a in catalog_artists}
    updated_catalog = list(catalog_artists)

    for a_name in top_artists:
        if a_name.lower() not in name_to_id:
            new_id = f"mpd_{abs(hash(a_name)) % 1000000}"
            name_to_id[a_name.lower()] = new_id
            updated_catalog.append({
                "id": new_id,
                "name": a_name,
                "macro_genre": "Pop",
                "genres": ["pop"],
                "popularity": min(95, 50 + int(artist_freq[a_name] / 10)),
                "followers": artist_freq[a_name] * 1000
            })

    pairs = []
    top_artists_set = set(top_artists)
    for pl_id, pl_artists in playlists_raw:
        for a in pl_artists:
            if a in top_artists_set:
                pairs.append((pl_id, name_to_id[a.lower()]))

    return pairs, updated_catalog

def generate_high_fidelity_playlists(artists: List[Dict], num_playlists: int = 20000) -> List[Tuple[int, str]]:
    """
    Generates a realistic co-occurrence dataset modeling Spotify curation patterns:
    - Intra-continent deep playlists (e.g. Pure Hip-Hop, Indie Dreamers, Tech House, Pop Anthems)
    - High-density cross-genre bridge playlists mirroring real listening crossover:
      * Hip-Hop <-> R&B, Pop, Latin, Rock
      * Pop <-> EDM, Indie, R&B, Latin, Country
      * Rock <-> Indie, Metal, Pop-Punk
      * Country <-> Pop, Indie, Americana
      * K-Pop <-> Pop, EDM
      * Afrobeats <-> Pop, R&B, Hip-Hop, Dancehall
    - Popularity-weighted sampling (superstars appear frequently, with natural power-law tails)
    """
    random.seed(42)
    by_macro = {}
    for a in artists:
        mg = a.get("macro_genre", "Pop")
        by_macro.setdefault(mg, []).append(a)

    # Cross-genre bridge definitions with realistic weights
    bridges = [
        ("Hip-Hop / Rap", "R&B / Soul", 0.70),
        ("Pop", "R&B / Soul", 0.60),
        ("Pop", "EDM / Electronic", 0.65),
        ("Pop", "Indie / Alternative", 0.60),
        ("Rock / Metal", "Indie / Alternative", 0.65),
        ("Latin / Reggaeton", "Pop", 0.55),
        ("Latin / Reggaeton", "Hip-Hop / Rap", 0.45),
        ("Country / Folk", "Pop", 0.45),
        ("Country / Folk", "Indie / Alternative", 0.50),
        ("Country / Folk", "Hip-Hop / Rap", 0.35),
        ("K-Pop", "Pop", 0.65),
        ("K-Pop", "R&B / Soul", 0.45),
        ("Afrobeats / Dancehall", "Pop", 0.50),
        ("Afrobeats / Dancehall", "R&B / Soul", 0.55),
        ("Afrobeats / Dancehall", "Hip-Hop / Rap", 0.50),
        ("Jazz / Classical", "Indie / Alternative", 0.35),
        ("EDM / Electronic", "Indie / Alternative", 0.65),
        ("EDM / Electronic", "Hip-Hop / Rap", 0.35),
        ("Rock / Metal", "Hip-Hop / Rap", 0.30)
    ]

    pairs: List[Tuple[int, str]] = []
    playlist_id = 1

    # Map subgenres for fine-grained community coherence
    subgenre_map = defaultdict(list)
    for a in artists:
        for g in a.get("genres", []):
            subgenre_map[g].append(a)

    for _ in range(num_playlists):
        p_type = random.random()
        chosen_artists: Set[str] = set()

        if p_type < 0.40:
            # 40% Dedicated Core Macro-Genre Playlists (e.g. pure EDM, pure RapCaviar, pure Rock Classics)
            # Guarantees artists have robust, authentic relationships with their true musical peers
            genre = random.choice(list(by_macro.keys()))
            pool = by_macro[genre]
            if pool:
                k = min(len(pool), random.randint(6, 14))
                w = [a["popularity"] ** 1.3 for a in pool]
                for a in random.choices(pool, weights=w, k=k):
                    chosen_artists.add(a["id"])

        elif p_type < 0.70:
            # 30% Cross-Genre Collaboration & Bridge Playlists (vital for organic cosmic web)
            g1, g2, _ = random.choice(bridges)
            pool1 = by_macro.get(g1, [])
            pool2 = by_macro.get(g2, [])
            if pool1 and pool2:
                k1 = min(len(pool1), random.randint(4, 7))
                k2 = min(len(pool2), random.randint(4, 7))
                w1 = [a["popularity"] ** 1.3 for a in pool1]
                w2 = [a["popularity"] ** 1.3 for a in pool2]
                for a in random.choices(pool1, weights=w1, k=k1):
                    chosen_artists.add(a["id"])
                for a in random.choices(pool2, weights=w2, k=k2):
                    chosen_artists.add(a["id"])

        elif p_type < 0.85:
            # 15% Targeted Sub-genre / Niche Playlists (e.g. Dream Pop, Tech House, Melodic Trap)
            popular_subgenres = [g for g, a_list in subgenre_map.items() if len(a_list) >= 4]
            if popular_subgenres:
                subg = random.choice(popular_subgenres)
                pool = subgenre_map[subg]
                k = min(len(pool), random.randint(4, 9))
                weights = [a["popularity"] ** 1.3 for a in pool]
                for a in random.choices(pool, weights=weights, k=k):
                    chosen_artists.add(a["id"])

        else:
            # 15% Contextual Vibe & Global Chart Playlists (Workout, Late Night, Today's Top Hits)
            chart_pool = [a for a in artists if a.get("popularity", 0) >= 80]
            if chart_pool:
                k = min(len(chart_pool), random.randint(8, 16))
                w = [a["popularity"] ** 1.4 for a in chart_pool]
                for a in random.choices(chart_pool, weights=w, k=k):
                    chosen_artists.add(a["id"])

        for a_id in chosen_artists:
            pairs.append((playlist_id, a_id))
        playlist_id += 1

    return pairs

def main():
    artists = get_all_catalog_artists()
    print(f"Loaded {len(artists)} catalog artists.")

    # Save artists catalog cache
    with open(os.path.join(OUTPUT_DIR, "artists_catalog.json"), "w", encoding="utf-8") as f:
        json.dump(artists, f, indent=2)

    # Check for real MPD slice files
    mpd_files = glob.glob(os.path.join(DATA_DIR, "*.json"))
    if mpd_files:
        print(f"Found {len(mpd_files)} real MPD slice files in {DATA_DIR}.")
        pairs, artists = ingest_from_mpd(mpd_files, artists, top_n=600)
        with open(os.path.join(OUTPUT_DIR, "artists_catalog.json"), "w", encoding="utf-8") as f:
            json.dump(artists, f, indent=2)
    else:
        print("No MPD files in data/mpd/. Generating high-fidelity playlist co-occurrence simulation...")
        pairs = generate_high_fidelity_playlists(artists, num_playlists=20000)

    print(f"Total playlist-artist entries: {len(pairs)}")

    # Write out as JSON for step 2
    pairs_file = os.path.join(OUTPUT_DIR, "playlist_artist_pairs.json")
    with open(pairs_file, "w", encoding="utf-8") as f:
        json.dump(pairs, f)

    print(f"Wrote bipartite pairs to {pairs_file}")

if __name__ == "__main__":
    main()
