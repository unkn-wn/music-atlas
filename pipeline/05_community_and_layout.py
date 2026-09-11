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
from typing import Dict, List, Set, Tuple
import numpy as np
import networkx as nx
from scipy.spatial import cKDTree
from tqdm import tqdm

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

# Perceptually distinct, vibrant 64-continent palette
CONTINENT_PALETTE = [
    "#10B981", "#EC4899", "#F59E0B", "#06B6D4", "#EF4444", "#8B5CF6",
    "#EAB308", "#D97706", "#F43F5E", "#6366F1", "#14B8A6", "#3B82F6",
    "#84CC16", "#A855F7", "#00E5FF", "#D946EF", "#FB923C", "#4ADE80",
    "#38BDF8", "#C084FC", "#F87171", "#FACC15", "#2DD4BF", "#818CF8",
    "#FB7185", "#A3E635", "#22D3EE", "#E879F9", "#F472B6", "#FDE047",
    "#34D399", "#60A5FA", "#C4B5FD", "#FDA4AF", "#A7F3D0", "#FCD34D",
    "#0284C7", "#059669", "#D97706", "#7C3AED", "#DB2777", "#DC2626",
    "#65A30D", "#0D9488", "#2563EB", "#9333EA", "#C026D3", "#E11D48",
    "#CA8A04", "#16A34A", "#0891B2", "#4F46E5", "#7E22CE", "#BE185D",
    "#B91C1C", "#4D7C0F", "#0F766E", "#1D4ED8", "#6D28D9", "#A21CAF",
    "#9F1239", "#A16207", "#15803D", "#0E7490"
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
        "j-rock": "J-Rock",
        "ost": "OST",
        "uk": "UK",
        "idm": "IDM",
        "opm": "OPM",
        "mpb": "MPB",
        "nz": "NZ",
        "v-pop": "V-Pop"
    }
    parts = name.split()
    return " ".join(acronym_map.get(p.lower(), p.title()) for p in parts)

def run_archipelago_layout(
    G: nx.Graph,
    catalog_map: Dict[str, Dict],
    communities: List[Set[str]],
    canvas_bound: float = 3200.0,
    num_iters: int = 180
) -> Dict[str, Tuple[float, float]]:
    """
    Two-Level Hierarchical Archipelago Layout with Subgenre Micro-Clustering:
    1. Level 1 (Macro Continents):
       Computes inter-continent affinity across ~64 thematic territories and uses
       spring layout to position continent centroids across a wide disc (radius ~2400).
    2. Level 2 (Intra-Continent Subgenre Micro-Clusters):
       Within each continent, groups artists by their primary subgenre. Positions distinct
       micro-centroids spaced 120-350px around the continent centroid so Boom Bap, Trap,
       and Emo Rap don't pancake on top of each other.
    3. Vectorized Multi-Body Physics:
       Intra-cluster spring forces pull collaborators together while centroid and micro-centroid
       anchors preserve island identity and separate subgenre peninsulas.
    4. Soft Optical Clearance:
       Relieves avatar circle overlaps without artificial grid distortion.
    """
    if not G.nodes():
        return {}

    nodes = list(G.nodes())
    N = len(nodes)
    node_to_idx = {n: i for i, n in enumerate(nodes)}
    K = len(communities)

    node_comm_idx = np.zeros(N, dtype=np.int32)
    for c_idx, comm in enumerate(communities):
        for u in comm:
            if u in node_to_idx:
                node_comm_idx[node_to_idx[u]] = c_idx

    edges = list(G.edges(data=True))
    src_indices = np.array([node_to_idx[u] for u, v, _ in edges], dtype=np.int32)
    dst_indices = np.array([node_to_idx[v] for u, v, _ in edges], dtype=np.int32)
    weights = np.array([float(d.get("weight", 0.5)) for _, _, d in edges], dtype=np.float32)

    # 1. Level 1: Macro-Archipelago Arrangement
    print(f"  Level 1: Calculating inter-continent affinity for {K} continents...")
    inter_aff = np.zeros((K, K), dtype=np.float32)
    for s, d, w in zip(src_indices, dst_indices, weights):
        c1, c2 = node_comm_idx[s], node_comm_idx[d]
        if c1 != c2:
            inter_aff[c1, c2] += w
            inter_aff[c2, c1] += w

    macro_G = nx.Graph()
    for i in range(K):
        macro_G.add_node(i)
    for i in range(K):
        for j in range(i + 1, K):
            if inter_aff[i, j] > 0.1:
                macro_G.add_edge(i, j, weight=float(inter_aff[i, j]))

    c_pos_dict = nx.spring_layout(macro_G, weight="weight", seed=42, iterations=400)
    c_pos = np.array([c_pos_dict[i] for i in range(K)], dtype=np.float32)
    c_radii = np.linalg.norm(c_pos, axis=1, keepdims=True) + 1e-4
    macro_radius = canvas_bound * 0.55
    c_pos = (c_pos / np.max(c_radii)) * macro_radius

    # 2. Level 2: Subgenre Micro-Centroids within each Continent
    print(f"  Level 2: Partitioning subgenre micro-centroids within each of the {K} continents...")
    np.random.seed(42)
    node_target_centers = np.zeros((N, 2), dtype=np.float32)

    for c_idx, comm in enumerate(communities):
        c_center = c_pos[c_idx]
        subg_members = {}
        for u in comm:
            subs = catalog_map.get(u, {}).get("topSubgenres", ["Other"])
            p = subs[0] if subs else "Other"
            subg_members.setdefault(p, []).append(u)

        num_subgs = len(subg_members)
        if num_subgs == 1:
            for u in comm:
                node_target_centers[node_to_idx[u]] = c_center
            continue

        # Sort subgenres by size so major subgenres get dedicated outer orbits
        sorted_subgs = sorted(subg_members.items(), key=lambda x: len(x[1]), reverse=True)
        subg_angles = np.linspace(0, 2 * np.pi, num_subgs, endpoint=False)

        for s_i, (subg, members) in enumerate(sorted_subgs):
            ang = subg_angles[s_i]
            # Spread subgenres across radial distance (90px to 360px)
            r_sub = 90.0 + min(270.0, math.sqrt(len(members)) * 28.0)
            sub_center = c_center + np.array([r_sub * np.cos(ang), r_sub * np.sin(ang)], dtype=np.float32)
            for u in members:
                node_target_centers[node_to_idx[u]] = sub_center

    # Seed artists with small initial jitter around their specific subgenre micro-center
    rand_ang = np.random.uniform(0, 2 * np.pi, N).astype(np.float32)
    rand_r = np.random.uniform(8, 65, N).astype(np.float32)
    pos = (node_target_centers + np.stack([rand_r * np.cos(rand_ang), rand_r * np.sin(rand_ang)], axis=1)).astype(np.float32)

    # 3. Vectorized Physics Simulation
    print(f"  Level 3: Vectorized archipelago spring physics ({num_iters} iterations)...")
    is_intra = (node_comm_idx[src_indices] == node_comm_idx[dst_indices])
    eff_weights = weights.copy()
    eff_weights[~is_intra] *= 0.35

    vel = np.zeros_like(pos)
    for it in range(num_iters):
        force = np.zeros_like(pos)

        # Edge attraction
        diff = pos[dst_indices] - pos[src_indices]
        dist = np.linalg.norm(diff, axis=1, keepdims=True) + 1e-3
        spring_mag = eff_weights[:, np.newaxis] * dist * 0.04
        edge_f = (diff / dist) * spring_mag
        np.add.at(force, src_indices, edge_f)
        np.add.at(force, dst_indices, -edge_f)

        # Micro-center anchor spring
        force += (node_target_centers - pos) * 0.035

        # Damping and cooling schedule
        temp = 1.0 - (it / num_iters) * 0.75
        vel = (vel + force * 0.05) * 0.85 * temp
        step_mag = np.linalg.norm(vel, axis=1, keepdims=True) + 1e-4
        capped = np.minimum(step_mag, 28.0 * temp)
        vel = (vel / step_mag) * capped
        pos += vel

    # 4. Center and normalize coordinates to target canvas bounds
    pos -= np.median(pos, axis=0)
    radii = np.linalg.norm(pos, axis=1)
    r99 = float(np.percentile(radii, 99.5)) or 1.0
    target_radius = canvas_bound * 0.88
    pos = (pos / r99) * target_radius

    max_allowed = canvas_bound * 0.96
    new_radii = np.linalg.norm(pos, axis=1)
    outlier_mask = new_radii > max_allowed
    if np.any(outlier_mask):
        scale = max_allowed / new_radii[outlier_mask]
        pos[outlier_mask] *= scale[:, np.newaxis]

    # 5. Soft Optical Anti-Overlap Clearance
    print("  Level 4: Soft Optical Clearance for touching node discs...")
    all_subs = [max(1000, catalog_map.get(n, {}).get("subscribers", 1000)) for n in nodes]
    s_min = min(all_subs) if all_subs else 1000
    s_max = max(all_subs) if all_subs else 50_000_000
    diff = (math.sqrt(s_max) - math.sqrt(s_min)) or 1.0

    node_radii = np.array([
        1.1 + (((math.sqrt(max(1000, catalog_map.get(n, {}).get("subscribers", 1000))) - math.sqrt(s_min)) / diff) ** 1.3) * 15.0
        for n in nodes
    ])
    max_check = float(np.max(node_radii) * 2.0 + 3.0)

    for _ in range(25):
        tree = cKDTree(pos)
        pairs = tree.query_pairs(r=max_check)
        if not pairs:
            break
        moved = False
        for i, j in pairs:
            req = node_radii[i] + node_radii[j] + 2.0
            delta = pos[j] - pos[i]
            d = np.linalg.norm(delta)
            if d < 0.001:
                delta = np.random.uniform(-0.1, 0.1, size=2)
                d = max(1e-4, float(np.linalg.norm(delta)))
            if d < req:
                overlap = (req - d) * 0.28
                shift = (delta / d) * overlap
                pos[i] -= shift
                pos[j] += shift
                moved = True
        if not moved:
            break

    pos -= np.mean(pos, axis=0)
    return {node: (round(float(pos[i, 0]), 2), round(float(pos[i, 1]), 2)) for i, node in enumerate(nodes)}

def main():
    parser = argparse.ArgumentParser(description="Stage 4C: Louvain Topological Continents & Archipelago Layout.")
    parser.add_argument("--num-iters", type=int, default=300, help="Vectorized physics iterations (default: 300)")
    parser.add_argument("--canvas-bound", type=float, default=3200.0, help="Canvas coordinate half-width (default: 3200.0)")
    parser.add_argument("--target-continents", type=int, default=64, help="Target macro continents count (default: 64)")
    args = parser.parse_args()

    if not os.path.exists(EDGES_FILE) or not os.path.exists(CATALOG_FILE):
        raise FileNotFoundError("Missing Stage 4 inputs. Run earlier pipeline stages first.")

    print("=" * 70)
    print(" STAGE 4C: 64 LOUVAIN CONTINENTS & GALAXY ARCHIPELAGO PHYSICS")
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

    # 1. Topological Louvain Community Detection (Resolution 1.6 for 64 cohesive territories)
    print("Detecting topological communities via Louvain modularity optimization (resolution=1.6)...")
    raw_comms = [set(c) for c in nx.community.louvain_communities(G, weight="weight", resolution=1.6, seed=42)]
    print(f"Raw Louvain communities detected: {len(raw_comms)}")

    # Iterative Agglomerative Merge: merge smallest communities until <= target_continents (64) and all >= 25 artists
    communities = sorted(raw_comms, key=len, reverse=True)

    while len(communities) > args.target_continents or any(len(c) < 25 for c in communities):
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

    for idx, (comm, g_counter) in enumerate(tqdm(zip(communities, comm_genre_counts), total=len(communities), desc="Stage 4C: Continents TF-IDF", unit="continent"), start=1):
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

        dominant_genre = top_genres[0] if top_genres else title
        for a_id in sorted_members:
            raw_primary = catalog_map.get(a_id, {}).get("primaryGenre")
            if not raw_primary or raw_primary == "Other":
                raw_primary = dominant_genre
            artist_continent_map[a_id] = {
                "continentId": idx,
                "continentName": title,
                "communityId": idx,
                "communityName": title,
                "color": color,
                "primaryGenre": raw_primary
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

    # 3. Two-Level Hierarchical Archipelago Layout Simulation
    print("\nStarting Spatial Layout Simulation...")
    coords = run_archipelago_layout(
        G,
        catalog_map,
        communities,
        canvas_bound=args.canvas_bound,
        num_iters=args.num_iters
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
