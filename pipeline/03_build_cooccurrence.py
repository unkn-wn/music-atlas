"""
Stage 3: Sparse CSR Matrix Bipartite Projection (C = M^T * M).
Transforms playlist-artist bipartite interactions into a symmetric artist co-occurrence
matrix using SciPy Compressed Sparse Row (CSR) linear algebra with inverse-log playlist size damping:
W_ij = sum_{P | i,j in P} 1 / log2(|P|)
Outputs:
- pipeline/output/cooccurrence_matrix.npz
- pipeline/output/artist_index.json
"""

import os
import sys
import json
import time
import math
import numpy as np
import scipy.sparse as sp
from tqdm import tqdm

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

from sanitizer import split_artist_names

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(PIPELINE_DIR, "output")

PLAYLISTS_FILE = os.path.join(OUTPUT_DIR, "harvested_playlists.json")
CATALOG_FILE = os.path.join(OUTPUT_DIR, "artists_catalog.json")
MATRIX_FILE = os.path.join(OUTPUT_DIR, "cooccurrence_matrix.npz")
MATRIX_RAW_FILE = os.path.join(OUTPUT_DIR, "cooccurrence_matrix_raw.npz")
INDEX_FILE = os.path.join(OUTPUT_DIR, "artist_index.json")

def main():
    if not os.path.exists(PLAYLISTS_FILE) or not os.path.exists(CATALOG_FILE):
        raise FileNotFoundError("Missing inputs for Stage 3. Run stages 1 and 2 first.")

    print("=" * 70)
    print(" STAGE 3: SPARSE CSR BIPARTITE PROJECTION (C = M^T * M)")
    print(" Dual Projection: C_raw (factual shared playlists) & C_damped (inverse-log layout)")
    print("=" * 70)
    start_time = time.time()

    with open(CATALOG_FILE, "r", encoding="utf-8") as f:
        catalog = json.load(f)
    with open(PLAYLISTS_FILE, "r", encoding="utf-8") as f:
        playlists = json.load(f)

    catalog_artist_ids = {a["id"] for a in catalog}
    catalog_artist_names = {}
    for a in catalog:
        aid = a["id"]
        if "name" in a:
            catalog_artist_names[a["name"].lower().strip()] = aid
        if "scraped_name" in a:
            catalog_artist_names[a["scraped_name"].lower().strip()] = aid

    unique_artists = sorted(list(catalog_artist_ids))
    a_to_idx = {a_id: idx for idx, a_id in enumerate(unique_artists)}
    idx_to_a = {idx: a_id for a_id, idx in a_to_idx.items()}
    num_artists = len(unique_artists)

    row_ind = []
    col_ind = []
    data_damped_val = []
    data_raw_val = []

    for p_idx, pl in enumerate(tqdm(playlists, desc="Stage 3: Projecting Co-occurrences", unit="pl")):
        seen_artists_in_pl = set()
        for t in pl.get("tracks", []):
            a_id = t.get("artist_id")
            raw_a_name = t.get("artist_name", "")
            a_name = raw_a_name.lower().strip()

            resolved_ids = []
            if a_id and a_id in a_to_idx:
                resolved_ids.append(a_id)
            elif a_name in catalog_artist_names:
                resolved_ids.append(catalog_artist_names[a_name])
            else:
                # Resolve split collaboration names (e.g. "Drake & Future")
                splits = split_artist_names(raw_a_name)
                for s in splits:
                    s_clean = s.lower().strip()
                    if s_clean in catalog_artist_names:
                        resolved_ids.append(catalog_artist_names[s_clean])

            for r_id in resolved_ids:
                if r_id in a_to_idx:
                    seen_artists_in_pl.add(a_to_idx[r_id])

        if seen_artists_in_pl:
            pl_size = max(2, len(seen_artists_in_pl))
            weight = 1.0 / math.sqrt(math.log2(pl_size))
            for col in seen_artists_in_pl:
                row_ind.append(p_idx)
                col_ind.append(col)
                data_damped_val.append(weight)
                data_raw_val.append(1.0)

    num_playlists = len(playlists)
    print(f"Bipartite graph dimensions: {num_playlists} playlists x {num_artists} surviving artists.")
    print(f"Total bipartite incidences: {len(row_ind)}")

    row_arr = np.array(row_ind, dtype=np.int32)
    col_arr = np.array(col_ind, dtype=np.int32)
    data_damped_arr = np.array(data_damped_val, dtype=np.float32)
    data_raw_arr = np.array(data_raw_val, dtype=np.float32)

    M_damped = sp.csr_matrix((data_damped_arr, (row_arr, col_arr)), shape=(num_playlists, num_artists))
    M_raw = sp.csr_matrix((data_raw_arr, (row_arr, col_arr)), shape=(num_playlists, num_artists))

    print("Computing sparse co-occurrence projections: C_damped and C_raw ...")
    C_damped = (M_damped.T @ M_damped).tocsr()
    C_raw = (M_raw.T @ M_raw).tocsr()

    print(f"Co-occurrence matrices computed: shape={C_damped.shape}, non-zero elements={C_damped.nnz}")

    sp.save_npz(MATRIX_FILE, C_damped)
    sp.save_npz(MATRIX_RAW_FILE, C_raw)

    with open(INDEX_FILE, "w", encoding="utf-8") as f:
        json.dump({
            "artist_to_idx": a_to_idx,
            "idx_to_artist": idx_to_a,
            "num_artists": num_artists,
            "num_playlists": num_playlists
        }, f, indent=2)

    print(f"Stage 3 complete in {time.time() - start_time:.2f}s. Saved {MATRIX_FILE}, {MATRIX_RAW_FILE} and {INDEX_FILE}")
    print("=" * 70)

if __name__ == "__main__":
    main()
