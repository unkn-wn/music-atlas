"""
Stage 7: Genre Enrichment from Wikidata (genre-info.json).
For every subgenre shown in the exported atlas, looks for the Wikidata music-genre item it names and attaches its
human-curated facts: description, inception date and English Wikipedia article.
Matching is exact (case-insensitive) on the item's English label, or failing that on one of its English aliases
("pop music" is also known as "pop"). A name that fits zero or several items gets nothing; there is no hand mapping.
Outputs:
- pipeline/output/genre-info.json
- web/public/data/genre-info.json
"""

import os
import re
import sys
import json
import time
import argparse
from typing import Dict, List, Optional, Set
import requests

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(PIPELINE_DIR, "output")
WEB_DATA_DIR = os.path.join(os.path.dirname(PIPELINE_DIR), "web", "public", "data")
GRAPH_FILE = os.path.join(OUTPUT_DIR, "atlas-graph.json")

WDQS_URL = "https://query.wikidata.org/sparql"
HEADERS = {"User-Agent": "MusicAtlas/1.0 (https://music-atlas.app; https://github.com/unkn-wn/music-atlas)"}
INVALID_GENRE_NAMES = {"other", "artist", "unknown", "eclectic"}

# Every item that is a music genre (Q188451) or one of its subclasses, with its English label and aliases
SPARQL = """
SELECT ?item ?label ?alias ?desc ?inception ?precision ?article WHERE {
  ?item wdt:P31/wdt:P279* wd:Q188451 ;
        rdfs:label ?label FILTER(LANG(?label) = "en")
  OPTIONAL { ?item skos:altLabel ?alias FILTER(LANG(?alias) = "en") }
  OPTIONAL { ?item schema:description ?desc FILTER(LANG(?desc) = "en") }
  OPTIONAL {
    ?item p:P571 ?statement .
    ?statement wikibase:rank ?rank ; psv:P571 [ wikibase:timeValue ?inception ; wikibase:timePrecision ?precision ] .
    FILTER(?rank != wikibase:DeprecatedRank)
  }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
}
"""

def load_genre_names() -> List[str]:
    with open(GRAPH_FILE, "r", encoding="utf-8") as f:
        graph = json.load(f)
    names = {g for n in graph["nodes"] for g in n.get("topSubgenres", []) if g and g.strip().lower() not in INVALID_GENRE_NAMES}
    return sorted(names)

def parse_year(time_value: str) -> Optional[int]:
    """Wikidata time values look like '1965-01-01T00:00:00Z' or '-1999-01-01T00:00:00Z'."""
    m = re.match(r"^(-?\d+)-", time_value)
    return int(m.group(1)) if m else None

def is_https(url: Optional[str]) -> bool:
    """The article URL ends up in href attributes, so only plain https links are kept."""
    return bool(url) and url.startswith("https://")

def fetch_wikidata_items() -> Dict[str, Dict]:
    resp = requests.get(WDQS_URL, params={"query": SPARQL, "format": "json"}, headers=HEADERS, timeout=180)
    resp.raise_for_status()
    items: Dict[str, Dict] = {}
    for row in resp.json()["results"]["bindings"]:
        qid = row["item"]["value"].rsplit("/", 1)[-1]
        item = items.setdefault(qid, {"label": row["label"]["value"], "aliases": set(), "desc": None, "since": None, "wiki": None})
        if "alias" in row:
            item["aliases"].add(row["alias"]["value"].lower())
        if "desc" in row:
            item["desc"] = row["desc"]["value"]
        if "article" in row:
            item["wiki"] = row["article"]["value"]
        if "inception" in row:
            year = parse_year(row["inception"]["value"])
            precision = int(row["precision"]["value"])
            # Keep the earliest stated inception, the most precise one on a tie
            if year is not None and (
                item["since"] is None or (year, -precision) < (item["since"]["year"], -item["since"]["precision"])
            ):
                item["since"] = {"year": year, "precision": precision}
    return items

def index_names(items: Dict[str, Dict]):
    by_label: Dict[str, Set[str]] = {}
    by_alias: Dict[str, Set[str]] = {}
    for qid, item in items.items():
        by_label.setdefault(item["label"].lower(), set()).add(qid)
        for alias in item["aliases"]:
            by_alias.setdefault(alias, set()).add(qid)
    return by_label, by_alias

def match_genre(genre: str, by_label: Dict[str, Set[str]], by_alias: Dict[str, Set[str]]) -> Optional[str]:
    """A unique label match wins; aliases are only consulted when no item carries the name as its label."""
    key = genre.lower()
    qids = by_label[key] if key in by_label else by_alias.get(key, set())
    return next(iter(qids)) if len(qids) == 1 else None

def main():
    parser = argparse.ArgumentParser(description="Stage 7: Wikidata genre enrichment.")
    parser.add_argument("--offline", action="store_true", help="Skip network calls and keep the existing genre-info.json")
    args = parser.parse_args()

    print("=" * 70)
    print(" STAGE 7: GENRE ENRICHMENT (Wikidata)")
    print("=" * 70)
    if args.offline:
        print("Offline mode: keeping the existing genre-info.json.")
        return
    if not os.path.exists(GRAPH_FILE):
        raise FileNotFoundError("Missing pipeline/output/atlas-graph.json. Run Stage 6 first.")

    start_time = time.time()
    genres = load_genre_names()
    print(f"Loaded {len(genres)} atlas subgenres.")

    items = fetch_wikidata_items()
    print(f"Fetched {len(items)} Wikidata music-genre items.")
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
