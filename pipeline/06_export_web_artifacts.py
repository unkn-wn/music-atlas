"""
Stage 5: Final Web Artifact Export (atlas-graph.json).
Assembles layout coordinates, dynamic continental naming, normalized edge weights,
inward radial Bézier curvature, verified subscriber counts, Top 3 Subgenres,
and adaptive relative-affinity connections (6 to 20 connections) into a unified,
lightweight JSON bundle for the Sigma.js WebGL frontend.
Outputs:
- pipeline/output/atlas-graph.json
- web/public/data/atlas-graph.json
"""

import os
import sys
import json
import math
import time
from datetime import datetime
from collections import defaultdict
from typing import Dict, List, Set, Any

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

def compute_adaptive_neighbors(artist_id: str, neighbors: List[Dict], total_playlists: int) -> List[Dict]:
    """
    Computes adaptive connections eliminating superstar clutter:
    - Guaranteed minimum top 6 connections
    - Hard ceiling cap at 20 connections
    - Relative affinity threshold: rel_affinity >= 0.25 (relative to #1 strongest connection)
    - Anti-fluke filter for mega-artists (c_A >= 30 requires c_AB >= 2)
    """
    if not neighbors:
        return []

    # Sort descending by shared playlists, then cosine similarity
    sorted_neighbors = sorted(neighbors, key=lambda x: (x["sharedPlaylists"], x["cosineSimilarity"]), reverse=True)

    max_affinity = max(n["cosineSimilarity"] for n in sorted_neighbors) if sorted_neighbors else 1.0
    surviving = []

    for rank, n in enumerate(sorted_neighbors):
        # 1. Guaranteed Minimum Top 6
        if rank < 6:
            surviving.append(n)
            continue

        # 2. Hard Ceiling Cap at 20
        if rank >= 20:
            break

        # 3. Relative Affinity Threshold
        rel_affinity = n["cosineSimilarity"] / (max_affinity or 1.0)

        # 4. Anti-Fluke Filter for Mega-Artists (c_A >= 30)
        is_mega = total_playlists >= 30
        fluke_check = (not is_mega) or (n["sharedPlaylists"] >= 2)

        if rel_affinity >= 0.25 and fluke_check:
            surviving.append(n)

    return surviving

def main():
    if not all(os.path.exists(f) for f in [CATALOG_FILE, COMMUNITIES_FILE, LAYOUT_FILE, EDGES_FILE]):
        raise FileNotFoundError("Missing Stage 4 outputs. Run earlier pipeline stages first.")

    print("=" * 70)
    print(" STAGE 5: LIGHTWEIGHT WEB ARTIFACT EXPORT (atlas-graph.json)")
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

    # Load surviving artist IDs from Stage 4B
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
    raw_neighbors = defaultdict(list)
    for e in edges:
        src = e["source"]
        dst = e["target"]
        if src not in catalog_map or dst not in catalog_map:
            continue

        sim = e.get("cosineSimilarity", e.get("weight", 0.5))
        c_ij = e.get("rawSharedPlaylists", 1)
        pct_src = e.get("crossoverSourcePercent", 0.0)
        pct_dst = e.get("crossoverTargetPercent", 0.0)

        dst_meta = catalog_map[dst]
        src_meta = catalog_map[src]

        raw_neighbors[src].append({
            "neighborId": dst,
            "neighborName": dst_meta.get("name", dst),
            "image": dst_meta.get("image", ""),
            "cosineSimilarity": round(float(sim), 4),
            "sharedPlaylists": int(c_ij),
            "crossoverPercent": round(float(pct_src), 1)
        })

        raw_neighbors[dst].append({
            "neighborId": src,
            "neighborName": src_meta.get("name", src),
            "image": src_meta.get("image", ""),
            "cosineSimilarity": round(float(sim), 4),
            "sharedPlaylists": int(c_ij),
            "crossoverPercent": round(float(pct_dst), 1)
        })

    # 2. Compute subscriber scaling range for empirical node sizing
    all_subs = [max(1000, a.get("subscribers", 1000)) for a in catalog_map.values()]
    min_subs = min(all_subs) if all_subs else 1000
    max_subs = max(all_subs) if all_subs else 50_000_000
    sqrt_min = math.sqrt(min_subs)
    sqrt_max = math.sqrt(max_subs)
    sqrt_diff = (sqrt_max - sqrt_min) or 1.0

    # Top 400 global headliners by subscribers
    sorted_by_subs = sorted(catalog_map.values(), key=lambda a: a.get("subscribers", 0), reverse=True)
    headliner_ids = {a["id"] for a in sorted_by_subs[:400] if a.get("image") and "d41d8cd98f00b204e9800998ecf8427e" not in a.get("image", "")}

    # 3. Assemble Nodes
    nodes = []
    for a_id, meta in catalog_map.items():
        pos = coords.get(a_id, {"x": 0.0, "y": 0.0})
        comm_info = artist_continent_map.get(a_id, {
            "continentId": 1,
            "continentName": meta.get("primaryGenre", "Other"),
            "communityId": 1,
            "communityName": meta.get("primaryGenre", "Other"),
            "color": "#00E5FF"
        })

        subs = max(1000, meta.get("subscribers", 1000))
        # Non-linear scaling: 1.1px for small/niche artists up to 23.0px for mega-artists
        ratio = (math.sqrt(subs) - sqrt_min) / sqrt_diff
        ratio = max(0.0, min(1.0, ratio))
        node_size = round(1.1 + (ratio ** 1.3) * 21.5, 1)

        is_headliner = a_id in headliner_ids
        has_valid_image = bool(meta.get("image") and "d41d8cd98f00b204e9800998ecf8427e" not in meta.get("image", ""))
        node_type = "image" if (is_headliner and has_valid_image) else "circle"

        # Apply Adaptive Connection Rule for topCrossovers (dynamic 6 to 20)
        c_i = meta.get("sharedPlaylistsCount", len(raw_neighbors[a_id]))
        adaptive_connections = compute_adaptive_neighbors(a_id, raw_neighbors[a_id], c_i)

        nodes.append({
            "id": a_id,
            "label": meta["name"],
            "x": pos["x"],
            "y": pos["y"],
            "size": node_size,
            "type": node_type,
            "isHeadliner": is_headliner,
            "color": comm_info["color"],
            "continentId": comm_info["continentId"],
            "continentName": comm_info["continentName"],
            "communityId": comm_info.get("communityId", comm_info["continentId"]),
            "communityName": comm_info.get("communityName", comm_info["continentName"]),
            "popularity": meta.get("popularity", 50),
            "followers": subs,
            "monthlyListeners": subs,
            "subscribers": subs,
            "subscribersFormatted": meta.get("subscribersFormatted", f"{subs:,}"),
            "primaryGenre": comm_info.get("primaryGenre", meta.get("primaryGenre", "Other")),
            "macroGenre": comm_info.get("continentName", meta.get("primaryGenre", "Other")),
            "genres": meta.get("topSubgenres", meta.get("genres", [])),
            "topSubgenres": meta.get("topSubgenres", []),
            "image": meta.get("image", ""),
            "previewUrl": meta.get("previewUrl", ""),
            "spotifyUrl": meta.get("spotifyUrl", f"https://open.spotify.com/search/{meta['name']}"),
            "sharedPlaylistsCount": c_i,
            "topCrossovers": adaptive_connections
        })

    # 4. Assemble Edges with Radial Bézier Inward Deflection (Spiderweb Effect)
    formatted_edges = []
    for idx, e in enumerate(edges):
        src = e["source"]
        dst = e["target"]
        if src not in catalog_map or dst not in catalog_map:
            continue

        src_color = artist_continent_map.get(src, {}).get("color", "#94a3b8")
        pos_src = coords.get(src, {"x": 0.0, "y": 0.0})
        pos_dst = coords.get(dst, {"x": 0.0, "y": 0.0})

        x1, y1 = pos_src["x"], pos_src["y"]
        x2, y2 = pos_dst["x"], pos_dst["y"]
        dx, dy = x2 - x1, y2 - y1
        L = math.sqrt(dx * dx + dy * dy) or 1.0

        # Normal vector perpendicular to chord
        nx, ny = -dy / L, dx / L
        # Midpoint
        mx, my = (x1 + x2) / 2.0, (y1 + y2) / 2.0

        # Inward radial deflection: dot product with midpoint
        dot = mx * nx + my * ny
        curvature = -0.14 if dot >= 0 else 0.14

        formatted_edges.append({
            "id": f"e_{idx}",
            "source": src,
            "target": dst,
            "type": "curve",
            "curvature": round(curvature, 3),
            "weight": e["weight"],
            "size": max(0.12, round(e["weight"] * 1.4, 2)),
            "color": src_color,
            "rawSharedPlaylists": e["rawSharedPlaylists"],
            "crossoverSourcePercent": e["crossoverSourcePercent"],
            "crossoverTargetPercent": e["crossoverTargetPercent"],
            "isBridge": bool(e.get("isBridge", False))
        })

    bundle = {
        "metadata": {
            "generatedAt": datetime.now().isoformat(),
            "nodeCount": len(nodes),
            "edgeCount": len(formatted_edges),
            "continentCount": len(continents),
            "version": "2.0.0"
        },
        "continents": continents,
        "nodes": nodes,
        "edges": formatted_edges
    }

    # Save to pipeline output
    out_pipeline = os.path.join(OUTPUT_DIR, "atlas-graph.json")
    with open(out_pipeline, "w", encoding="utf-8") as f:
        json.dump(bundle, f, indent=2)

    # Save to web/public/data/atlas-graph.json
    out_web = os.path.join(WEB_DATA_DIR, "atlas-graph.json")
    with open(out_web, "w", encoding="utf-8") as f:
        json.dump(bundle, f, indent=2)

    print(f"\nStage 5 complete in {time.time() - start_time:.2f}s!")
    print(f"Exported atlas bundle with {len(nodes)} nodes, {len(formatted_edges)} edges, {len(continents)} continents.")
    print(f"Artifact location: {out_web} (Size: {os.path.getsize(out_web) / (1024 * 1024):.2f} MB)")
    print("=" * 70)

if __name__ == "__main__":
    main()
