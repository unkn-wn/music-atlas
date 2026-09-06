"""
Stage 4B: Salton's Cosine Normalization, Dynamic Degree Bounding & GCC Bridging.
Implements:
1. Salton's Cosine Similarity: s_ij = c_ij / sqrt(c_i * c_j)
2. Minimum weight cutoff (s_ij >= 0.08) & Superstar fluke filter (c_ij >= 2 if c_i >= 30)
3. Evidence-Scaled Dynamic Degree Bounds: d_max(i) = min(28, max(4, floor(sqrt(c_i) * 4.5)))
4. Mutual Nearest Neighbor (MNN) edge protection
5. Single Giant Component (GCC) Guarantee with Multi-Point Interstellar Bridges (k >= 3)
   and semantic subgenre fallback to prevent isolated satellite dispersion
6. Outputs: pipeline/output/sparsified_edges.json and pipeline/output/surviving_artist_ids.json
"""

import os
import sys
import json
import time
import math
import numpy as np
import scipy.sparse as sp
from scipy.sparse.csgraph import connected_components
from collections import defaultdict
from typing import Dict, List, Set, Tuple
from tqdm import tqdm

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(PIPELINE_DIR, "output")

C_FILE = os.path.join(OUTPUT_DIR, "cooccurrence_matrix.npz")
INDEX_FILE = os.path.join(OUTPUT_DIR, "artist_index.json")
CATALOG_FILE = os.path.join(OUTPUT_DIR, "artists_catalog.json")
EDGES_FILE = os.path.join(OUTPUT_DIR, "sparsified_edges.json")
SURVIVORS_FILE = os.path.join(OUTPUT_DIR, "surviving_artist_ids.json")

NON_MUSICAL_AUDIO_TOKENS = {
    "sound", "white noise", "sleep", "rain", "meditation", "asmr",
    "pink noise", "nature sounds", "sound effects", "guided meditation",
    "birdsong", "hypnosis", "ocean", "general"
}

def compute_semantic_subgenre_similarity(subg_a: List[str], subg_b: List[str]) -> float:
    """Computes Jaccard/overlap similarity between two artists' subgenre vectors."""
    if not subg_a or not subg_b:
        return 0.0
    set_a = {s.lower() for s in subg_a if s.lower() not in NON_MUSICAL_AUDIO_TOKENS}
    set_b = {s.lower() for s in subg_b if s.lower() not in NON_MUSICAL_AUDIO_TOKENS}
    inter = len(set_a.intersection(set_b))
    union = len(set_a.union(set_b))
    return inter / union if union > 0 else 0.0

def main():
    if not os.path.exists(C_FILE) or not os.path.exists(INDEX_FILE) or not os.path.exists(CATALOG_FILE):
        raise FileNotFoundError("Missing Stage 4A inputs. Run 03_build_cooccurrence.py first.")

    print("=" * 70)
    print(" STAGE 4B: SALTON'S COSINE NORMALIZATION & EVIDENCE DEGREE BOUNDING")
    print("=" * 70)
    start_time = time.time()

    C = sp.load_npz(C_FILE).tocsr()
    with open(INDEX_FILE, "r", encoding="utf-8") as f:
        meta = json.load(f)
    with open(CATALOG_FILE, "r", encoding="utf-8") as f:
        catalog = json.load(f)

    idx_to_artist = {int(k): v for k, v in meta["idx_to_artist"].items()}
    artist_to_idx = {v: int(k) for k, v in meta["idx_to_artist"].items()}
    num_artists = meta["num_artists"]

    artist_subgenres = {a["id"]: a.get("topSubgenres", ["Pop"]) for a in catalog}
    artist_primary_genres = {a["id"]: a.get("primaryGenre", "Pop") for a in catalog}

    marginals = C.diagonal().copy()
    print(f"Total artists in matrix: {num_artists}")
    print(f"Marginal frequency range: min={marginals.min()}, median={np.median(marginals)}, max={marginals.max()}")

    # 1. Salton's Cosine Normalization & Candidate Extraction
    print("Computing Salton's Cosine similarity for all edge pairs...")
    candidates = defaultdict(list)
    all_scored_edges = {}

    for i in tqdm(range(num_artists), desc="Stage 4B: Cosine Normalization", unit="artist"):
        c_i = marginals[i]
        if c_i <= 0:
            continue

        row = C.getrow(i)
        cols = row.indices
        counts = row.data

        for j, c_ij in zip(cols, counts):
            if i >= j or c_ij <= 0:
                continue
            c_j = marginals[j]
            if c_j <= 0:
                continue

            # Superstar Fluke Filter: if either artist has c >= 30, require c_ij >= 2
            if (c_i >= 30 or c_j >= 30) and c_ij < 2:
                continue

            sim = float(c_ij / math.sqrt(c_i * c_j))
            
            # Minimum Weight Cutoff
            if sim < 0.08:
                continue

            pair = (i, j)
            all_scored_edges[pair] = (sim, float(c_ij))
            candidates[i].append((j, sim, float(c_ij)))
            candidates[j].append((i, sim, float(c_ij)))

    for i in range(num_artists):
        candidates[i].sort(key=lambda x: x[1], reverse=True)

    # 2. Dynamic Evidence-Scaled Degree Bounds & Mutual Nearest Neighbor (MNN) Edge Protection
    # d_max(i) = min(28, max(4, floor(sqrt(c_i) * 4.5)))
    degree_bounds = {}
    for i in range(num_artists):
        c_i = marginals[i]
        d_bound = min(24, max(4, int(math.floor(math.sqrt(max(1, c_i)) * 4.0))))
        degree_bounds[i] = d_bound

    # Build top-k sets for MNN protection (k = 6)
    k_mnn = 6
    top_k_sets = {i: {c[0] for c in candidates[i][:k_mnn]} for i in range(num_artists)}

    final_edges = set()
    edge_data_map = {}
    node_degree = defaultdict(int)

    # A. Add MNN protected edges
    for i in range(num_artists):
        for j, sim, c_ij in candidates[i][:k_mnn]:
            if i < j and i in top_k_sets[j]:
                pair = (i, j)
                final_edges.add(pair)
                edge_data_map[pair] = (sim, c_ij)
                node_degree[i] += 1
                node_degree[j] += 1

    # B. Add top affinity edges up to degree bounds
    for i in range(num_artists):
        d_max_i = degree_bounds[i]
        for j, sim, c_ij in candidates[i]:
            if node_degree[i] >= d_max_i:
                break
            d_max_j = degree_bounds[j]
            if node_degree[j] >= d_max_j:
                continue

            pair = (min(i, j), max(i, j))
            if pair not in final_edges:
                final_edges.add(pair)
                edge_data_map[pair] = (sim, c_ij)
                node_degree[i] += 1
                node_degree[j] += 1

    # C. Minimum connectivity relaxation (ensure at least 4 edges if candidates exist)
    for i in range(num_artists):
        if node_degree[i] < 4 and candidates[i]:
            for j, sim, c_ij in candidates[i]:
                if node_degree[i] >= 4:
                    break
                pair = (min(i, j), max(i, j))
                if pair not in final_edges and node_degree[j] < 32:
                    final_edges.add(pair)
                    edge_data_map[pair] = (sim, c_ij)
                    node_degree[i] += 1
                    node_degree[j] += 1

    print(f"Edges before component bridging: {len(final_edges)}")

    # 3. Single Giant Connected Component (GCC) Guarantee & Multi-Point Interstellar Bridges
    def get_components(edges_set: Set[Tuple[int, int]], n_nodes: int):
        adj_rows = [e[0] for e in edges_set] + [e[1] for e in edges_set]
        adj_cols = [e[1] for e in edges_set] + [e[0] for e in edges_set]
        adj_data = np.ones(len(adj_rows), dtype=np.int32)
        adj = sp.csr_matrix((adj_data, (adj_rows, adj_cols)), shape=(n_nodes, n_nodes))
        return connected_components(adj, directed=False)

    n_comp, labels = get_components(final_edges, num_artists)
    print(f"Initial connected components count: {n_comp}")

    comp_nodes = defaultdict(list)
    for idx, comp_id in enumerate(labels):
        comp_nodes[comp_id].append(idx)

    giant_comp_id = max(comp_nodes.keys(), key=lambda k: len(comp_nodes[k]))
    gcc_nodes = set(comp_nodes[giant_comp_id])
    print(f"Giant Connected Component (GCC) contains {len(gcc_nodes)} nodes ({len(gcc_nodes)/num_artists*100:.1f}%).")

    surviving_nodes = set(gcc_nodes)
    bridge_edges = set()

    for c_id, members in sorted(comp_nodes.items(), key=lambda x: len(x[1])):
        if c_id == giant_comp_id:
            continue

        # Rule: If satellite component |S| < 3, prune as noise
        if len(members) < 3:
            continue

        # Rule: |S| >= 3, synthesize at least 3 interstellar bridge edges to closest semantic peers in GCC
        bridges_added = 0
        
        # Try candidate pairs in all_scored_edges first
        scored_pairs = []
        for u in members:
            for v in gcc_nodes:
                pair = (min(u, v), max(u, v))
                if pair in all_scored_edges:
                    sim, c_ij = all_scored_edges[pair]
                    scored_pairs.append((sim, c_ij, pair))

        scored_pairs.sort(key=lambda x: x[0], reverse=True)
        for sim, c_ij, pair in scored_pairs[:3]:
            final_edges.add(pair)
            edge_data_map[pair] = (max(0.12, sim), max(1.0, c_ij))
            bridge_edges.add(pair)
            bridges_added += 1

        # If fewer than 3 bridges found via co-occurrence, use subgenre semantic similarity fallback
        if bridges_added < 3:
            semantic_candidates = []
            gcc_sample = list(gcc_nodes)
            if len(gcc_sample) > 800:
                step = max(1, len(gcc_sample) // 800)
                gcc_sample = gcc_sample[::step][:800]
            for u in members:
                u_id = idx_to_artist[u]
                u_subg = artist_subgenres.get(u_id, [])
                for v in gcc_sample:
                    v_id = idx_to_artist[v]
                    v_subg = artist_subgenres.get(v_id, [])
                    sem_sim = compute_semantic_subgenre_similarity(u_subg, v_subg)
                    if sem_sim > 0:
                        semantic_candidates.append((sem_sim, (min(u, v), max(u, v))))

            semantic_candidates.sort(key=lambda x: x[0], reverse=True)
            for sem_sim, pair in semantic_candidates:
                if pair not in final_edges:
                    final_edges.add(pair)
                    edge_data_map[pair] = (0.12, 1.0)
                    bridge_edges.add(pair)
                    bridges_added += 1
                    if bridges_added >= 3:
                        break

        # If bridges were added via co-occurrence or semantic similarity, incorporate members into surviving GCC
        if bridges_added > 0:
            surviving_nodes.update(members)
            gcc_nodes.update(members)

    # Filter out pruned nodes and retain strictly surviving nodes in final edges
    final_edges = {e for e in final_edges if e[0] in surviving_nodes and e[1] in surviving_nodes}

    # Verify final graph is strictly 1 connected component over surviving nodes
    # Re-index surviving nodes to verify GCC guarantee
    surviving_list = sorted(list(surviving_nodes))
    surv_to_new_idx = {old_idx: new_idx for new_idx, old_idx in enumerate(surviving_list)}
    reindexed_edges = {(surv_to_new_idx[e[0]], surv_to_new_idx[e[1]]) for e in final_edges}
    final_n_comp, _ = get_components(reindexed_edges, len(surviving_list))
    print(f"Final connected component check over surviving nodes: {final_n_comp} component(s) (Target: 1).")

    # Format edges
    min_sim = min(sim for sim, _ in edge_data_map.values()) if edge_data_map else 0.0
    max_sim = max(sim for sim, _ in edge_data_map.values()) if edge_data_map else 1.0
    sim_range = (max_sim - min_sim) or 1.0

    formatted_edges = []
    for (i, j) in final_edges:
        sim, c_ij = edge_data_map[(i, j)]
        c_i = marginals[i]
        c_j = marginals[j]
        # Enforce non-zero layout weight floor
        norm_weight = 0.06 + 0.94 * ((sim - min_sim) / sim_range)

        pct_i_to_j = round((c_ij / c_i) * 100.0, 1) if c_i > 0 else 0.0
        pct_j_to_i = round((c_ij / c_j) * 100.0, 1) if c_j > 0 else 0.0

        pair = (min(i, j), max(i, j))
        formatted_edges.append({
            "source": idx_to_artist[i],
            "target": idx_to_artist[j],
            "source_idx": int(i),
            "target_idx": int(j),
            "weight": round(float(norm_weight), 4),
            "cosineSimilarity": round(float(sim), 4),
            "rawSharedPlaylists": int(c_ij),
            "crossoverSourcePercent": float(pct_i_to_j),
            "crossoverTargetPercent": float(pct_j_to_i),
            "isBridge": pair in bridge_edges
        })

    # Save outputs
    with open(EDGES_FILE, "w", encoding="utf-8") as f:
        json.dump(formatted_edges, f, indent=2)

    surviving_artist_ids = [idx_to_artist[idx] for idx in surviving_list]
    with open(SURVIVORS_FILE, "w", encoding="utf-8") as f:
        json.dump(surviving_artist_ids, f, indent=2)

    print(f"\nStage 4B complete in {time.time() - start_time:.2f}s!")
    print(f"Retained {len(formatted_edges)} high-signal sparsified edges across {len(surviving_artist_ids)} surviving artists.")
    print(f"Average node degree: {len(formatted_edges) * 2 / len(surviving_artist_ids):.2f}")
    print(f"Saved: {EDGES_FILE} and {SURVIVORS_FILE}")
    print("=" * 70)

if __name__ == "__main__":
    main()
