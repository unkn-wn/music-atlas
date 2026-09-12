"""
Master Execution Script for the Autonomous Music Atlas Data & Layout Pipeline.
Runs stages sequentially:
1. Stage 0: EveryNoise Popularity Taxonomy Ingestion (00_harvest_genres.py)
2. Stage 1: Hybrid Community Playlist Harvesting (01_harvest_playlists.py)
3. Stage 2: Deterministic Verification & Metadata Enrichment (02_enrich_artists.py)
4. Stage 3: Sparse CSR Bipartite Projection C = M^T * M (03_build_cooccurrence.py)
5. Stage 4: Salton's Cosine Normalization & Dynamic Degree Bounds (04_normalize_and_sparsify.py)
6. Stage 5: Macro-Continents & Spatial Layout Simulation (05_community_and_layout.py)
7. Stage 6: Final Web Artifact Export atlas-graph.json (06_export_web_artifacts.py)
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
    ("00_harvest_genres.py", "Stage 0: EveryNoise Popularity Taxonomy Ingestion", 0),
    ("01_harvest_playlists.py", "Stage 1: Community Playlist Harvesting & Provenance Tagging", 1),
    ("02_enrich_artists.py", "Stage 2: Deterministic Verification & Metadata Enrichment", 2),
    ("03_build_cooccurrence.py", "Stage 3: Sparse CSR Matrix Bipartite Projection", 3),
    ("04_normalize_and_sparsify.py", "Stage 4: Salton's Cosine Normalization & Dynamic Degree Bounds", 4),
    ("05_community_and_layout.py", "Stage 5: Macro-Continents & Spatial Layout Simulation", 5),
    ("06_export_web_artifacts.py", "Stage 6: Final Web Artifact Export (atlas-graph.json)", 6)
]

def main():
    parser = argparse.ArgumentParser(description="Master Execution Pipeline for Music Atlas.")
    parser.add_argument("--tier", type=int, choices=[1, 2, 3, 4], default=2, help="Scale tier (1=500, 2=1500, 3=3000, 4=6291)")
    parser.add_argument("--target-playlists", type=int, default=20, help="Target qualifying community playlists per genre in Stage 1 (default: 20)")
    parser.add_argument("--min-playlists", type=int, default=4, help="Minimum playlist threshold c_i for candidate survival in Stage 2 (default: 4)")
    parser.add_argument("--offline", action="store_true", help="Bypass external HTTP calls; use disk cache & local snapshots")
    parser.add_argument("--skip-harvest", action="store_true", help="Skip Stages 0 and 1; start from Stage 2")
    parser.add_argument("--from-step", type=int, default=0, choices=range(0, 7), help="Start pipeline execution from specific step number (0-6)")
    parser.add_argument("--fresh", action="store_true", help="Start fresh by clearing checkpoints and re-harvesting all genres")
    parser.add_argument("--clear-cache", action="store_true", help="Wipe intermediate output files in pipeline/output/ before running")
    args = parser.parse_args()

    OUTPUT_DIR = os.path.join(PIPELINE_DIR, "output")
    if args.clear_cache and os.path.exists(OUTPUT_DIR):
        print("Clearing cached output files in pipeline/output/...")
        for fname in os.listdir(OUTPUT_DIR):
            fpath = os.path.join(OUTPUT_DIR, fname)
            if os.path.isfile(fpath) and not fname.endswith("cache.json"):
                try:
                    os.remove(fpath)
                except Exception:
                    pass

    print("=" * 75)
    print(f" STARTING AUTONOMOUS MUSIC ATLAS PIPELINE (Tier {args.tier})")
    print(f" Candidate Survival Threshold: c_i >= {args.min_playlists}")
    print(f" Target Playlists per Subgenre: {args.target_playlists}")
    print("=" * 75)
    start_all = time.time()
    total_steps = len(STEPS)

    for script, desc, step_idx in STEPS:
        if args.skip_harvest and step_idx in (0, 1):
            print(f"\n[Step {step_idx}/{total_steps-1}] Skipping {desc} (--skip-harvest active)...")
            continue

        if step_idx < args.from_step:
            print(f"\n[Step {step_idx}/{total_steps-1}] Skipping {desc} (--from-step {args.from_step} active)...")
            continue

        print(f"\n[Step {step_idx}/{total_steps-1}] Running {desc} ({script})...")
        step_start = time.time()
        script_path = os.path.join(PIPELINE_DIR, script)

        cmd = [sys.executable, script_path]
        if step_idx == 0:
            cmd.extend(["--tier", str(args.tier)])
            if args.offline:
                cmd.append("--offline")
        elif step_idx == 1:
            cmd.extend(["--target-playlists", str(args.target_playlists)])
            if args.fresh:
                cmd.append("--fresh")
        elif step_idx == 2:
            cmd.extend(["--min-playlists", str(args.min_playlists)])
            if args.offline:
                cmd.append("--offline")

        res = subprocess.run(cmd, cwd=PIPELINE_DIR)

        if res.returncode != 0:
            print(f"\nERROR in {script} (exit code {res.returncode})")
            sys.exit(1)
        else:
            print(f"[Step {step_idx}/{total_steps-1}] Done in {time.time() - step_start:.2f}s")

    print("\n" + "=" * 75)
    print(f" PIPELINE COMPLETE in {time.time() - start_all:.2f}s")
    print(" Generated Web Artifact: web/public/data/atlas-graph.json")
    print("=" * 75)

if __name__ == "__main__":
    main()
