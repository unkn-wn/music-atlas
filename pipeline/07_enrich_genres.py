"""
Stage 7: Genre Enrichment from Wikidata (genre-info.json).
For every subgenre shown in the exported atlas, looks for the Wikidata music-genre item it names and attaches its
human-curated facts: description, inception date and English Wikipedia article.
Matching is exact (case-insensitive) on the item's English label, or failing that on one of its English aliases
("pop music" is also known as "pop"). A name that fits zero or several items gets nothing; there is no hand mapping.
The genre index is the one Stage 2 cached (pipeline/wikidata.py), so genre facts and artist tags share one snapshot.
Outputs:
- pipeline/output/genre-info.json
- web/public/data/genre-info.json
"""

import os
import sys
import json
import time
import argparse
from typing import List, Optional

from wikidata import load_genre_items, index_names, match_genre

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(PIPELINE_DIR, "output")
WEB_DATA_DIR = os.path.join(os.path.dirname(PIPELINE_DIR), "web", "public", "data")
GRAPH_FILE = os.path.join(OUTPUT_DIR, "atlas-graph.json")

def load_genre_names() -> List[str]:
    with open(GRAPH_FILE, "r", encoding="utf-8") as f:
        graph = json.load(f)
    names = {g for n in graph["nodes"] for g in n["topSubgenres"]}
    return sorted(names)

def is_https(url: Optional[str]) -> bool:
    """The article URL ends up in href attributes, so only plain https links are kept."""
    return bool(url) and url.startswith("https://")

def main():
    parser = argparse.ArgumentParser(description="Stage 7: Wikidata genre enrichment.")
    parser.add_argument("--offline", action="store_true", help="Use only the cached Wikidata genre index (fails if it is missing)")
    args = parser.parse_args()

    print("=" * 70)
    print(" STAGE 7: GENRE ENRICHMENT (Wikidata)")
    print("=" * 70)
    if not os.path.exists(GRAPH_FILE):
        raise FileNotFoundError("Missing pipeline/output/atlas-graph.json. Run Stage 6 first.")

    start_time = time.time()
    genres = load_genre_names()
    print(f"Loaded {len(genres)} atlas subgenres.")

    items = load_genre_items(offline=args.offline)
    print(f"Loaded {len(items)} Wikidata music-genre items.")
    by_label, by_alias = index_names(items)

    genre_info = {}
    for genre in genres:
        qid = match_genre(genre, by_label, by_alias)
        if not qid:
            continue
        item = items[qid]
        entry = {"wd": qid}
        # The bare "music genre" placeholder description says nothing about the genre
        if item["desc"] and item["desc"].lower() != "music genre":
            entry["desc"] = item["desc"]
        if item["since"]:
            entry["since"] = item["since"]
        if is_https(item["wiki"]):
            entry["wiki"] = item["wiki"]
        genre_info[genre] = entry

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    for target in [os.path.join(OUTPUT_DIR, "genre-info.json"), os.path.join(WEB_DATA_DIR, "genre-info.json")]:
        with open(target, "w", encoding="utf-8") as f:
            json.dump(genre_info, f, separators=(",", ":"), ensure_ascii=False)

    print(f"\nStage 7 complete in {time.time() - start_time:.2f}s!")
    print(f"Matched {len(genre_info)} of {len(genres)} genres exactly by label or alias: "
          f"{sum('desc' in e for e in genre_info.values())} with a description, "
          f"{sum('since' in e for e in genre_info.values())} with inception.")
    print("=" * 70)

if __name__ == "__main__":
    main()
