"""
Stage 4C: Dynamic Continental Partitioning & Sector-Seeded Two-Phase ForceAtlas2 Layout.
Implements:
1. Dynamic Continental Grouping by Primary Genre with Multi-Hop Affinity Merging (Zero "Other" Dump)
2. Polar Sector Seeding (R=1800) for distinct celestial archipelagos
3. Phase 1: Macro Galaxy LinLog Spreading (scalingRatio=240, gravity=0.025, outboundAttractionDistribution=True)
4. Phase 2: Micro Constellation Size Repulsion (scalingRatio=180, gravity=0.02, adjustSizes=True)
5. Phase 3: Targeted Soft Disk Anti-Overlap via scipy.spatial.cKDTree strictly on overlapping pairs
6. Isotropic Rescaling to cosmic bounds: [-4200.0, 4200.0] x [-4200.0, 4200.0]
Outputs:
- pipeline/output/communities.json
- pipeline/output/layout_coordinates.json
"""

import os
import sys
import json
import time
import math
import argparse
from collections import Counter, defaultdict
from typing import Dict, List, Set, Tuple
import numpy as np
import networkx as nx
import fa2
from scipy.spatial import cKDTree

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(PIPELINE_DIR, "output")

EDGES_FILE = os.path.join(OUTPUT_DIR, "sparsified_edges.json")
CATALOG_FILE = os.path.join(OUTPUT_DIR, "artists_catalog.json")
SURVIVORS_FILE = os.path.join(OUTPUT_DIR, "surviving_artist_ids.json")
COMMUNITIES_FILE = os.path.join(OUTPUT_DIR, "communities.json")
LAYOUT_FILE = os.path.join(OUTPUT_DIR, "layout_coordinates.json")

# Perceptual palette for macro-continents
CONTINENT_PALETTE = [
    "#00E5FF",  # Electric Cyan
    "#EC4899",  # Neon Pink / Magenta
    "#10B981",  # Emerald Green
    "#F59E0B",  # Amber Gold
    "#8B5CF6",  # Violet Purple
    "#EF4444",  # Crimson Red
    "#3B82F6",  # Sapphire Blue
    "#14B8A6",  # Bright Teal
    "#F97316",  # Radiant Orange
    "#A855F7",  # Bright Purple
    "#84CC16",  # Lime Green
    "#F43F5E",  # Rose Coral
    "#06B6D4",  # Cyan Blue
    "#EAB308",  # Sunshine Yellow
    "#6366F1",  # Cosmic Indigo
    "#D946EF"   # Fuchsia
]

def format_genre_name(name: str) -> str:
    """Formats genre names for clean presentation."""
    name = name.strip()
    acronym_map = {
        "r&b": "R&B",
        "ccm": "CCM",
        "edm": "EDM",
        "k-pop": "K-Pop",
        "j-pop": "J-Pop",
        "ost": "OST"
    }
    if name.lower() in acronym_map:
        return acronym_map[name.lower()]
    if name.islower() or name.isupper():
        return name.title()
    return name

def run_two_phase_layout(
    G: nx.Graph,
    init_pos: Dict[str, Tuple[float, float]],
    radii_map: Dict[str, float],
    iter_macro: int = 350,
    iter_micro: int = 120
) -> Dict[str, Tuple[float, float]]:
    """Runs 2-phase ForceAtlas2 physics with sector initialization and targeted soft disk anti-overlap."""
    print(f"  Phase 1: ForceAtlas2 LinLog Simulation (Macro Galaxy Spreading, {iter_macro} iter)...")
    fa2_phase1 = fa2.ForceAtlas2(
        outboundAttractionDistribution=True,
        linLogMode=True,
        adjustSizes=False,
        edgeWeightInfluence=1.0,
        jitterTolerance=1.0,
        barnesHutOptimize=True,
        barnesHutTheta=1.2,
        scalingRatio=240.0,
        strongGravityMode=False,
        gravity=0.025,
        verbose=False
    )
    pos_dict = fa2_phase1.forceatlas2_networkx_layout(G, pos=init_pos, iterations=iter_macro, weight_attr="weight")

    print(f"  Phase 2: ForceAtlas2 Micro Constellation Refinement ({iter_micro} iter with physical size repulsion)...")
    fa2_phase2 = fa2.ForceAtlas2(
        outboundAttractionDistribution=False,
        linLogMode=False,
        adjustSizes=True,
        edgeWeightInfluence=0.7,
        jitterTolerance=0.8,
        barnesHutOptimize=True,
        barnesHutTheta=1.2,
        scalingRatio=180.0,
        strongGravityMode=False,
        gravity=0.02,
        verbose=False
    )
    pos_dict = fa2_phase2.forceatlas2_networkx_layout(G, pos=pos_dict, iterations=iter_micro, weight_attr="weight", size_attr="size")

    nodes = list(G.nodes())
    pos = np.array([pos_dict[node] for node in nodes], dtype=np.float64)

    # 1. Center coordinates around galactic centroid
    center = np.mean(pos, axis=0)
    pos -= center

    # 2. Linear isotropic scaling to canvas bounds [-4200.0, 4200.0]
    max_span = max(float(np.max(np.abs(pos[:, 0]))), float(np.max(np.abs(pos[:, 1])))) or 1.0
    pos = (pos / max_span) * 4200.0

    # 3. Targeted soft disk anti-overlap relaxation (strictly for overlapping pairs)
    print("  Phase 3: Damped soft disk anti-overlap relaxation via cKDTree...")
    radii = np.array([radii_map.get(node, 3.0) for node in nodes], dtype=np.float64)
    max_r = float(np.max(radii)) if len(radii) > 0 else 24.0

    for it in range(35):
        tree = cKDTree(pos)
        pairs = tree.query_pairs(r=2.0 * max_r + 4.0)
        if not pairs:
            break
        moved = 0
        for i, j in pairs:
            req = radii[i] + radii[j] + 3.0
            delta = pos[j] - pos[i]
            dist = np.linalg.norm(delta)
            if dist <= 0.001:
                delta = np.random.uniform(-0.1, 0.1, size=2)
                dist = np.linalg.norm(delta)
            if dist < req:
                overlap = (req - dist) * 0.5 * 0.20
                shift = (delta / dist) * overlap
                pos[i] -= shift
                pos[j] += shift
                moved += 1
        if moved == 0:
            break

    # Re-center after relaxation
    pos -= np.mean(pos, axis=0)

    return {node: (round(float(pos[i, 0]), 2), round(float(pos[i, 1]), 2)) for i, node in enumerate(nodes)}

def main():
    parser = argparse.ArgumentParser(description="Stage 4C: Dynamic Continental Partitioning & ForceAtlas2 Layout.")
    parser.add_argument("--iter-macro", type=int, default=350, help="Phase 1 LinLog iterations (default: 350)")
    parser.add_argument("--iter-micro", type=int, default=120, help="Phase 2 refinement iterations (default: 120)")
    args = parser.parse_args()

    if not os.path.exists(EDGES_FILE) or not os.path.exists(CATALOG_FILE):
        raise FileNotFoundError("Missing inputs. Run Stage 4B first.")

    print("=" * 70)
    print(" STAGE 4C: DYNAMIC CONTINENTAL PARTITIONING & FORCEATLAS2 SPIDER-WEB PHYSICS")
    print("=" * 70)
    start_time = time.time()

    with open(EDGES_FILE, "r", encoding="utf-8") as f:
        edges = json.load(f)
    with open(CATALOG_FILE, "r", encoding="utf-8") as f:
        catalog = json.load(f)

    catalog_map = {a["id"]: a for a in catalog}

    # If surviving_artist_ids exists, load it
    surviving_ids = None
    if os.path.exists(SURVIVORS_FILE):
        with open(SURVIVORS_FILE, "r", encoding="utf-8") as f:
            surviving_ids = set(json.load(f))

    # Build NetworkX weighted graph
    G = nx.Graph()
    for e in edges:
        G.add_edge(e["source"], e["target"], weight=float(e["weight"]))

    print(f"Graph loaded with {G.number_of_nodes()} nodes and {G.number_of_edges()} edges.")

    # 1. Continental Partitioning based on Dynamic Primary Genre with Affinity Merging
    print("Partitioning Continents by Dynamic Primary Genre with Affinity Merging...")
    artist_genre = {node: catalog_map.get(node, {}).get("primaryGenre") or "Other" for node in G.nodes()}

    genre_counts = Counter(artist_genre.values())
    # Major continents are top 16 genres by population (excluding 'Other')
    top_genres = [g for g, _ in genre_counts.most_common(16) if g != "Other"]
    major_set = set(top_genres)

    # Co-occurrence affinity between genres
    genre_affinity = defaultdict(lambda: defaultdict(float))
    for u, v, data in G.edges(data=True):
        w = float(data.get("weight", 0.1))
        gu, gv = artist_genre[u], artist_genre[v]
        if gu != gv:
            genre_affinity[gu][gv] += w
            genre_affinity[gv][gu] += w

    # Multi-hop affinity propagation for all minor genres (and 'Other')
    genre_to_major = {g: g for g in top_genres}
    unresolved = set(genre_counts.keys()) - major_set

    while unresolved:
        newly_resolved = {}
        for g in unresolved:
            maj_scores = defaultdict(float)
            for neighbor_g, w in genre_affinity[g].items():
                if neighbor_g in genre_to_major:
                    target_maj = genre_to_major[neighbor_g]
                    maj_scores[target_maj] += w
            if maj_scores:
                best_maj = max(maj_scores.items(), key=lambda x: x[1])[0]
                newly_resolved[g] = best_maj

        if not newly_resolved:
            # If any remain without direct edge paths to major genres, assign to dominant continent
            fallback_maj = top_genres[0]
            for g in unresolved:
                genre_to_major[g] = fallback_maj
            break

        for g, maj in newly_resolved.items():
            genre_to_major[g] = maj
            unresolved.remove(g)

    # Build continent definitions
    continent_members = defaultdict(list)
    for node in G.nodes():
        maj = genre_to_major[artist_genre[node]]
        continent_members[maj].append(node)

    # Sort continents by population descending
    sorted_continents = sorted(continent_members.items(), key=lambda x: len(x[1]), reverse=True)

    continents = []
    artist_continent_map = {}
    continent_to_idx = {}

    for idx, (maj_name, members) in enumerate(sorted_continents, start=1):
        color = CONTINENT_PALETTE[(idx - 1) % len(CONTINENT_PALETTE)]
        display_name = format_genre_name(maj_name)
        sorted_m = sorted(members)
        continents.append({
            "id": idx,
            "name": display_name,
            "color": color,
            "artistCount": len(sorted_m),
            "artistIds": sorted_m
        })
        continent_to_idx[maj_name] = idx - 1
        for a_id in sorted_m:
            orig_genre = artist_genre[a_id]
            artist_continent_map[a_id] = {
                "continentId": idx,
                "continentName": display_name,
                "communityId": idx,
                "communityName": display_name,
                "color": color,
                "primaryGenre": format_genre_name(orig_genre)
            }

    print(f"\nFormed {len(continents)} Dynamic Continents (0 in 'Other'):")
    for c in continents:
        print(f"  - [{c['color']}] Continent #{c['id']}: {c['name']} ({c['artistCount']} artists)")

    # Save communities.json
    with open(COMMUNITIES_FILE, "w", encoding="utf-8") as f:
        json.dump({
            "continents": continents,
            "artist_continent_map": artist_continent_map
        }, f, indent=2)
    print(f"\nSaved {COMMUNITIES_FILE}")

    # 2. Polar Sector Seeding for Continental Separation
    print("\nGenerating Polar Sector Macro Initial Positions...")
    K = len(continents)
    R = 1800.0
    init_pos = {}

    for node in G.nodes():
        maj = genre_to_major[artist_genre[node]]
        k = continent_to_idx[maj]
        theta_k = (2.0 * math.pi * k) / K
        delta_r = np.random.normal(0.0, 180.0)
        delta_theta = np.random.normal(0.0, 0.15)
        r = max(120.0, R + delta_r)
        theta = theta_k + delta_theta
        x = r * math.cos(theta)
        y = r * math.sin(theta)
        init_pos[node] = (float(x), float(y))

    # 3. Assign node size footprints for physical repulsion in ForceAtlas2
    all_subs = [max(1000, catalog_map.get(node, {}).get("subscribers", 1000)) for node in G.nodes()]
    min_subs = min(all_subs) if all_subs else 1000
    max_subs = max(all_subs) if all_subs else 50_000_000
    sqrt_min = math.sqrt(min_subs)
    sqrt_diff = (math.sqrt(max_subs) - sqrt_min) or 1.0

    radii_map = {}
    for node in G.nodes():
        a_meta = catalog_map.get(node, {})
        subs = max(1000, a_meta.get("subscribers", 1000))
        norm_subs = max(0.0, min(1.0, (math.sqrt(subs) - sqrt_min) / sqrt_diff))
        # Collision radius in ForceAtlas2 (8.0 to 55.0)
        G.nodes[node]["size"] = max(8.0, 8.0 + (norm_subs ** 1.2) * 47.0)
        # Display radius for soft anti-overlap (2.0 to 22.0)
        radii_map[node] = max(2.0, 2.0 + (norm_subs ** 1.2) * 20.0)

    # 4. Two-Phase ForceAtlas2 Layout + Targeted Anti-Overlap
    print("\nStarting Spatial Layout Simulation...")
    pos_coords = run_two_phase_layout(G, init_pos, radii_map, iter_macro=args.iter_macro, iter_micro=args.iter_micro)

    normalized_coords = {
        node: {
            "x": coord[0],
            "y": coord[1]
        }
        for node, coord in pos_coords.items()
    }

    with open(LAYOUT_FILE, "w", encoding="utf-8") as f:
        json.dump(normalized_coords, f, indent=2)

    print(f"Saved {LAYOUT_FILE}")
    print(f"Stage 4C complete in {time.time() - start_time:.2f}s!")
    print("=" * 70)

if __name__ == "__main__":
    main()
