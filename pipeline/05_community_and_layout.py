"""
Stage 4C: Louvain Topological Community Detection & Natural ForceAtlas2 Layout.
Recreates the organic cosmic galaxy layout inspired by the Twitch Atlas and Commits 1 & 2:
1. Topological Louvain Modularity Community Detection on weighted co-occurrence graph.
2. Iterative Agglomerative Merging of satellite communities (< 35 artists) into adjacent
   high-affinity major communities to yield <= 16 cohesive macro-continents.
3. Smoothed TF-IDF Consensus Titles over member artists' subgenres with robust fallbacks.
4. Stable LinLog ForceAtlas2 Physics:
   - Pure LinLog attraction (linLogMode=True, strongGravityMode=False, gravity=0.35, scalingRatio=6.5)
     Eliminates 1/d^2 repulsive singularity explosions, preventing any artists from being slingshotted into the void.
5. Soft Optical Anti-Overlap Relaxation strictly for directly touching avatars (req = r1 + r2 + 1.0),
   eliminating the artificial equidistant lattice and preserving natural organic clustering.
6. Isotropic percentile normalization mapping the cohesive galaxy cleanly into [-1350.0, 1350.0].
Outputs:
- pipeline/output/communities.json
- pipeline/output/layout_coordinates.json
"""

import os
import sys
import json
import time
import math
import random
import argparse
from collections import Counter, defaultdict
from typing import Dict, List, Tuple
import numpy as np
import networkx as nx
import fa2
from scipy.spatial import cKDTree

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(PIPELINE_DIR, "output")

EDGES_FILE = os.path.join(OUTPUT_DIR, "sparsified_edges.json")
CATALOG_FILE = os.path.join(OUTPUT_DIR, "artists_catalog.json")
SURVIVORS_FILE = os.path.join(OUTPUT_DIR, "surviving_artist_ids.json")
COMMUNITIES_FILE = os.path.join(OUTPUT_DIR, "communities.json")
LAYOUT_FILE = os.path.join(OUTPUT_DIR, "layout_coordinates.json")

# Perceptually distinct, vibrant macro-continent palette
CONTINENT_PALETTE = [
    "#10B981",  # Emerald Green (Hip-Hop / Rap)
    "#EC4899",  # Hot Pink / Magenta (Pop)
    "#F59E0B",  # Amber / Warm Gold (Indie / Alternative)
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
    "#00E5FF",  # Electric Cyan
    "#D946EF",  # Fuchsia
]

def format_genre_name(name: str) -> str:
    """Formats genre and acronym strings cleanly for display."""
    if not name:
        return ""
    name = name.strip()
    acronym_map = {
        "r&b": "R&B",
        "ccm": "CCM",
        "edm": "EDM",
        "k-pop": "K-Pop",
        "j-pop": "J-Pop",
        "ost": "OST",
        "uk": "UK",
        "idm": "IDM"
    }
    parts = name.split()
    return " ".join(acronym_map.get(p.lower(), p.title()) for p in parts)

def run_two_phase_layout(
    G: nx.Graph,
    catalog_map: Dict[str, Dict],
    iter_macro: int = 450,
    iter_micro: int = 120,
    canvas_bound: float = 1350.0
) -> Dict[str, Tuple[float, float]]:
    """
    Organic ForceAtlas2 Layout Simulation:
    - Pure LinLog Mode: Logarithmic attraction (linLogMode=True, strongGravityMode=False, gravity=0.35, scalingRatio=6.5)
      Guarantees mathematically bounded repulsion forces without 1/d^2 explosion, preventing any outlier slingshot.
    - Local Settling: Phase 2 with gentle scalingRatio=8.0 and gravity=0.30 to settle micro-constellations.
    - Soft Optical Clearance: Relieves actual visual circle overlaps without forcing an uncanny equidistant grid.
    """
    if not G.nodes():
        return {}

    # Deterministic compact initialization near origin
    np.random.seed(42)
    random.seed(42)
    init_pos = {
        node: (float(np.random.uniform(-50.0, 50.0)), float(np.random.uniform(-50.0, 50.0)))
        for node in G.nodes()
    }

    # Phase 1: Stable LinLog Macro Galaxy Spreading
    print(f"  Phase 1: ForceAtlas2 LinLog Galaxy Spreading ({iter_macro} iterations)...")
    fa2_phase1 = fa2.ForceAtlas2(
        outboundAttractionDistribution=False,
        linLogMode=True,
        adjustSizes=False,
        edgeWeightInfluence=1.0,
        jitterTolerance=1.0,
        barnesHutOptimize=True,
        barnesHutTheta=0.7,
        scalingRatio=6.5,
        strongGravityMode=False,
        gravity=0.35,
        verbose=False
    )
    pos_dict = fa2_phase1.forceatlas2_networkx_layout(
        G, pos=init_pos, iterations=iter_macro, weight_attr="weight"
    )

    # Phase 2: Gentle Local Constellation Settling (stable parameters, no 1/d^2 explosion)
    print(f"  Phase 2: Local Constellation Settling ({iter_micro} iterations)...")
    fa2_phase2 = fa2.ForceAtlas2(
        outboundAttractionDistribution=False,
        linLogMode=True,
        adjustSizes=False,
        edgeWeightInfluence=0.8,
        jitterTolerance=0.8,
        barnesHutOptimize=True,
        barnesHutTheta=0.7,
        scalingRatio=8.0,
        strongGravityMode=False,
        gravity=0.30,
        verbose=False
    )
    pos_dict = fa2_phase2.forceatlas2_networkx_layout(
        G, pos=pos_dict, iterations=iter_micro, weight_attr="weight"
    )

    nodes = list(G.nodes())
    pos = np.array([pos_dict[node] for node in nodes], dtype=np.float64)

    # 1. Center coordinates around median to prevent outlier pull
    pos -= np.median(pos, axis=0)

    # 2. Isotropic Percentile Scaling (maps 99.5% of nodes into 88% of canvas, leaving margins)
    radii = np.linalg.norm(pos, axis=1)
    r99 = float(np.percentile(radii, 99.5)) or 1.0
    target_radius = canvas_bound * 0.88
    pos = (pos / r99) * target_radius

    # Gently damp any extreme outlier beyond 1.15 * target_radius
    max_allowed = canvas_bound * 0.95
    new_radii = np.linalg.norm(pos, axis=1)
    outlier_mask = new_radii > max_allowed
    if np.any(outlier_mask):
        scale = max_allowed / new_radii[outlier_mask]
        pos[outlier_mask] *= scale[:, np.newaxis]

    # 3. Soft Optical Clearance: strictly for directly touching/overlapping circles
    print("  Stage 3: Soft Optical Anti-Overlap Clearance (preserving natural density variations)...")
    all_subs = [max(1000, catalog_map.get(n, {}).get("subscribers", 1000)) for n in nodes]
    s_min, s_max = min(all_subs) if all_subs else 1000, max(all_subs) if all_subs else 50_000_000
    diff = (math.sqrt(s_max) - math.sqrt(s_min)) or 1.0

    # True visual display radii: 1.1px to 22.6px
    node_radii = np.array([
        1.1 + (((math.sqrt(max(1000, catalog_map.get(n, {}).get("subscribers", 1000))) - math.sqrt(s_min)) / diff) ** 1.3) * 21.5
        for n in nodes
    ])
    max_check = float(np.max(node_radii) * 2.0 + 2.0)

    # Damped soft relaxation: only pushes nodes if they literally touch visually
    for _ in range(20):
        tree = cKDTree(pos)
        pairs = tree.query_pairs(r=max_check)
        if not pairs:
            break
        moved = False
        for i, j in pairs:
            req = node_radii[i] + node_radii[j] + 1.2
            delta = pos[j] - pos[i]
            dist = np.linalg.norm(delta)
            if dist < 0.001:
                delta = np.random.uniform(-0.1, 0.1, size=2)
                dist = max(1e-4, float(np.linalg.norm(delta)))
            if dist < req:
                overlap = (req - dist) * 0.25  # Soft damping prevents grid formation
                shift = (delta / dist) * overlap
                pos[i] -= shift
                pos[j] += shift
                moved = True
        if not moved:
            break

    # Final center around origin
    pos -= np.mean(pos, axis=0)

    return {node: (round(float(pos[i, 0]), 2), round(float(pos[i, 1]), 2)) for i, node in enumerate(nodes)}

def main():
    parser = argparse.ArgumentParser(description="Stage 4C: Louvain Topological Continents & ForceAtlas2 Layout.")
    parser.add_argument("--iter-macro", type=int, default=450, help="Phase 1 LinLog iterations (default: 450)")
    parser.add_argument("--iter-micro", type=int, default=120, help="Phase 2 refinement iterations (default: 120)")
    parser.add_argument("--canvas-bound", type=float, default=1350.0, help="Canvas coordinate half-width (default: 1350.0)")
    args = parser.parse_args()

    if not os.path.exists(EDGES_FILE) or not os.path.exists(CATALOG_FILE):
        raise FileNotFoundError("Missing Stage 4 inputs. Run earlier pipeline stages first.")

    print("=" * 70)
    print(" STAGE 4C: LOUVAIN CONTINENTS & ORGANIC FORCEATLAS2 GALAXY PHYSICS")
    print("=" * 70)
    start_time = time.time()

    with open(EDGES_FILE, "r", encoding="utf-8") as f:
        edges = json.load(f)
    with open(CATALOG_FILE, "r", encoding="utf-8") as f:
        catalog = json.load(f)

    catalog_map = {a["id"]: a for a in catalog}

    # Load surviving artist IDs if available
    surviving_ids = None
    if os.path.exists(SURVIVORS_FILE):
        with open(SURVIVORS_FILE, "r", encoding="utf-8") as f:
            surviving_ids = set(json.load(f))

    # Build NetworkX weighted graph
    G = nx.Graph()
    for e in edges:
        G.add_edge(e["source"], e["target"], weight=float(e["weight"]))

    for a in catalog:
        if surviving_ids is not None and a["id"] not in surviving_ids:
            continue
        if a["id"] not in G:
            G.add_node(a["id"])

    print(f"Graph loaded with {G.number_of_nodes()} nodes and {G.number_of_edges()} edges.")

    # 1. Topological Louvain Community Detection
    print("Detecting topological communities via Louvain modularity optimization...")
    raw_comms = [set(c) for c in nx.community.louvain_communities(G, weight="weight", resolution=1.0, seed=42)]
    print(f"Raw Louvain communities detected: {len(raw_comms)}")

    # Iterative Agglomerative Merge: merge smallest communities until <= 16 and all >= 35 artists
    communities = sorted(raw_comms, key=len, reverse=True)

    while len(communities) > 16 or any(len(c) < 35 for c in communities):
        c_small = min(communities, key=len)
        communities.remove(c_small)

        best_target = None
        best_weight = -1.0

        for c_candidate in communities:
            w_sum = 0.0
            for u in c_small:
                for v in G.neighbors(u):
                    if v in c_candidate:
                        w_sum += float(G[u][v].get("weight", 0.1))
            if w_sum > best_weight:
                best_weight = w_sum
                best_target = c_candidate

        if best_target is not None and best_weight > 0.0:
            best_target.update(c_small)
        else:
            largest = max(communities, key=len)
            largest.update(c_small)

    communities = sorted(communities, key=len, reverse=True)
    print(f"Agglomerated into {len(communities)} macro-continents.")

    # 2. Consensus Titles via Smoothed TF-IDF over Artist Subgenres
    total_comms = len(communities)
    genre_doc_freq = Counter()
    comm_genre_counts = []

    for comm in communities:
        g_counter = Counter()
        for a_id in comm:
            a_data = catalog_map.get(a_id, {})
            for g in a_data.get("topSubgenres", a_data.get("genres", [])):
                g_counter[g] += 1
        comm_genre_counts.append(g_counter)
        for g in g_counter:
            genre_doc_freq[g] += 1

    continents = []
    artist_continent_map = {}

    for idx, (comm, g_counter) in enumerate(zip(communities, comm_genre_counts), start=1):
        color = CONTINENT_PALETTE[(idx - 1) % len(CONTINENT_PALETTE)]
        total_genres_in_comm = sum(g_counter.values()) or 1

        tfidf_scores = []
        for g, count in g_counter.items():
            tf = count / total_genres_in_comm
            idf = math.log((total_comms + 1) / (genre_doc_freq[g] + 1)) + 1.0
            tfidf_scores.append((g, tf * idf))

        tfidf_scores.sort(key=lambda x: x[1], reverse=True)
        top_genres = [format_genre_name(g[0]) for g in tfidf_scores[:3]]

        if top_genres:
            title = " / ".join(top_genres)
        else:
            primary_counts = Counter(
                catalog_map.get(a_id, {}).get("primaryGenre")
                for a_id in comm if catalog_map.get(a_id, {}).get("primaryGenre")
            )
            if primary_counts:
                title = format_genre_name(primary_counts.most_common(1)[0][0])
            else:
                title = f"Diverse Galaxy #{idx}"

        sorted_members = sorted(list(comm))
        continents.append({
            "id": idx,
            "name": title,
            "color": color,
            "artistCount": len(sorted_members),
            "artistIds": sorted_members
        })

        for a_id in sorted_members:
            raw_primary = catalog_map.get(a_id, {}).get("primaryGenre") or title.split(" / ")[0]
            artist_continent_map[a_id] = {
                "continentId": idx,
                "continentName": title,
                "communityId": idx,
                "communityName": title,
                "color": color,
                "primaryGenre": format_genre_name(raw_primary)
            }

    print("\nFormed Macro-Continents:")
    for c in continents:
        print(f"  - [{c['color']}] Continent #{c['id']}: {c['name']} ({c['artistCount']} artists)")

    # Save communities.json
    with open(COMMUNITIES_FILE, "w", encoding="utf-8") as f:
        json.dump({
            "continents": continents,
            "artist_continent_map": artist_continent_map
        }, f, indent=2)
    print(f"\nSaved {COMMUNITIES_FILE}")

    # 3. Two-Phase ForceAtlas2 Layout Simulation
    print("\nStarting Spatial Layout Simulation...")
    coords = run_two_phase_layout(
        G,
        catalog_map,
        iter_macro=args.iter_macro,
        iter_micro=args.iter_micro,
        canvas_bound=args.canvas_bound
    )

    normalized_coords = {
        node: {
            "x": coord[0],
            "y": coord[1]
        }
        for node, coord in coords.items()
    }

    with open(LAYOUT_FILE, "w", encoding="utf-8") as f:
        json.dump(normalized_coords, f, indent=2)

    print(f"Saved {LAYOUT_FILE}")
    print(f"Stage 4C complete in {time.time() - start_time:.2f}s!")
    print("=" * 70)

if __name__ == "__main__":
    main()
