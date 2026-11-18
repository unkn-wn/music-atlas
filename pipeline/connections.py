"""
Drawn connections, shared by Stage 5 (genre tag neighbour check) and Stage 6 (export): each artist's top 6
connections by playlist overlap, plus bridge edges. The drawer lists exactly these, and the tag check reads the same set.
"""

import math
from collections import defaultdict
from typing import Dict, Iterable, List, Set, Tuple

DRAWN_EDGES_PER_ARTIST = 6

def by_overlap(neighbors: List[Dict]) -> List[Dict]:
    """Orders connections by playlist overlap, then shared playlist count."""
    return sorted(neighbors, key=lambda x: (x["overlapPercent"], x["sharedPlaylists"]), reverse=True)

def neighbor_lists(edges: Iterable[Dict], members: Set[str]) -> Dict[str, List[Dict]]:
    """Every connection between two members, from both sides, with its overlap statistics."""
    raw_neighbors: Dict[str, List[Dict]] = defaultdict(list)
    for e in edges:
        src, dst = e["source"], e["target"]
        if src not in members or dst not in members:
            continue
        c_ij = int(e.get("rawSharedPlaylists", 1))
        # % of each artist's playlists that include the other; overlap is their geometric mean
        pct_src = float(e.get("crossoverSourcePercent", 0.0))
        pct_dst = float(e.get("crossoverTargetPercent", 0.0))
        overlap = round(math.sqrt(pct_src * pct_dst), 1)
        raw_neighbors[src].append({"neighborId": dst, "overlapPercent": overlap, "sharedPlaylists": c_ij,
                                   "selfPercent": round(pct_src, 1), "neighborPercent": round(pct_dst, 1)})
        raw_neighbors[dst].append({"neighborId": src, "overlapPercent": overlap, "sharedPlaylists": c_ij,
                                   "selfPercent": round(pct_dst, 1), "neighborPercent": round(pct_src, 1)})
    return raw_neighbors

def drawn_pairs(edges: List[Dict], raw_neighbors: Dict[str, List[Dict]], members: Set[str]) -> Set[Tuple[str, str]]:
    """Each member's top DRAWN_EDGES_PER_ARTIST connections by overlap, plus every bridge between members."""
    pairs = set()
    for a_id in members:
        for n in by_overlap(raw_neighbors[a_id])[:DRAWN_EDGES_PER_ARTIST]:
            pairs.add(tuple(sorted([a_id, n["neighborId"]])))
    for e in edges:
        if e.get("isBridge") and e["source"] in members and e["target"] in members:
            pairs.add(tuple(sorted([e["source"], e["target"]])))
    return pairs

def strongest_drawn(edges: List[Dict], pairs: Set[Tuple[str, str]], k: int) -> Dict[str, List[str]]:
    """Per artist, its k strongest drawn connections by edge weight (ties: higher neighbour ID first)."""
    adj: Dict[str, List[Tuple[float, str]]] = defaultdict(list)
    for e in edges:
        pair = tuple(sorted([e["source"], e["target"]]))
        if pair in pairs:
            w = round(float(e["weight"]), 4)
            adj[e["source"]].append((w, e["target"]))
            adj[e["target"]].append((w, e["source"]))
    return {a: [t for _, t in sorted(nb, reverse=True)[:k]] for a, nb in adj.items()}
