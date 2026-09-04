"""
Step 5: Two-Phase ForceAtlas2 Layout Simulation.
Executes stable spatial physics to produce an organic continuous cosmic web:
- Phase 1: ForceAtlas2 LinLog attraction + gravity to pull connected genres and bridges into a cohesive galaxy.
- Phase 2: Asinh/power radial balancing + post-normalization anti-collision relaxation
  guaranteeing each artist node has clear space and forms a beautiful constellation.
- Rescales coordinates to [-950.0, 950.0].
"""

import os
import json
import numpy as np
import networkx as nx
import fa2

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output")

def run_layout(G: nx.Graph, iterations_stage1=800, iterations_stage2=350) -> dict:
    print("Stage 1: ForceAtlas2 LinLog Simulation (Macro Galaxy Spreading)...")
    fa2_stage1 = fa2.ForceAtlas2(
        outboundAttractionDistribution=False,
        linLogMode=True,
        adjustSizes=False,
        edgeWeightInfluence=1.0,
        jitterTolerance=1.0,
        barnesHutOptimize=False,
        scalingRatio=6.5,
        strongGravityMode=False,
        gravity=0.35,
        verbose=False
    )

    pos_dict = fa2_stage1.forceatlas2_networkx_layout(G, iterations=iterations_stage1, weight_attr="weight")

    print("Stage 2: ForceAtlas2 Local Refinement & Intra-Cluster Anti-Collision Spreading...")
    fa2_stage2 = fa2.ForceAtlas2(
        outboundAttractionDistribution=False,
        linLogMode=False,
        adjustSizes=True,
        edgeWeightInfluence=0.6,
        jitterTolerance=0.8,
        barnesHutOptimize=False,
        scalingRatio=24.0,
        strongGravityMode=False,
        gravity=0.15,
        verbose=False
    )

    pos_dict = fa2_stage2.forceatlas2_networkx_layout(G, pos=pos_dict, iterations=iterations_stage2, weight_attr="weight")

    nodes = list(G.nodes())
    pos = np.array([pos_dict[node] for node in nodes], dtype=np.float64)

    # Center coordinates
    center = np.mean(pos, axis=0)
    pos -= center

    # Post-simulation spacing relaxation pass (guarantee breathing room within clusters)
    print("Stage 3: Pairwise Distance Relaxation for Intra-Cluster Artist Spacing...")
    for _ in range(60):
        moved = False
        for i in range(len(nodes)):
            for j in range(i + 1, len(nodes)):
                dx = pos[j, 0] - pos[i, 0]
                dy = pos[j, 1] - pos[i, 1]
                dist = np.sqrt(dx * dx + dy * dy)
                min_dist = 28.0
                if dist < min_dist and dist > 0.001:
                    overlap = (min_dist - dist) * 0.5
                    ux = (dx / dist) * overlap
                    uy = (dy / dist) * overlap
                    pos[i, 0] -= ux
                    pos[i, 1] -= uy
                    pos[j, 0] += ux
                    pos[j, 1] += uy
                    moved = True
        if not moved:
            break

    # Normalize cleanly to expanded galactic canvas [-1350.0, 1350.0]
    min_x, max_x = np.min(pos[:, 0]), np.max(pos[:, 0])
    min_y, max_y = np.min(pos[:, 1]), np.max(pos[:, 1])
    range_x = (max_x - min_x) or 1.0
    range_y = (max_y - min_y) or 1.0
    pos[:, 0] = ((pos[:, 0] - min_x) / range_x) * 2700.0 - 1350.0
    pos[:, 1] = ((pos[:, 1] - min_y) / range_y) * 2700.0 - 1350.0

    return {node: (float(pos[i, 0]), float(pos[i, 1])) for i, node in enumerate(nodes)}

def main():
    edges_file = os.path.join(OUTPUT_DIR, "sparsified_edges.json")
    catalog_file = os.path.join(OUTPUT_DIR, "artists_catalog.json")

    with open(edges_file, "r", encoding="utf-8") as f:
        edges = json.load(f)
    with open(catalog_file, "r", encoding="utf-8") as f:
        catalog = json.load(f)

    pop_map = {a["id"]: a.get("popularity", 80) for a in catalog}

    G = nx.Graph()
    for e in edges:
        G.add_edge(e["source"], e["target"], weight=float(e["weight"]))

    for a in catalog:
        if a["id"] not in G:
            G.add_node(a["id"])

    # Assign physical node size footprints to NetworkX nodes so adjustSizes repels large nodes
    for node in G.nodes():
        pop = pop_map.get(node, 80)
        G.nodes[node]["size"] = max(14.0, ((pop / 100.0) ** 1.5) * 42.0)

    print(f"Computing 2D layout for {G.number_of_nodes()} artists across {G.number_of_edges()} edges...")
    raw_pos = run_layout(G)

    normalized_coords = {
        node: {
            "x": round(float(coord[0]), 2),
            "y": round(float(coord[1]), 2)
        }
        for node, coord in raw_pos.items()
    }

    print(f"Coordinates normalized: X in [{min(c['x'] for c in normalized_coords.values())}, {max(c['x'] for c in normalized_coords.values())}]")

    with open(os.path.join(OUTPUT_DIR, "layout_coordinates.json"), "w", encoding="utf-8") as f:
        json.dump(normalized_coords, f, indent=2)

    print("Step 5 complete. Saved layout_coordinates.json")

if __name__ == "__main__":
    main()
