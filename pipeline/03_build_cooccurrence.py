"""
Stage 4A: Sparse CSR Matrix Bipartite Projection (C = M^T * M).
Transforms playlist-artist bipartite interactions into a symmetric artist co-occurrence
matrix using SciPy Compressed Sparse Row (CSR) linear algebra, preventing memory blowup.
Outputs:
- pipeline/output/cooccurrence_matrix.npz
- pipeline/output/artist_index.json
"""

import os
import sys
import json
import time
import numpy as np
import scipy.sparse as sp

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(PIPELINE_DIR, "output")

PLAYLISTS_FILE = os.path.join(OUTPUT_DIR, "harvested_playlists.json")
CATALOG_FILE = os.path.join(OUTPUT_DIR, "artists_catalog.json")
MATRIX_FILE = os.path.join(OUTPUT_DIR, "cooccurrence_matrix.npz")
INDEX_FILE = os.path.join(OUTPUT_DIR, "artist_index.json")

def main():
    if not os.path.exists(PLAYLISTS_FILE) or not os.path.exists(CATALOG_FILE):
        raise FileNotFoundError("Missing inputs for Stage 4A. Run stages 1-3 first.")

    print("=" * 70)
    print(" STAGE 4A: SPARSE CSR BIPARTITE PROJECTION (C = M^T * M)")
    print("=" * 70)
    start_time = time.time()

    with open(CATALOG_FILE, "r", encoding="utf-8") as f:
        catalog = json.load(f)
    with open(PLAYLISTS_FILE, "r", encoding="utf-8") as f:
        playlists = json.load(f)

    # Surviving catalog artist mapping
    catalog_artist_ids = {a["id"] for a in catalog}
    catalog_artist_names = {a["name"].lower().strip(): a["id"] for a in catalog}
    
    unique_artists = sorted(list(catalog_artist_ids))
    a_to_idx = {a_id: idx for idx, a_id in enumerate(unique_artists)}
    idx_to_a = {idx: a_id for a_id, idx in a_to_idx.items()}
    num_artists = len(unique_artists)

    # Build bipartite pairs: (playlist_idx, artist_idx)
    row_ind = []
    col_ind = []
    valid_playlists_count = 0

    for p_idx, pl in enumerate(playlists):
        seen_artists_in_pl = set()
        for t in pl.get("tracks", []):
            a_id = t.get("artist_id")
            a_name = t.get("artist_name", "").lower().strip()
            # Match by id or name
            resolved_id = None
            if a_id and a_id in a_to_idx:
                resolved_id = a_id
            elif a_name in catalog_artist_names:
                resolved_id = catalog_artist_names[a_name]

            if resolved_id and resolved_id in a_to_idx:
                col = a_to_idx[resolved_id]
                if col not in seen_artists_in_pl:
                    row_ind.append(p_idx)
                    col_ind.append(col)
                    seen_artists_in_pl.add(col)

        if seen_artists_in_pl:
            valid_playlists_count += 1

    num_playlists = len(playlists)
    print(f"Bipartite graph dimensions: {num_playlists} playlists x {num_artists} surviving artists.")
    print(f"Total bipartite incidences: {len(row_ind)}")

    row_arr = np.array(row_ind, dtype=np.int32)
    col_arr = np.array(col_ind, dtype=np.int32)
    data = np.ones(len(row_arr), dtype=np.float32)

    M = sp.csr_matrix((data, (row_arr, col_arr)), shape=(num_playlists, num_artists))
    # Ensure binary entries
    M.data = np.ones_like(M.data)

    print("Computing sparse co-occurrence projection: C = M^T * M ...")
    C = (M.T @ M).tocsr()

    print(f"Co-occurrence matrix computed: shape={C.shape}, non-zero elements={C.nnz}")

    # Save outputs
    sp.save_npz(MATRIX_FILE, C)

    with open(INDEX_FILE, "w", encoding="utf-8") as f:
        json.dump({
            "artist_to_idx": a_to_idx,
            "idx_to_artist": idx_to_a,
            "num_artists": num_artists,
            "num_playlists": num_playlists
        }, f, indent=2)

    print(f"Stage 4A complete in {time.time() - start_time:.2f}s. Saved {MATRIX_FILE} and {INDEX_FILE}")
    print("=" * 70)

if __name__ == "__main__":
    main()
