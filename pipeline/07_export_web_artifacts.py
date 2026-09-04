"""
Step 7: Final Web Artifact Export.
Assembles coordinates, community coloring, normalized edge weights,
directional crossover percentages, and audio preview URLs into a unified,
lightweight JSON bundle for the Sigma.js WebGL frontend.
"""

import os
import json
from collections import defaultdict
from datetime import datetime

PIPELINE_DIR = os.path.dirname(__file__)
OUTPUT_DIR = os.path.join(PIPELINE_DIR, "output")
WEB_DATA_DIR = os.path.join(os.path.dirname(PIPELINE_DIR), "web", "public", "data")
os.makedirs(WEB_DATA_DIR, exist_ok=True)

def main():
    hydrated_file = os.path.join(OUTPUT_DIR, "hydrated_artists.json")
    communities_file = os.path.join(OUTPUT_DIR, "communities.json")
    coords_file = os.path.join(OUTPUT_DIR, "layout_coordinates.json")
    edges_file = os.path.join(OUTPUT_DIR, "sparsified_edges.json")

    with open(hydrated_file, "r", encoding="utf-8") as f:
        hydrated = json.load(f)
    with open(communities_file, "r", encoding="utf-8") as f:
        comm_data = json.load(f)
    with open(coords_file, "r", encoding="utf-8") as f:
        coords = json.load(f)
    with open(edges_file, "r", encoding="utf-8") as f:
        edges = json.load(f)

    artist_continent_map = comm_data.get("artist_continent_map", {})
    continents = comm_data.get("continents", [])

    # Index edge neighbors for instant top-crossover statistics
    neighbors_by_artist = defaultdict(list)
    for e in edges:
        src = e["source"]
        dst = e["target"]
        w = e["weight"]
        c_ij = e["rawSharedPlaylists"]
        pct_src = e["crossoverSourcePercent"]
        pct_dst = e["crossoverTargetPercent"]

        neighbors_by_artist[src].append({
            "neighborId": dst,
            "neighborName": hydrated.get(dst, {}).get("name", dst),
            "image": hydrated.get(dst, {}).get("image", ""),
            "cosineSimilarity": w,
            "sharedPlaylists": c_ij,
            "crossoverPercent": pct_src
        })

        neighbors_by_artist[dst].append({
            "neighborId": src,
            "neighborName": hydrated.get(src, {}).get("name", src),
            "image": hydrated.get(src, {}).get("image", ""),
            "cosineSimilarity": w,
            "sharedPlaylists": c_ij,
            "crossoverPercent": pct_dst
        })

    # Sort each artist's crossovers descending by percentage
    for a_id in neighbors_by_artist:
        neighbors_by_artist[a_id].sort(key=lambda x: x["crossoverPercent"], reverse=True)

    import math

    all_followers = [max(0, meta.get("followers") or 0) for meta in hydrated.values()]
    min_f = min(all_followers) if all_followers else 0
    max_f = max(all_followers) if all_followers else 1
    sqrt_min = math.sqrt(min_f)
    sqrt_max = math.sqrt(max_f)
    sqrt_diff = sqrt_max - sqrt_min

    # Top 40 global headliners by followers for prominent labels and badges at macro view
    sorted_artists = sorted(hydrated.values(), key=lambda a: (a.get("followers") or 0), reverse=True)
    headliner_ids = {a["id"] for a in sorted_artists[:40] if a.get("image") and "d41d8cd98f00b204e9800998ecf8427e" not in a.get("image", "")}

    # Build node list
    nodes = []
    for a_id, meta in hydrated.items():
        pos = coords.get(a_id, {"x": 0.0, "y": 0.0})
        comm_info = artist_continent_map.get(a_id, {
            "continentId": 1,
            "continentName": meta.get("macro_genre", "General"),
            "color": "#10B981"
        })

        pop = meta.get("popularity", 75)
        followers = max(0, meta.get("followers") or 0)
        # Sizing strictly proportional to followers: 2.5px (indie/emerging) to 28.0px (global superstar)
        ratio = (math.sqrt(followers) - sqrt_min) / sqrt_diff if sqrt_diff > 0 else 0.5
        ratio = max(0.0, min(1.0, ratio))
        size = round(2.5 + ratio * 25.5, 1)

        has_valid_image = bool(meta.get("image") and "d41d8cd98f00b204e9800998ecf8427e" not in meta.get("image", ""))
        is_headliner = a_id in headliner_ids
        node_type = "image" if has_valid_image else "circle"

        nodes.append({
            "id": a_id,
            "label": meta["name"],
            "x": pos["x"],
            "y": pos["y"],
            "size": size,
            "type": node_type,
            "isHeadliner": is_headliner,
            "color": comm_info["color"],
            "continentId": comm_info["continentId"],
            "continentName": comm_info["continentName"],
            "popularity": pop,
            "followers": followers,
            "image": meta.get("image", ""),
            "previewUrl": meta.get("previewUrl", ""),
            "topTrack": meta.get("topTrack", ""),
            "spotifyUrl": meta.get("spotifyUrl", ""),
            "genres": meta.get("genres", []),
            "macroGenre": meta.get("macro_genre", "Pop"),
            # 1-to-1 parity: exactly matches all connected edges for this artist
            "topCrossovers": neighbors_by_artist[a_id]
        })

    # Build edge list with inward radial Bézier curvature (spiderweb aesthetic)
    formatted_edges = []
    for idx, e in enumerate(edges):
        src = e["source"]
        dst = e["target"]
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

        # Inward radial deflection check: does +normal point away from galactic center (0,0)?
        # dot = (mx + nx) * mx + (my + ny) * my - (mx * mx + my * my) = mx * nx + my * ny
        dot = mx * nx + my * ny
        # Invert curvature so edges deflect inward toward galactic center (spiderweb effect)
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
            "crossoverTargetPercent": e["crossoverTargetPercent"]
        })

    bundle = {
        "metadata": {
            "generatedAt": datetime.now().isoformat(),
            "nodeCount": len(nodes),
            "edgeCount": len(formatted_edges),
            "continentCount": len(continents),
            "version": "1.0.0"
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

    print(f"Step 7 complete!")
    print(f"Exported atlas bundle with {len(nodes)} nodes, {len(formatted_edges)} edges, {len(continents)} continents.")
    print(f"Artifact location: {out_web}")

if __name__ == "__main__":
    main()
