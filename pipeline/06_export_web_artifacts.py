"""
Stage 6: Final Web Artifact Export (atlas-graph.json).
Assembles layout coordinates, continents, final genre tags (Stage 5), node sizes from verified fan counts,
and drawn connections (connections.py: each artist's top 6 by playlist overlap plus bridge edges; the drawer
lists exactly these) into a unified, lightweight JSON bundle for the Cosmograph WebGL frontend.
Outputs:
- pipeline/output/atlas-graph.json
- web/public/data/atlas-graph.json (and .json.gz)
- details/continent_<id>.json in both directories (drawer details, loaded per continent)
"""

import os
import sys
import json
import gzip
import math
import time
from datetime import datetime
from collections import defaultdict
from tqdm import tqdm

from connections import by_overlap, neighbor_lists, drawn_pairs

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(PIPELINE_DIR, "output")
WEB_DATA_DIR = os.path.join(os.path.dirname(PIPELINE_DIR), "web", "public", "data")
os.makedirs(WEB_DATA_DIR, exist_ok=True)

CATALOG_FILE = os.path.join(OUTPUT_DIR, "artists_catalog.json")
COMMUNITIES_FILE = os.path.join(OUTPUT_DIR, "communities.json")
LAYOUT_FILE = os.path.join(OUTPUT_DIR, "layout_coordinates.json")
EDGES_FILE = os.path.join(OUTPUT_DIR, "sparsified_edges.json")
SURVIVORS_FILE = os.path.join(OUTPUT_DIR, "surviving_artist_ids.json")

def main():
    if not all(os.path.exists(f) for f in [CATALOG_FILE, COMMUNITIES_FILE, LAYOUT_FILE, EDGES_FILE]):
        raise FileNotFoundError("Missing Stage 2, 4 or 5 outputs. Run earlier pipeline stages first.")

    print("=" * 70)
    print(" STAGE 6: LIGHTWEIGHT WEB ARTIFACT EXPORT (atlas-graph.json)")
    print("=" * 70)
    start_time = time.time()

    with open(CATALOG_FILE, "r", encoding="utf-8") as f:
        catalog = json.load(f)
    with open(COMMUNITIES_FILE, "r", encoding="utf-8") as f:
        comm_data = json.load(f)
    with open(LAYOUT_FILE, "r", encoding="utf-8") as f:
        coords = json.load(f)
    with open(EDGES_FILE, "r", encoding="utf-8") as f:
        edges = json.load(f)

    # Load surviving artist IDs from Stage 4
    surviving_ids = set()
    if os.path.exists(SURVIVORS_FILE):
        with open(SURVIVORS_FILE, "r", encoding="utf-8") as f:
            surviving_ids = set(json.load(f))
    else:
        surviving_ids = set(coords.keys())

    catalog_map = {a["id"]: a for a in catalog if a["id"] in surviving_ids and a["id"] in coords}
    artist_continent_map = comm_data.get("artist_continent_map", {})
    continents = comm_data.get("continents", [])

    print(f"Loaded {len(catalog_map)} verified surviving artists with layout coordinates.")

    # 1. Index edge relationships per artist
    raw_neighbors = neighbor_lists(edges, set(catalog_map))

    # 2. Compute subscriber scaling range for empirical node sizing using Log10-Power scaling
    all_subs = [max(1000, a.get("subscribers", 1000)) for a in catalog_map.values()]
    min_subs = min(all_subs) if all_subs else 1000
    max_subs = max(all_subs) if all_subs else 25_000_000
    log_min = math.log10(min_subs)
    log_max = math.log10(max_subs)
    log_diff = (log_max - log_min) or 1.0

    OUTPUT_DETAILS_DIR = os.path.join(OUTPUT_DIR, "details")
    WEB_DETAILS_DIR = os.path.join(WEB_DATA_DIR, "details")
    os.makedirs(OUTPUT_DETAILS_DIR, exist_ok=True)
    os.makedirs(WEB_DETAILS_DIR, exist_ok=True)

    # 3. Assemble Nodes and Decoupled Detail Dictionary
    nodes = []
    details = {}

    # Drawn edges: each artist's top 6 by playlist overlap (capped to eliminate panning lag),
    # plus bridge edges connecting satellite clusters
    active_edge_pairs = drawn_pairs(edges, raw_neighbors, set(catalog_map))

    for a_id, meta in tqdm(catalog_map.items(), desc="Stage 6: Assembling Web Nodes & Details", unit="node"):
        pos = coords.get(a_id, {"x": 0.0, "y": 0.0})
        comm_info = artist_continent_map[a_id]
        tags = comm_info["topSubgenres"]

        subs = max(1000, meta.get("subscribers", 1000))
        ratio = (math.log10(subs) - log_min) / log_diff
        ratio = max(0.0, min(1.0, ratio))
        node_size = round(1.1 + (ratio ** 2.6) * 13.4, 1)

        # Drawer lists exactly this artist's drawn connections (variable length), as [id, overlap%, shared, self%, neighbor%]
        c_i = meta.get("totalPlaylists") or meta.get("sharedPlaylistsCount") or len(raw_neighbors[a_id])
        drawn_connections = by_overlap([
            n for n in raw_neighbors[a_id] if tuple(sorted([a_id, n["neighborId"]])) in active_edge_pairs
        ])
        compact_connections = [
            [n["neighborId"], n["overlapPercent"], n["sharedPlaylists"], n["selfPercent"], n["neighborPercent"]]
            for n in drawn_connections
        ]

        nodes.append({
            "id": a_id,
            "label": meta["name"],
            "x": round(pos["x"], 1),
            "y": round(pos["y"], 1),
            "size": node_size,
            "color": comm_info["color"],
            "continentId": comm_info["continentId"],
            "topSubgenres": tags,
            "image": meta.get("image", ""),
            "subscribers": subs
        })

        details[a_id] = {
            "subscribersFormatted": meta.get("subscribersFormatted") or meta.get("formattedSubscribers") or f"{subs:,}",
            "previewUrl": meta.get("previewUrl", ""),
            "deezerUrl": meta.get("deezerUrl", ""),
            "totalPlaylists": c_i,
            "topCrossovers": compact_connections
        }

    # 4. Assemble High-Performance Straight Edges (Strictly Active Pairs + Bridges)
    formatted_edges = []
    for e in tqdm(edges, desc="Stage 6: Assembling Straight Edges", unit="edge"):
        src = e["source"]
        dst = e["target"]
        if src not in catalog_map or dst not in catalog_map:
            continue
        pair = tuple(sorted([src, dst]))
        if pair not in active_edge_pairs:
            continue

        edge_dict = {
            "source": src,
            "target": dst,
            "weight": round(float(e["weight"]), 4),
            "size": max(0.08, round(e["weight"] * 0.9, 2)),
            "playlists": int(e.get("rawSharedPlaylists", 1))
        }
        if e.get("isBridge"):
            edge_dict["isBridge"] = True

        formatted_edges.append(edge_dict)

    clean_continents = [
        {
            "id": c["id"],
            "name": c["name"],
            "color": c["color"],
            "artistCount": c.get("artistCount", len(c.get("artistIds", [])))
        }
        for c in continents
    ]

    bundle = {
        "metadata": {
            "generatedAt": datetime.now().isoformat(),
            "nodeCount": len(nodes),
            "edgeCount": len(formatted_edges),
            "continentCount": len(clean_continents),
            "version": "2.0.0"
        },
        "continents": clean_continents,
        "nodes": nodes,
        "edges": formatted_edges
    }

    # Save atlas-graph.json (pipeline and web) minified
    out_pipeline = os.path.join(OUTPUT_DIR, "atlas-graph.json")
    with open(out_pipeline, "w", encoding="utf-8") as f:
        json.dump(bundle, f, separators=(',', ':'))

    out_web = os.path.join(WEB_DATA_DIR, "atlas-graph.json")
    with open(out_web, "w", encoding="utf-8") as f:
        json.dump(bundle, f, separators=(',', ':'))

    # Also export compressed atlas-graph.json.gz (6.17 MB) for fast web streaming & Cloudflare 25MB limit
    out_web_gz = os.path.join(WEB_DATA_DIR, "atlas-graph.json.gz")
    with open(out_web, "rb") as f_in, gzip.open(out_web_gz, "wb", compresslevel=6) as f_out:
        f_out.writelines(f_in)

    # Purge old continent detail files before writing new ones
    for target_dir in [WEB_DETAILS_DIR, OUTPUT_DETAILS_DIR]:
        if os.path.exists(target_dir):
            for fname in os.listdir(target_dir):
                if fname.startswith("continent_") and fname.endswith(".json"):
                    try:
                        os.remove(os.path.join(target_dir, fname))
                    except Exception:
                        pass

    # Save chunked continent details to pipeline and web
    continent_details = defaultdict(dict)
    for a_id, d in details.items():
        c_id = artist_continent_map[a_id]["continentId"]
        continent_details[c_id][a_id] = d

    for c_id, c_data in continent_details.items():
        out_f = os.path.join(WEB_DETAILS_DIR, f"continent_{c_id}.json")
        with open(out_f, "w", encoding="utf-8") as f:
            json.dump(c_data, f, separators=(',', ':'))
        out_p = os.path.join(OUTPUT_DETAILS_DIR, f"continent_{c_id}.json")
        with open(out_p, "w", encoding="utf-8") as f:
            json.dump(c_data, f, separators=(',', ':'))

    # Remove deprecated legacy atlas-details.json per AGENTS.md zero backwards compatibility rule
    old_details_web = os.path.join(WEB_DATA_DIR, "atlas-details.json")
    if os.path.exists(old_details_web):
        os.remove(old_details_web)
    old_details_pipe = os.path.join(OUTPUT_DIR, "atlas-details.json")
    if os.path.exists(old_details_pipe):
        os.remove(old_details_pipe)

    print(f"\nStage 6 complete in {time.time() - start_time:.2f}s!")
    print(f"Exported atlas bundle with {len(nodes)} nodes, {len(formatted_edges)} edges, {len(clean_continents)} continents.")
    print(f"Artifact location: {out_web} (Size: {os.path.getsize(out_web) / (1024 * 1024):.2f} MB)")
    print(f"Chunked details into {len(continent_details)} continent files in {WEB_DETAILS_DIR}")
    print("=" * 70)

if __name__ == "__main__":
    main()
