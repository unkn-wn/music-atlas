import os
import json
import math
import numpy as np
import scipy.sparse as sp
from scipy.sparse.csgraph import connected_components
from collections import defaultdict

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")

def main(k_local: int = 24, k_bridge: int = 8, max_degree: int = 60, min_cooccurrence: int = 3):
    C_file = os.path.join(OUTPUT_DIR, "cooccurrence_matrix.npz")
    idx_file = os.path.join(OUTPUT_DIR, "artist_index.json")
    catalog_file = os.path.join(OUTPUT_DIR, "artists_catalog.json")

    if not os.path.exists(C_file) or not os.path.exists(idx_file):
        raise FileNotFoundError("Missing inputs from step 2. Run 02_build_cooccurrence.py first.")

    C = sp.load_npz(C_file).tocsr()
    with open(idx_file, "r", encoding="utf-8") as f:
        meta = json.load(f)
    with open(catalog_file, "r", encoding="utf-8") as f:
        catalog = json.load(f)

    idx_to_artist = {int(k): v for k, v in meta["idx_to_artist"].items()}
    artist_to_idx = {v: int(k) for k, v in meta["idx_to_artist"].items()}
    num_artists = meta["num_artists"]

    # Map artist ID to macro_genre
    id_to_genre = {a["id"]: a.get("macro_genre", "Pop") for a in catalog}
    idx_to_genre = {i: id_to_genre.get(idx_to_artist[i], "Pop") for i in range(num_artists)}

    # Marginal frequencies (diagonal)
    marginals = C.diagonal().copy()
    print(f"Marginal frequency range: min={marginals.min()}, median={np.median(marginals)}, max={marginals.max()}")

    # Find candidate neighbors: balanced top-k preserving natural bridges
    print("Normalizing edges using Salton's Cosine with balanced multiscale k-NN...")
    global_candidates = defaultdict(list)
    intra_candidates = defaultdict(list)
    inter_candidates = defaultdict(list)
    all_scored_edges = {}

    for i in range(num_artists):
        row = C.getrow(i)
        cols = row.indices
        counts = row.data
        c_i = marginals[i]
        if c_i <= 0:
            continue

        g_i = idx_to_genre[i]

        for j, c_ij in zip(cols, counts):
            if i == j or c_ij < min_cooccurrence:
                continue
            c_j = marginals[j]
            if c_j <= 0:
                continue

            cosine = float(c_ij / math.sqrt(c_i * c_j))
            pair = (min(i, j), max(i, j))
            all_scored_edges[pair] = (cosine, float(c_ij))

            item = (j, cosine, float(c_ij))
            if idx_to_genre[j] == g_i:
                intra_candidates[i].append(item)
            else:
                inter_candidates[i].append(item)

        intra_candidates[i].sort(key=lambda x: x[1], reverse=True)
        inter_candidates[i].sort(key=lambda x: x[1], reverse=True)

        # Balanced candidates: top 8-10 intra + top 6-8 inter
        top_intra = intra_candidates[i][:10]
        top_inter = inter_candidates[i][:8]
        combined = top_intra + top_inter
        combined.sort(key=lambda x: x[1], reverse=True)
        global_candidates[i] = combined

    # Convert to sets for mutual checks
    top_sets = {i: {n[0] for n in global_candidates[i]} for i in range(num_artists)}

    final_edges = set()
    edge_data_map = {}
    node_degree = defaultdict(int)

    # 1. Mutual k-NN & strong affinity edges
    for i in range(num_artists):
        for j, sim, c_ij in global_candidates[i]:
            if i < j:
                # Keep if mutual neighbor or high similarity
                if (i in top_sets[j]) or (sim >= 0.12):
                    if node_degree[i] < max_degree and node_degree[j] < max_degree:
                        pair = (i, j)  # Canonical order: i < j
                        final_edges.add(pair)
                        edge_data_map[pair] = (sim, c_ij)
                        node_degree[i] += 1
                        node_degree[j] += 1

    # 2. Minimum connectivity relaxation (guarantee every node has at least 6 connections)
    for i in range(num_artists):
        if node_degree[i] < 6:
            candidates = intra_candidates[i][:8] + inter_candidates[i][:6]
            candidates.sort(key=lambda x: x[1], reverse=True)
            for j, sim, c_ij in candidates:
                if node_degree[i] >= 6:
                    break
                pair = (min(i, j), max(i, j))
                if pair not in final_edges and node_degree[j] < max_degree:
                    final_edges.add(pair)
                    edge_data_map[pair] = (sim, c_ij)
                    node_degree[i] += 1
                    node_degree[j] += 1

    # 4. Guarantee global single connected component (MST bridge across disconnected clusters)
    # Build adjacency matrix for connected components check
    adj_rows = [e[0] for e in final_edges] + [e[1] for e in final_edges]
    adj_cols = [e[1] for e in final_edges] + [e[0] for e in final_edges]
    adj_data = np.ones(len(adj_rows), dtype=np.int32)
    adj = sp.csr_matrix((adj_data, (adj_rows, adj_cols)), shape=(num_artists, num_artists))

    n_components, labels = connected_components(adj, directed=False)
    print(f"Graph connectivity check: {n_components} component(s) found.")

    if n_components > 1:
        print(f"Bridging {n_components} components into a unified galaxy...")
        # Find best bridge from each secondary component to component 0
        comp_nodes = defaultdict(list)
        for idx, comp_id in enumerate(labels):
            comp_nodes[comp_id].append(idx)

        giant_comp_id = max(comp_nodes.keys(), key=lambda k: len(comp_nodes[k]))
        main_nodes = set(comp_nodes[giant_comp_id])
        for c_id in sorted(comp_nodes.keys()):
            if c_id == giant_comp_id:
                continue
            nodes_in_c = comp_nodes[c_id]
            best_pair = None
            best_sim = -1.0
            best_c_ij = 0.0

            for u in nodes_in_c:
                for v in main_nodes:
                    pair = (min(u, v), max(u, v))
                    if pair in all_scored_edges:
                        sim, c_ij = all_scored_edges[pair]
                        if sim > best_sim:
                            best_sim = sim
                            best_c_ij = c_ij
                            best_pair = pair

            if best_pair:
                final_edges.add(best_pair)
                edge_data_map[best_pair] = (best_sim, best_c_ij)
                main_nodes.update(nodes_in_c)

    print(f"Retained {len(final_edges)} high-signal sparsified edges (avg degree: {len(final_edges) * 2 / num_artists:.2f}).")

    min_sim = min(sim for sim, _ in edge_data_map.values()) if edge_data_map else 0.0
    max_sim = max(sim for sim, _ in edge_data_map.values()) if edge_data_map else 1.0
    sim_range = (max_sim - min_sim) or 1.0

    formatted_edges = []
    for (i, j) in final_edges:
        sim, c_ij = edge_data_map[(i, j)]
        c_i = marginals[i]
        c_j = marginals[j]

        norm_weight = (sim - min_sim) / sim_range

        pct_i_to_j = round((c_ij / c_i) * 100.0, 1) if c_i > 0 else 0.0
        pct_j_to_i = round((c_ij / c_j) * 100.0, 1) if c_j > 0 else 0.0

        formatted_edges.append({
            "source": idx_to_artist[i],
            "target": idx_to_artist[j],
            "source_idx": int(i),
            "target_idx": int(j),
            "weight": round(float(norm_weight), 4),
            "cosineSimilarity": round(float(sim), 4),
            "rawSharedPlaylists": int(c_ij),
            "crossoverSourcePercent": float(pct_i_to_j),
            "crossoverTargetPercent": float(pct_j_to_i)
        })

    out_file = os.path.join(OUTPUT_DIR, "sparsified_edges.json")
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(formatted_edges, f, indent=2)

    print(f"Step 3 complete. Sparsified edges saved to {out_file}")

if __name__ == "__main__":
    main()
