"""
Step 2: Sparse Matrix Bipartite Projection (C = M^T * M).
Efficiently transforms playlist-artist bipartite interactions into a symmetric
artist co-occurrence matrix using SciPy Compressed Sparse Row (CSR) linear algebra,
preventing relational table blowups and OOM issues.
"""

import os
import json
import numpy as np
import scipy.sparse as sp

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")

def main():
    pairs_file = os.path.join(OUTPUT_DIR, "playlist_artist_pairs.json")
    if not os.path.exists(pairs_file):
        raise FileNotFoundError(f"Missing {pairs_file}. Please run 01_data_source.py first.")

    with open(pairs_file, "r", encoding="utf-8") as f:
        pairs = json.load(f)

    print(f"Loaded {len(pairs)} bipartite playlist-artist edges.")

    # Unique IDs
    unique_playlists = sorted(list({p[0] for p in pairs}))
    unique_artists = sorted(list({p[1] for p in pairs}))

    p_to_idx = {p: i for i, p in enumerate(unique_playlists)}
    a_to_idx = {a: i for i, a in enumerate(unique_artists)}
    idx_to_a = {i: a for a, i in a_to_idx.items()}

    num_p = len(unique_playlists)
    num_a = len(unique_artists)
    print(f"Bipartite graph dimensions: {num_p} playlists x {num_a} artists.")

    # Build CSR matrix
    row_ind = np.array([p_to_idx[p[0]] for p in pairs], dtype=np.int32)
    col_ind = np.array([a_to_idx[p[1]] for p in pairs], dtype=np.int32)
    data = np.ones(len(pairs), dtype=np.float32)

    M = sp.csr_matrix((data, (row_ind, col_ind)), shape=(num_p, num_a))
    # Ensure binary (in case an artist appeared multiple times in same playlist)
    M.data = np.ones_like(M.data)

    print("Computing sparse co-occurrence matrix: C = M^T * M ...")
    C = (M.T @ M).tocsr()

    print(f"Co-occurrence matrix computed: shape={C.shape}, non-zero elements={C.nnz}")

    # Save sparse matrix and index mappings
    sp.save_npz(os.path.join(OUTPUT_DIR, "cooccurrence_matrix.npz"), C)

    with open(os.path.join(OUTPUT_DIR, "artist_index.json"), "w", encoding="utf-8") as f:
        json.dump({
            "artist_to_idx": a_to_idx,
            "idx_to_artist": idx_to_a,
            "num_artists": num_a,
            "num_playlists": num_p
        }, f, indent=2)

    print("Step 2 completed successfully. Saved cooccurrence_matrix.npz and artist_index.json")

if __name__ == "__main__":
    main()
