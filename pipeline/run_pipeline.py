"""
Master Execution Script for the Autonomous Music Atlas Data & Layout Pipeline.
Runs stages sequentially:
1. EveryNoise Popularity Taxonomy Ingestion (00_harvest_genres.py)
2. Two-Pass Quality-Filtered Community Playlist Harvesting (01_harvest_playlists.py)
3. Fast Candidate Catalog & Multi-Subgenre Resolution (02_enrich_artists.py --catalog-only)
4. Sparse CSR Bipartite Projection C = M^T * M (03_build_cooccurrence.py)
5. Salton's Cosine Normalization & Dynamic Degree Bounding (04_normalize_and_sparsify.py)
6. Louvain Modularity Naming & ForceAtlas2 Layout Physics (05_community_and_layout.py)
7. WebGL Artifact Bundling atlas-graph.json (06_export_web_artifacts.py)
8. Targeted Preview & Portrait Hydration for Connected Nodes (02_enrich_artists.py --hydrate-graph)
9. Final Synchronization of Headliners & Crossovers (06_export_web_artifacts.py)
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
    ("00_harvest_genres.py", "Stage 1: EveryNoise Popularity Taxonomy Ingestion", 1),
    ("01_harvest_playlists.py", "Stage 2: Community Playlist Harvesting & Provenance Tagging", 2),
    ("02_enrich_artists.py", "Stage 3: Fast Candidate Catalog & Subgenre Resolution", 3),
    ("03_build_cooccurrence.py", "Stage 4A: Sparse CSR Matrix Bipartite Projection (C = M^T * M)", 4),
    ("04_normalize_and_sparsify.py", "Stage 4B: Salton's Cosine Normalization & Dynamic Degree Bounds", 5),
    ("05_community_and_layout.py", "Stage 4C: Louvain Modularity & ForceAtlas2 Spatial Physics", 6),
    ("06_export_web_artifacts.py", "Stage 5: WebGL Artifact Bundling (Initial atlas-graph.json)", 7),
    ("02_enrich_artists.py", "Stage 6: Targeted Preview & Portrait Hydration (Connected Nodes)", 8),
    ("06_export_web_artifacts.py", "Stage 7: Final Synchronization of Headliners & Crossovers", 9)
]

def main():
    parser = argparse.ArgumentParser(description="Master Execution Pipeline for Music Atlas.")
    parser.add_argument("--tier", type=int, choices=[1, 2, 3, 4], default=2, help="Scale tier (1=500, 2=1500, 3=3000, 4=6291)")
    parser.add_argument("--playlists-per-genre", type=int, default=20, help="Candidate community playlists to check per genre in Stage 2 (default: 20)")
    parser.add_argument("--min-playlists", type=int, default=4, help="Minimum playlist threshold c_i for candidate survival in Stage 3 (default: 4)")
    parser.add_argument("--offline", action="store_true", help="Bypass external HTTP calls; use disk cache & local snapshots")
    parser.add_argument("--skip-harvest", action="store_true", help="Skip Stage 1 and 2 network crawling; start from Stage 3")
    parser.add_argument("--from-step", type=int, default=1, choices=range(1, 10), help="Start pipeline execution from specific step number (1-9)")
    parser.add_argument("--skip-hydration", action="store_true", help="Skip Stages 6 & 7 hydration to preview interactive graph immediately (~3 min)")
    parser.add_argument("--workers", type=int, default=2, help="Concurrency for network hydration (default: 2)")
    parser.add_argument("--limit-lookups", type=int, default=0, help="Max artists to look up over network during hydration (0=all)")
    parser.add_argument("--fast-layout", action="store_true", help="Run accelerated layout iterations for fast builds (~30s)")
    parser.add_argument("--fresh", action="store_true", help="Start fresh by clearing checkpoints and re-harvesting all genres")
    parser.add_argument("--clear-cache", action="store_true", help="Wipe all intermediate output files in pipeline/output/ before running")
    args = parser.parse_args()

    OUTPUT_DIR = os.path.join(PIPELINE_DIR, "output")
    if args.clear_cache and os.path.exists(OUTPUT_DIR):
        print("Clearing cached output files in pipeline/output/...")
        for fname in os.listdir(OUTPUT_DIR):
            fpath = os.path.join(OUTPUT_DIR, fname)
            if os.path.isfile(fpath):
                try:
                    os.remove(fpath)
                except Exception:
                    pass

    print("=" * 75)
    print(f" STARTING EXPANDED AUTONOMOUS MUSIC ATLAS PIPELINE (Tier {args.tier})")
    print(f" Candidate Survival Threshold: c_i >= {args.min_playlists}")
    if args.skip_hydration or args.offline:
        print(" Mode: Graph-Only Fast Preview (Hydration Skipped)")
    print("=" * 75)
    start_all = time.time()
    total_steps = len(STEPS)

    for script, desc, step_idx in STEPS:
        if args.skip_harvest and step_idx in (1, 2):
            print(f"\n[Step {step_idx}/{total_steps}] Skipping {desc} (--skip-harvest active)...")
            continue

        if step_idx < args.from_step:
            print(f"\n[Step {step_idx}/{total_steps}] Skipping {desc} (--from-step {args.from_step} active)...")
            continue

        if (args.skip_hydration or args.offline) and step_idx in (8, 9):
            print(f"\n[Step {step_idx}/{total_steps}] Skipping {desc} (--skip-hydration / --offline active)...")
            continue

        print(f"\n[Step {step_idx}/{total_steps}] Running {desc} ({script})...")
        step_start = time.time()
        script_path = os.path.join(PIPELINE_DIR, script)

        cmd = [sys.executable, script_path]
        if step_idx == 1:
            cmd.extend(["--tier", str(args.tier)])
            if args.offline:
                cmd.append("--offline")
        elif step_idx == 2:
            cmd.extend(["--playlists-per-genre", str(args.playlists_per_genre)])
            if args.offline:
                cmd.extend(["--limit-genres", "0"])
            if args.fresh:
                cmd.append("--fresh")
        elif step_idx == 3:
            cmd.extend(["--catalog-only", "--min-playlists", str(args.min_playlists)])
            if args.offline:
                cmd.append("--offline")
        elif step_idx == 6:
            if args.fast_layout:
                cmd.extend(["--num-iters", "80"])
        elif step_idx == 8:
            cmd.append("--hydrate-graph")
            if args.workers != 2:
                cmd.extend(["--workers", str(args.workers)])
            if args.limit_lookups > 0:
                cmd.extend(["--limit-lookups", str(args.limit_lookups)])
            if args.offline:
                cmd.append("--offline")

        res = subprocess.run(cmd, cwd=PIPELINE_DIR)

        if res.returncode != 0:
            print(f"\nERROR in {script} (exit code {res.returncode})")
            sys.exit(1)
        else:
            print(f"[Step {step_idx}/{total_steps}] Done in {time.time() - step_start:.2f}s")

    print("\n" + "=" * 75)
    print(f" PIPELINE COMPLETE in {time.time() - start_all:.2f}s")
    print(" Generated Web Artifact: web/public/data/atlas-graph.json")
    print("=" * 75)

if __name__ == "__main__":
    main()
