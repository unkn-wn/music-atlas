"""
Master Execution Script for the Music Atlas Data & Layout Pipeline.
Runs steps 1 through 7 sequentially:
1. Data Ingestion / High-fidelity Bipartite Generation
2. Sparse CSR Matrix Bipartite Projection (C = M^T * M)
3. Salton's Cosine Normalization & Mutual k-NN Sparsification
4. Leiden / Louvain Community Detection & TF-IDF Continent Naming
5. Two-Phase ForceAtlas2 Layout Spatialization
6. Metadata & Open Audio Preview Hydration
7. Web Artifact Bundling (atlas-graph.json)
"""

import time
import subprocess
import sys
import os

STEPS = [
    ("01_data_source.py", "Data Ingestion & Bipartite Projection"),
    ("02_build_cooccurrence.py", "Sparse CSR Matrix Multiplication (C = M^T * M)"),
    ("03_normalize_and_sparsify.py", "Salton Cosine Normalization & Mutual k-NN"),
    ("04_community_detection.py", "Community Detection & Consensus Genre Naming"),
    ("05_layout_forceatlas2.py", "Two-Phase ForceAtlas2 Spatial Physics"),
    ("06_hydrate_metadata.py", "Metadata & Audio Preview Hydration"),
    ("07_export_web_artifacts.py", "Export WebGL Artifacts (atlas-graph.json)")
]

def main():
    pipeline_dir = os.path.dirname(os.path.abspath(__file__))
    print("=" * 70)
    print(" STARTING MUSIC ATLAS DATA & LAYOUT PIPELINE")
    print("=" * 70)
    start_all = time.time()

    for idx, (script, desc) in enumerate(STEPS, start=1):
        print(f"\n[Step {idx}/7] Running {desc} ({script})...")
        step_start = time.time()
        script_path = os.path.join(pipeline_dir, script)
        res = subprocess.run([sys.executable, script_path], cwd=pipeline_dir, capture_output=True, text=True)

        if res.returncode != 0:
            print(f"\nERROR in {script}:")
            print(res.stderr)
            print(res.stdout)
            sys.exit(1)
        else:
            print(res.stdout.strip())
            print(f"[Step {idx}/7] Done in {time.time() - step_start:.2f}s")

    print("\n" + "=" * 70)
    print(f" PIPELINE COMPLETE in {time.time() - start_all:.2f}s")
    print(" Generated: web/public/data/atlas-graph.json")
    print("=" * 70)

if __name__ == "__main__":
    main()
