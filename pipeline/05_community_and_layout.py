"""
Stage 5: Louvain Continents, Final Genre Tags & Archipelago Layout.
1. Topological Louvain Modularity Community Detection on the weighted co-occurrence graph.
2. Communities above --max-community-size (350) are split by local Louvain; their slivers (< 25 artists) rejoin
   the strongest sibling.
3. Iterative Agglomerative Merging of the smallest community into its highest-affinity neighbour until there are
   at most --target-continents (256) macro-continents and every one has >= 25 artists.
4. Final genre tags: Stage 2's tags after the neighbour check (genre_tags.py), saved per artist in communities.json.
   Continent titles: the 3 final tags with the best coverage in the continent relative to the whole atlas.
5. Two-level archipelago layout (run_archipelago_layout): continent centroids by spring layout over inter-continent
   affinity, subgenre micro-centroids within each continent, vectorized spring physics, percentile normalization
   into the canvas bound, and soft clearance of overlapping avatars (req = r1 + r2 + 2.0).
Outputs:
- pipeline/output/communities.json
- pipeline/output/layout_coordinates.json
"""

import os
import sys
import json
import time
import math
import colorsys
import argparse
from collections import Counter
from typing import Dict, List, Set, Tuple
import numpy as np
import networkx as nx
from scipy.spatial import cKDTree
from tqdm import tqdm

from connections import neighbor_lists, drawn_pairs, strongest_drawn
from genre_tags import check_with_neighbours, NEIGHBOUR_CHECK_K

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

CONTINENT_COLOR_SEED = 56

def get_continent_color(idx: int) -> str:
    """Generates a perceptually distinct, deterministic color with varied mood tiers (pastel, deep jewel, vivid, radiant, muted)."""
    hue = (((idx * 137.507764) + (CONTINENT_COLOR_SEED * 83.17)) % 360.0) / 360.0
    tiers = [
        # (0.92, 0.56),  # Vivid Electric
        (0.55, 0.72),  # Soft Pastel
        (0.84, 0.46),  # Deep Jewel
        (0.75, 0.62),  # Radiant Warm
        (0.58, 0.52),  # Muted Dusty
    ]
    sat, light = tiers[(idx + CONTINENT_COLOR_SEED) % len(tiers)]
    r, g, b = colorsys.hls_to_rgb(hue, light, sat)
    return f"#{int(r * 255):02X}{int(g * 255):02X}{int(b * 255):02X}"



def run_archipelago_layout(
    G: nx.Graph,
    catalog_map: Dict[str, Dict],
    communities: List[Set[str]],
    tags: Dict[str, List[str]],
    canvas_bound: float = 3200.0,
    num_iters: int = 180
) -> Dict[str, Tuple[float, float]]:
    """
    Two-Level Hierarchical Archipelago Layout with Subgenre Micro-Clustering:
    1. Level 1 (Macro Continents):
       Computes inter-continent affinity across all continents and uses spring layout
       to position continent centroids across a wide disc (radius 0.7 x canvas_bound).
    2. Level 2 (Intra-Continent Subgenre Micro-Clusters):
       Within each continent, groups artists by their first final genre tag. Positions distinct
       micro-centroids 65-225 units around the continent centroid so the continent's subgenres
       don't pancake on top of each other. Artists without a genre tag stay at the continent centroid.
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

    top_edges = set()
    for i in range(K):
        row = [(j, inter_aff[i, j]) for j in range(K) if j != i and inter_aff[i, j] > 0.25]
        row.sort(key=lambda x: x[1], reverse=True)
        for j, w in row[:8]:
            top_edges.add(tuple(sorted([i, j])))

    for i, j in top_edges:
        macro_G.add_edge(i, j, weight=float(inter_aff[i, j]) ** 2.0)

    k_val = 3.2 / math.sqrt(K)
    c_pos_dict = nx.spring_layout(macro_G, weight="weight", seed=42, iterations=400, k=k_val)
    c_pos = np.array([c_pos_dict[i] for i in range(K)], dtype=np.float32)
    c_radii = np.linalg.norm(c_pos, axis=1, keepdims=True) + 1e-4
    macro_radius = canvas_bound * 0.70
    c_pos = (c_pos / np.max(c_radii)) * macro_radius

    # 2. Level 2: Subgenre Micro-Centroids within each Continent
    print(f"  Level 2: Partitioning subgenre micro-centroids within each of the {K} continents...")
    np.random.seed(42)
    node_target_centers = np.zeros((N, 2), dtype=np.float32)

    for c_idx, comm in enumerate(communities):
        c_center = c_pos[c_idx]
        subg_members = {}
        for u in sorted(comm):
            node_target_centers[node_to_idx[u]] = c_center
            if tags.get(u):
                subg_members.setdefault(tags[u][0], []).append(u)

        num_subgs = len(subg_members)
        if num_subgs <= 1:
            continue

        # Sort subgenres by size so major subgenres get dedicated outer orbits
        sorted_subgs = sorted(subg_members.items(), key=lambda x: (-len(x[1]), x[0]))
        subg_angles = np.linspace(0, 2 * np.pi, num_subgs, endpoint=False)

        for s_i, (subg, members) in enumerate(sorted_subgs):
            ang = subg_angles[s_i]
            # Spread subgenres across radial distance (65px to 225px)
            r_sub = 65.0 + min(160.0, math.sqrt(len(members)) * 18.0)
            sub_center = c_center + np.array([r_sub * np.cos(ang), r_sub * np.sin(ang)], dtype=np.float32)
            for u in members:
                node_target_centers[node_to_idx[u]] = sub_center

    # Seed artists with small initial jitter around their specific subgenre micro-center
    rand_ang = np.random.uniform(0, 2 * np.pi, N).astype(np.float32)
    rand_r = np.random.uniform(10, 65, N).astype(np.float32)
    pos = (node_target_centers + np.stack([rand_r * np.cos(rand_ang), rand_r * np.sin(rand_ang)], axis=1)).astype(np.float32)

    # 3. Vectorized Physics Simulation
    print(f"  Level 3: Vectorized archipelago spring physics ({num_iters} iterations)...")
    is_intra = (node_comm_idx[src_indices] == node_comm_idx[dst_indices])
    eff_weights = weights.copy()
    eff_weights[~is_intra] *= 0.50

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
    target_radius = canvas_bound * 0.92
    pos = (pos / r99) * target_radius

    max_allowed = canvas_bound * 0.97
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
    parser = argparse.ArgumentParser(description="Stage 5: Louvain Topological Continents & Archipelago Layout.")
    parser.add_argument("--num-iters", type=int, default=300, help="Vectorized physics iterations (default: 300)")
    parser.add_argument("--canvas-bound", type=float, default=6400.0, help="Canvas coordinate half-width (default: 6400.0)")
    parser.add_argument("--target-continents", type=int, default=256, help="Target macro continents count (default: 256)")
    parser.add_argument("--max-community-size", type=int, default=350, help="Max community size threshold for hierarchical sub-partitioning (default: 350)")
    parser.add_argument("--resolution", type=float, default=None, help="Louvain modularity resolution parameter (default: 3.5 for >=200, 2.8 for >=128, 1.6 for 64)")
    args = parser.parse_args()

    if not os.path.exists(EDGES_FILE) or not os.path.exists(CATALOG_FILE):
        raise FileNotFoundError("Missing Stage 4 inputs. Run earlier pipeline stages first.")

    print("=" * 70)
    print(f" STAGE 5: {args.target_continents} LOUVAIN CONTINENTS & GALAXY ARCHIPELAGO PHYSICS")
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

    # 1. Topological Louvain Community Detection (Resolution 3.5 for >=200, 2.8 for >=128, 1.6 for 64)
    target_res = args.resolution
    if target_res is None:
        target_res = 3.5 if args.target_continents >= 200 else (2.8 if args.target_continents >= 128 else 1.6)
    print(f"Detecting topological communities via Louvain modularity optimization (resolution={target_res})...")
    raw_comms = [set(c) for c in nx.community.louvain_communities(G, weight="weight", resolution=target_res, seed=42)]
    print(f"Raw Louvain communities detected: {len(raw_comms)}")

    # 1B. Hierarchical Sub-Community Partitioning (Bypasses Modularity Resolution Limit)
    def split_oversized_community(c: set, max_size: int = 350, min_size: int = 25) -> list[set]:
        """Recursively decomposes oversized communities using local subgraph Louvain modularity."""
        if len(c) <= max_size:
            return [c]

        # Built in sorted node order: a subgraph view iterates the set c, whose order changes between runs
        members = sorted(c)
        subG = nx.Graph()
        subG.add_nodes_from(members)
        subG.add_edges_from((u, v, d) for u in members for v, d in G[u].items() if v in c)
        sub_comms = [set(sc) for sc in nx.community.louvain_communities(subG, weight="weight", resolution=1.0, seed=42)]

        if len(sub_comms) <= 1:
            return [c]

        major_parts = [sc for sc in sub_comms if len(sc) >= min_size]
        slivers = [sc for sc in sub_comms if len(sc) < min_size]

        if len(major_parts) < 2:
            return [c]

        # Re-integrate slivers into strongest major sibling inside this subgraph
        for sliver in slivers:
            for u in sorted(sliver):
                best_target = max(major_parts, key=lambda p: sum(float(subG[u][v].get("weight", 0.1)) for v in subG.neighbors(u) if v in p))
                best_target.add(u)

        final_parts = []
        for part in major_parts:
            if len(part) > max_size:
                final_parts.extend(split_oversized_community(part, max_size=max_size, min_size=min_size))
            else:
                final_parts.append(part)

        return final_parts

    if args.max_community_size and args.max_community_size > 0:
        print(f"Applying hierarchical decomposition to oversized communities (> {args.max_community_size} artists)...")
        split_comms = []
        for c in raw_comms:
            split_comms.extend(split_oversized_community(c, max_size=args.max_community_size, min_size=25))
        print(f"Decomposed {len(raw_comms)} raw communities into {len(split_comms)} modular sub-continents.")
        raw_comms = split_comms

    # Iterative Agglomerative Merge: merge smallest communities until <= target_continents and all >= 25 artists
    communities = sorted(raw_comms, key=len, reverse=True)

    while len(communities) > 1 and (len(communities) > args.target_continents or any(len(c) < 25 for c in communities)):
        c_small = min(communities, key=len)
        communities.remove(c_small)

        best_target = None
        best_score = -1.0
        small_members = sorted(c_small)  # fixed summation order, so ties resolve the same way every run

        for c_candidate in communities:
            w_sum = 0.0
            for u in small_members:
                for v in G.neighbors(u):
                    if v in c_candidate:
                        w_sum += float(G[u][v].get("weight", 0.1))
            if w_sum <= 0:
                continue
            # Density-normalized affinity score prevents giant community black-hole swallowing
            score = w_sum / (len(c_candidate) ** 0.5)
            if len(c_candidate) + len(c_small) > args.max_community_size:
                score *= (args.max_community_size / (len(c_candidate) + len(c_small))) ** 2
            if score > best_score:
                best_score = score
                best_target = c_candidate

        if best_target is not None and best_score > 0.0:
            best_target.update(c_small)
        else:
            smallest = min(communities, key=len)
            smallest.update(c_small)

    communities = sorted(communities, key=len, reverse=True)
    print(f"Agglomerated into {len(communities)} macro-continents.")

    # 2. Final genre tags: Stage 2's tags after the neighbour check (genre_tags.py), on the drawn connections Stage 6 exports.
    # The catalog stays as Stage 2 wrote it, so re-running this stage gives the same tags.
    members = {a for comm in communities for a in comm if a in catalog_map and (surviving_ids is None or a in surviving_ids)}
    raw_neighbors = neighbor_lists(edges, members)
    strongest = strongest_drawn(edges, drawn_pairs(edges, raw_neighbors, members), NEIGHBOUR_CHECK_K)
    final_tags = check_with_neighbours({a: catalog_map[a] for a in members}, strongest)
    dropped = sum(len(set(catalog_map[a]["topSubgenres"]) - set(final_tags[a])) for a in members)
    from_wikidata = sum(1 for a in members if final_tags[a] and not set(final_tags[a]) & set(catalog_map[a]["topSubgenres"]))
    print(f"Neighbour check dropped {dropped} tags; {from_wikidata} artists left without one took their Wikidata genres; "
          f"{sum(1 for t in final_tags.values() if t)} of {len(members)} artists have a genre.")

    # 3. Consensus Titles via Intra-Community Member Majority Coverage & Contrastive Lift
    total_artists_in_graph = sum(len(c) for c in communities) or 1
    global_subgenre_artist_count = Counter(g for tags in final_tags.values() for g in tags)

    comm_genre_member_counts = [Counter(g for a_id in comm for g in final_tags.get(a_id, [])) for comm in communities]

    continents = []
    artist_continent_map = {}

    for idx, (comm, g_member_counts) in enumerate(tqdm(zip(communities, comm_genre_member_counts), total=len(communities), desc="Stage 5: Continents Consensus", unit="continent"), start=1):
        color = get_continent_color(idx)
        comm_size = len(comm) or 1

        consensus_scores = []
        for g, count in g_member_counts.items():
            coverage = count / comm_size
            global_cov = global_subgenre_artist_count[g] / total_artists_in_graph
            score = (coverage ** 0.8) * math.log(1.0 + (coverage / (global_cov + 0.02)))
            consensus_scores.append((score, count, g))

        consensus_scores.sort(key=lambda x: (-x[0], -x[1], x[2]))  # genre name breaks ties, so titles do not vary between runs
        top_genres = [g[2] for g in consensus_scores[:3]]
        title = " / ".join(top_genres) if top_genres else f"Diverse Galaxy #{idx}"

        sorted_members = sorted(list(comm))
        continents.append({
            "id": idx,
            "name": title,
            "color": color,
            "artistCount": len(sorted_members),
            "artistIds": sorted_members
        })

        for a_id in sorted_members:
            artist_continent_map[a_id] = {
                "continentId": idx,
                "continentName": title,
                "communityId": idx,
                "communityName": title,
                "color": color,
                "topSubgenres": final_tags.get(a_id, [])
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

    # 4. Two-Level Hierarchical Archipelago Layout Simulation
    print("\nStarting Spatial Layout Simulation...")
    coords = run_archipelago_layout(
        G,
        catalog_map,
        communities,
        final_tags,
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
    print(f"Stage 5 complete in {time.time() - start_time:.2f}s!")
    print("=" * 70)

if __name__ == "__main__":
    main()
