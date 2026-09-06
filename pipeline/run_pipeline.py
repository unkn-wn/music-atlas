"""
Master Execution Script for the Autonomous Music Atlas Data & Layout Pipeline.
Runs stages 00 through 06 sequentially:
1. EveryNoise Popularity Taxonomy Ingestion (00_harvest_genres.py)
2. Two-Pass Quality-Filtered Community Playlist Harvesting (01_harvest_playlists.py)
3. Multi-Subgenre Resolution & Empirical Sizing Enrichment (02_enrich_artists.py)
4. Sparse CSR Bipartite Projection C = M^T * M (03_build_cooccurrence.py)
5. Salton's Cosine Normalization & Dynamic Degree Bounding (04_normalize_and_sparsify.py)
6. Louvain Modularity Naming & ForceAtlas2 Layout Physics (05_community_and_layout.py)
7. WebGL Artifact Bundling atlas-graph.json (06_export_web_artifacts.py)
"""

import os
import sys
import time
import subprocess
import argparse

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))

STEPS = [
    ("00_harvest_genres.py", "Stage 1: EveryNoise Popularity Taxonomy Ingestion"),
    ("01_harvest_playlists.py", "Stage 2: Community Playlist Harvesting & Provenance Tagging"),
    ("02_enrich_artists.py", "Stage 3: Multi-Subgenre Resolution & Empirical Sizing"),
    ("03_build_cooccurrence.py", "Stage 4A: Sparse CSR Matrix Bipartite Projection (C = M^T * M)"),
    ("04_normalize_and_sparsify.py", "Stage 4B: Salton's Cosine Normalization & Dynamic Degree Bounds"),
    ("05_community_and_layout.py", "Stage 4C: Louvain Modularity & ForceAtlas2 Spatial Physics"),
    ("06_export_web_artifacts.py", "Stage 5: Export WebGL Artifacts (atlas-graph.json)")
]

def main():
    parser = argparse.ArgumentParser(description="Master Execution Pipeline for Music Atlas.")
    parser.add_argument("--tier", type=int, choices=[1, 2, 3, 4], default=2, help="Scale tier (1=500, 2=1500, 3=3000, 4=6291)")
    parser.add_argument("--offline", action="store_true", help="Bypass external HTTP calls; use disk cache & local snapshots")
    parser.add_argument("--skip-harvest", action="store_true", help="Skip Stage 1 and 2 network crawling; rebuild graph from cached data")
    parser.add_argument("--fast-layout", action="store_true", help="Run accelerated layout iterations for fast builds (~30s)")
    args = parser.parse_args()

    print("=" * 75)
    print(f" STARTING EXPANDED AUTONOMOUS MUSIC ATLAS PIPELINE (Tier {args.tier})")
    print("=" * 75)
    start_all = time.time()

    for idx, (script, desc) in enumerate(STEPS, start=1):
        if args.skip_harvest and idx in (1, 2):
            print(f"\n[Step {idx}/7] Skipping {desc} (--skip-harvest active)...")
            continue

        print(f"\n[Step {idx}/7] Running {desc} ({script})...")
        step_start = time.time()
        script_path = os.path.join(PIPELINE_DIR, script)

        cmd = [sys.executable, script_path]
        if idx == 1:
            cmd.extend(["--tier", str(args.tier)])
            if args.offline:
                cmd.append("--offline")
        elif idx == 2:
            if args.offline:
                cmd.extend(["--limit-genres", "0"])
        elif idx == 3:
            if args.offline:
                cmd.append("--offline")
        elif idx == 6:
            if args.fast_layout:
                cmd.extend(["--iter-macro", "120", "--iter-micro", "60"])

        res = subprocess.run(cmd, cwd=PIPELINE_DIR, capture_output=True, text=True, encoding="utf-8")

        if res.returncode != 0:
            print(f"\nERROR in {script}:")
            if res.stderr:
                print(res.stderr)
            if res.stdout:
                print(res.stdout)
            sys.exit(1)
        else:
            if res.stdout:
                print(res.stdout.strip())
            print(f"[Step {idx}/7] Done in {time.time() - step_start:.2f}s")

    print("\n" + "=" * 75)
    print(f" PIPELINE COMPLETE in {time.time() - start_all:.2f}s")
    print(" Generated: web/public/data/atlas-graph.json")
    print("=" * 75)

if __name__ == "__main__":
    main()
