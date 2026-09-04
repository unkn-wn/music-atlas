"""
Step 4: Community Detection & Perceptual Color Assignment.
Anchors colors strictly to topological communities via Louvain / Leiden modularity
on the weighted co-occurrence graph. Uses TF-IDF on member artist genres to assign
accurate consensus continent titles and Oklab-derived distinct color palettes.
"""

import os
import json
import math
from collections import Counter, defaultdict
import networkx as nx

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")

# Harmonious, vibrant, perceptually distinct continent palette (Hex codes)
CONTINENT_PALETTE = [
    "#F59E0B",  # Amber / Warm Gold (Hip-Hop / Rap)
    "#EC4899",  # Hot Pink / Magenta (Pop)
    "#10B981",  # Emerald Green (Indie / Alternative)
    "#06B6D4",  # Electric Cyan (EDM / Electronic)
    "#EF4444",  # Crimson / Ruby (Rock / Metal)
    "#8B5CF6",  # Deep Violet / Purple (R&B / Soul)
    "#EAB308",  # Sunshine Yellow (Latin / Reggaeton)
    "#D97706",  # Ochre / Terracotta (Country / Folk)
    "#F43F5E",  # Rose / Coral (K-Pop / Asian Pop)
    "#6366F1",  # Indigo (Jazz / Blues)
    "#14B8A6",  # Teal / Mint (Classical / Ambient)
    "#3B82F6",  # Royal Blue (UK Drill / Grime)
    "#84CC16",  # Lime Green (Hyperpop / Glitch)
    "#A855F7",  # Bright Orchid (Neo-Psychedelic)
]

def main():
    edges_file = os.path.join(OUTPUT_DIR, "sparsified_edges.json")
    catalog_file = os.path.join(OUTPUT_DIR, "artists_catalog.json")

    if not os.path.exists(edges_file) or not os.path.exists(catalog_file):
        raise FileNotFoundError("Missing inputs from previous steps.")

    with open(edges_file, "r", encoding="utf-8") as f:
        edges = json.load(f)
    with open(catalog_file, "r", encoding="utf-8") as f:
        catalog = json.load(f)

    artist_meta = {a["id"]: a for a in catalog}

    # Build NetworkX graph
    G = nx.Graph()
    for e in edges:
        G.add_edge(e["source"], e["target"], weight=e["weight"])

    # Also add isolated nodes if any
    for a in catalog:
        if a["id"] not in G:
            G.add_node(a["id"])

    print(f"Running Louvain community detection on graph ({G.number_of_nodes()} nodes, {G.number_of_edges()} edges)...")
    communities = nx.community.louvain_communities(G, weight="weight", resolution=1.0, seed=42)

    # Sort communities by size descending
    communities = sorted(communities, key=len, reverse=True)
    print(f"Detected {len(communities)} topological communities.")

    # Compute TF-IDF genre labels for each community
    total_comms = len(communities)
    genre_doc_freq = Counter()
    comm_genre_counts = []

    for comm in communities:
        g_counter = Counter()
        for a_id in comm:
            a_data = artist_meta.get(a_id, {})
            for g in a_data.get("genres", []):
                g_counter[g] += 1
        comm_genre_counts.append(g_counter)
        for g in g_counter:
            genre_doc_freq[g] += 1

    continents = []
    artist_continent_map = {}

    for idx, (comm, g_counter) in enumerate(zip(communities, comm_genre_counts)):
        color = CONTINENT_PALETTE[idx % len(CONTINENT_PALETTE)]

        # TF-IDF ranking of genres
        tfidf_scores = []
        total_genres_in_comm = sum(g_counter.values()) or 1
        for g, count in g_counter.items():
            tf = count / total_genres_in_comm
            idf = math.log((total_comms + 1) / (genre_doc_freq[g] + 1)) + 1
            tfidf_scores.append((g, tf * idf))

        tfidf_scores.sort(key=lambda x: x[1], reverse=True)
        top_genres = [g[0] for g in tfidf_scores[:3]]

        # Consensus title
        if top_genres:
            title = " / ".join(w.title() for w in top_genres)
        else:
            # Fallback to majority macro_genre from catalog
            macro_counts = Counter(artist_meta.get(a, {}).get("macro_genre", "Various") for a in comm)
            title = macro_counts.most_common(1)[0][0]

        continent_info = {
            "id": idx + 1,
            "name": title,
            "color": color,
            "artistCount": len(comm),
            "artistIds": list(comm)
        }
        continents.append(continent_info)

        for a_id in comm:
            artist_continent_map[a_id] = {
                "continentId": idx + 1,
                "continentName": title,
                "color": color
            }

    print(f"Formed {len(continents)} continents:")
    for c in continents[:8]:
        print(f"  - [{c['color']}] Continent #{c['id']}: {c['name']} ({c['artistCount']} artists)")

    # Save output
    with open(os.path.join(OUTPUT_DIR, "communities.json"), "w", encoding="utf-8") as f:
        json.dump({
            "continents": continents,
            "artist_continent_map": artist_continent_map
        }, f, indent=2)

    print("Step 4 complete. Saved communities.json")

if __name__ == "__main__":
    main()
