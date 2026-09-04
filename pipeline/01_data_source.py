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
from artist_catalog import SEED_ARTISTS

DATA_DIR = os.path.join(os.path.dirname(__file__), "data", "mpd")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Additional sub-genre artists to enrich the universe to 120+ landmark artists
ADDITIONAL_ARTISTS = [
    # Hip-Hop subgenres
    {"id": "denzel_curry", "name": "Denzel Curry", "macro_genre": "Hip-Hop / Rap", "genres": ["florida rap", "underground hip hop"], "popularity": 81, "followers": 3200000},
    {"id": "jid", "name": "JID", "macro_genre": "Hip-Hop / Rap", "genres": ["atl hip hop", "conscious hip hop"], "popularity": 82, "followers": 3900000},
    {"id": "mac_miller", "name": "Mac Miller", "macro_genre": "Hip-Hop / Rap", "genres": ["hip hop", "pittsburgh rap", "rap"], "popularity": 87, "followers": 15000000},
    {"id": "juice_wrld", "name": "Juice WRLD", "macro_genre": "Hip-Hop / Rap", "genres": ["chicago rap", "melodic rap"], "popularity": 89, "followers": 31000000},
    {"id": "xxxtentacion", "name": "XXXTENTACION", "macro_genre": "Hip-Hop / Rap", "genres": ["emo rap", "miami hip hop"], "popularity": 88, "followers": 43000000},
    {"id": "post_malone", "name": "Post Malone", "macro_genre": "Hip-Hop / Rap", "genres": ["dfw rap", "melodic rap", "pop"], "popularity": 92, "followers": 44000000},
    {"id": "central_cee", "name": "Central Cee", "macro_genre": "Hip-Hop / Rap", "genres": ["uk drill", "uk hip hop"], "popularity": 85, "followers": 6100000},
    {"id": "lil_baby", "name": "Lil Baby", "macro_genre": "Hip-Hop / Rap", "genres": ["atl hip hop", "trap"], "popularity": 88, "followers": 16000000},
    {"id": "young_thug", "name": "Young Thug", "macro_genre": "Hip-Hop / Rap", "genres": ["atl hip hop", "trap"], "popularity": 86, "followers": 12000000},

    # Pop & Alt-Pop subgenres
    {"id": "lana_del_rey", "name": "Lana Del Rey", "macro_genre": "Pop", "genres": ["art pop", "pop"], "popularity": 93, "followers": 38000000},
    {"id": "lorde", "name": "Lorde", "macro_genre": "Pop", "genres": ["art pop", "indie pop", "nz pop"], "popularity": 83, "followers": 14000000},
    {"id": "troye_sivan", "name": "Troye Sivan", "macro_genre": "Pop", "genres": ["australian pop", "dance pop", "pop"], "popularity": 84, "followers": 7900000},
    {"id": "conan_gray", "name": "Conan Gray", "macro_genre": "Pop", "genres": ["bedroom pop", "pop"], "popularity": 82, "followers": 8200000},
    {"id": "tate_mcrae", "name": "Tate McRae", "macro_genre": "Pop", "genres": ["dance pop", "pop"], "popularity": 88, "followers": 6800000},
    {"id": "ed_sheeran", "name": "Ed Sheeran", "macro_genre": "Pop", "genres": ["pop", "singer-songwriter"], "popularity": 91, "followers": 115000000},
    {"id": "miley_cyrus", "name": "Miley Cyrus", "macro_genre": "Pop", "genres": ["pop"], "popularity": 87, "followers": 28000000},
    {"id": "katy_perry", "name": "Katy Perry", "macro_genre": "Pop", "genres": ["pop"], "popularity": 86, "followers": 34000000},
    {"id": "rihanna", "name": "Rihanna", "macro_genre": "Pop", "genres": ["barbadian pop", "pop", "urban contemporary"], "popularity": 90, "followers": 61000000},

    # Indie & Dream Pop
    {"id": "beach_house", "name": "Beach House", "macro_genre": "Indie / Alternative", "genres": ["baltimore indie", "dream pop", "indie rock"], "popularity": 80, "followers": 4100000},
    {"id": "cigarettes_after_sex", "name": "Cigarettes After Sex", "macro_genre": "Indie / Alternative", "genres": ["ambient pop", "dream pop", "shoegaze"], "popularity": 86, "followers": 11000000},
    {"id": "tv_girl", "name": "TV Girl", "macro_genre": "Indie / Alternative", "genres": ["indie pop", "lo-fi indie"], "popularity": 85, "followers": 6800000},
    {"id": "beabadoobee", "name": "beabadoobee", "macro_genre": "Indie / Alternative", "genres": ["bedpop", "indie pop", "uk pop"], "popularity": 80, "followers": 4900000},
    {"id": "dominic_fike", "name": "Dominic Fike", "macro_genre": "Indie / Alternative", "genres": ["indie pop", "alternative r&b"], "popularity": 83, "followers": 5200000},
    {"id": "men_i_trust", "name": "Men I Trust", "macro_genre": "Indie / Alternative", "genres": ["canadian indie", "dream pop", "indie pop"], "popularity": 79, "followers": 3200000},
    {"id": "glass_animals", "name": "Glass Animals", "macro_genre": "Indie / Alternative", "genres": ["indie pop", "modern alternative rock"], "popularity": 82, "followers": 6500000},
    {"id": "wallows", "name": "Wallows", "macro_genre": "Indie / Alternative", "genres": ["indie pop", "modern rock"], "popularity": 80, "followers": 4200000},
    {"id": "gorillaz", "name": "Gorillaz", "macro_genre": "Indie / Alternative", "genres": ["alternative rock", "art pop"], "popularity": 84, "followers": 14000000},

    # Rock & Metal subgenres
    {"id": "paramore", "name": "Paramore", "macro_genre": "Rock / Metal", "genres": ["candy pop", "emo", "pop punk", "rock"], "popularity": 84, "followers": 10000000},
    {"id": "my_chemical_romance", "name": "My Chemical Romance", "macro_genre": "Rock / Metal", "genres": ["emo", "pop punk", "post-hardcore", "rock"], "popularity": 82, "followers": 9500000},
    {"id": "green_day", "name": "Green Day", "macro_genre": "Rock / Metal", "genres": ["permanent wave", "pop punk", "punk", "rock"], "popularity": 85, "followers": 22000000},
    {"id": "queens_of_the_stone_age", "name": "Queens of the Stone Age", "macro_genre": "Rock / Metal", "genres": ["alternative rock", "modern rock", "stoner rock"], "popularity": 78, "followers": 4100000},
    {"id": "system_of_a_down", "name": "System of a Down", "macro_genre": "Rock / Metal", "genres": ["alternative metal", "nu metal", "rock"], "popularity": 85, "followers": 16000000},
    {"id": "bad_omens", "name": "Bad Omens", "macro_genre": "Rock / Metal", "genres": ["metalcore", "modern metal", "post-screamo"], "popularity": 80, "followers": 2200000},
    {"id": "sleep_token", "name": "Sleep Token", "macro_genre": "Rock / Metal", "genres": ["alternative metal", "prog metal"], "popularity": 79, "followers": 1800000},
    {"id": "ghost", "name": "Ghost", "macro_genre": "Rock / Metal", "genres": ["hard rock", "metal", "swedish metal"], "popularity": 80, "followers": 3800000},

    # EDM & House subgenres
    {"id": "martin_garrix", "name": "Martin Garrix", "macro_genre": "EDM / Electronic", "genres": ["dutch edm", "edm", "pop dance"], "popularity": 83, "followers": 17000000},
    {"id": "david_guetta", "name": "David Guetta", "macro_genre": "EDM / Electronic", "genres": ["dance pop", "edm", "pop dance"], "popularity": 92, "followers": 41000000},
    {"id": "the_chainsmokers", "name": "The Chainsmokers", "macro_genre": "EDM / Electronic", "genres": ["dance pop", "edm", "electropop", "pop"], "popularity": 86, "followers": 21000000},
    {"id": "rufus_du_sol", "name": "RÜFÜS DU SOL", "macro_genre": "EDM / Electronic", "genres": ["australian dance", "indie dance"], "popularity": 80, "followers": 2900000},
    {"id": "odesza", "name": "ODESZA", "macro_genre": "EDM / Electronic", "genres": ["chillwave", "indie electronica", "ninja"], "popularity": 79, "followers": 2400000},
    {"id": "flume", "name": "Flume", "macro_genre": "EDM / Electronic", "genres": ["australian dance", "future bass", "indie dance"], "popularity": 78, "followers": 4200000},
    {"id": "dom_dolla", "name": "Dom Dolla", "macro_genre": "EDM / Electronic", "genres": ["house", "tech house"], "popularity": 81, "followers": 1100000},
    {"id": "peggy_gou", "name": "Peggy Gou", "macro_genre": "EDM / Electronic", "genres": ["house", "indie dance"], "popularity": 80, "followers": 1600000},
    {"id": "kaytranada", "name": "KAYTRANADA", "macro_genre": "EDM / Electronic", "genres": ["alternative r&b", "indie soul", "wonky"], "popularity": 81, "followers": 2700000},

    # R&B & Soul subgenres
    {"id": "summer_walker", "name": "Summer Walker", "macro_genre": "R&B / Soul", "genres": ["contemporary r&b", "r&b"], "popularity": 85, "followers": 8200000},
    {"id": "kali_uchis", "name": "Kali Uchis", "macro_genre": "R&B / Soul", "genres": ["colombian pop", "r&b"], "popularity": 88, "followers": 8900000},
    {"id": "jhene_aiko", "name": "Jhené Aiko", "macro_genre": "R&B / Soul", "genres": ["r&b", "urban contemporary"], "popularity": 84, "followers": 10000000},
    {"id": "partynextdoor", "name": "PARTYNEXTDOOR", "macro_genre": "R&B / Soul", "genres": ["canadian contemporary r&b", "r&b", "toronto rap"], "popularity": 87, "followers": 8100000},
    {"id": "bryson_tiller", "name": "Bryson Tiller", "macro_genre": "R&B / Soul", "genres": ["kentucky hip hop", "r&b", "trap soul"], "popularity": 85, "followers": 8700000},
    {"id": "childish_gambino", "name": "Childish Gambino", "macro_genre": "R&B / Soul", "genres": ["afrofuturism", "hip hop", "r&b"], "popularity": 84, "followers": 14000000},

    # Latin subgenres
    {"id": "j_balvin", "name": "J Balvin", "macro_genre": "Latin / Reggaeton", "genres": ["reggaeton", "reggaeton colombiano", "urbano latino"], "popularity": 88, "followers": 38000000},
    {"id": "rosalia", "name": "ROSALÍA", "macro_genre": "Latin / Reggaeton", "genres": ["pop flamenco", "r&b en espanol", "urbano latino"], "popularity": 86, "followers": 12000000},
    {"id": "bizarrap", "name": "Bizarrap", "macro_genre": "Latin / Reggaeton", "genres": ["argentine hip hop", "trap latino", "edm"], "popularity": 87, "followers": 12000000},
    {"id": "myke_towers", "name": "Myke Towers", "macro_genre": "Latin / Reggaeton", "genres": ["reggaeton", "trap latino", "urbano latino"], "popularity": 89, "followers": 14000000},
    {"id": "shakira", "name": "Shakira", "macro_genre": "Latin / Reggaeton", "genres": ["colombian pop", "dance pop", "latin pop"], "popularity": 89, "followers": 36000000},

    # K-Pop subgenres
    {"id": "twice", "name": "TWICE", "macro_genre": "K-Pop", "genres": ["k-pop", "k-pop girl group"], "popularity": 84, "followers": 22000000},
    {"id": "le_sserafim", "name": "LE SSERAFIM", "macro_genre": "K-Pop", "genres": ["k-pop", "k-pop girl group"], "popularity": 83, "followers": 8200000},
    {"id": "aespa", "name": "aespa", "macro_genre": "K-Pop", "genres": ["k-pop", "k-pop girl group"], "popularity": 82, "followers": 7500000},
    {"id": "enhypen", "name": "ENHYPEN", "macro_genre": "K-Pop", "genres": ["k-pop", "k-pop boy group"], "popularity": 83, "followers": 11000000},
    {"id": "seventeen", "name": "SEVENTEEN", "macro_genre": "K-Pop", "genres": ["k-pop", "k-pop boy group"], "popularity": 84, "followers": 14000000},

    # Country / Americana subgenres
    {"id": "luke_combs", "name": "Luke Combs", "macro_genre": "Country / Folk", "genres": ["contemporary country", "country"], "popularity": 88, "followers": 11000000},
    {"id": "chris_stapleton", "name": "Chris Stapleton", "macro_genre": "Country / Folk", "genres": ["contemporary country", "country", "outlaw country"], "popularity": 86, "followers": 7800000},
    {"id": "kacey_musgraves", "name": "Kacey Musgraves", "macro_genre": "Country / Folk", "genres": ["classic texas country", "country dawn"], "popularity": 82, "followers": 3200000},
    {"id": "lumineers", "name": "The Lumineers", "macro_genre": "Country / Folk", "genres": ["folk-pop", "modern rock", "stomp and holler"], "popularity": 83, "followers": 11000000},

    # Ambient / Classical / Jazz
    {"id": "norah_jones", "name": "Norah Jones", "macro_genre": "Jazz / Classical", "genres": ["adult standards", "contemporary vocal jazz"], "popularity": 77, "followers": 5200000},
    {"id": "brian_eno", "name": "Brian Eno", "macro_genre": "Jazz / Classical", "genres": ["ambient", "art rock", "drone"], "popularity": 71, "followers": 1500000},
    {"id": "max_richter", "name": "Max Richter", "macro_genre": "Jazz / Classical", "genres": ["compositional ambient", "post-minimalism"], "popularity": 76, "followers": 1900000}
]

from expand_catalog import get_550_artist_catalog

def get_all_catalog_artists() -> List[Dict]:
    """Combines curated seeds with expanded 550+ global universe."""
    return get_550_artist_catalog()

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
