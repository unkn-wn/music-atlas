"""
Stage 7: Genre Enrichment from Wikidata & Wikimedia Commons (genre-info.json).
For every subgenre shown in the exported atlas, looks for a Wikidata music-genre item whose English label is
exactly the genre name (case-insensitive) and attaches its human-curated facts: description, inception date,
English Wikipedia article and its free-licensed Commons audio sample. Genres with zero or several matching
items get nothing; there is no hand mapping.
Outputs:
- pipeline/output/genre-info.json
- web/public/data/genre-info.json
"""

import os
import re
import sys
import json
import time
import html
import argparse
from typing import Dict, List, Optional
from urllib.parse import unquote
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
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
HEADERS = {"User-Agent": "MusicAtlas/1.0 (https://music-atlas.app; https://github.com/unkn-wn/music-atlas)"}
COMMONS_BATCH = 50
INVALID_GENRE_NAMES = {"other", "artist", "unknown", "eclectic"}

# Every item that is a music genre (Q188451) or one of its subclasses, with its English label
SPARQL = """
SELECT ?item ?label ?desc ?inception ?precision ?audio ?article WHERE {
  ?item wdt:P31/wdt:P279* wd:Q188451 ;
        rdfs:label ?label FILTER(LANG(?label) = "en")
  OPTIONAL { ?item schema:description ?desc FILTER(LANG(?desc) = "en") }
  OPTIONAL {
    ?item p:P571 ?statement .
    ?statement wikibase:rank ?rank ; psv:P571 [ wikibase:timeValue ?inception ; wikibase:timePrecision ?precision ] .
    FILTER(?rank != wikibase:DeprecatedRank)
  }
  OPTIONAL { ?item wdt:P51 ?audio }
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

def fetch_wikidata_items() -> Dict[str, Dict]:
    resp = requests.get(WDQS_URL, params={"query": SPARQL, "format": "json"}, headers=HEADERS, timeout=180)
    resp.raise_for_status()
    items: Dict[str, Dict] = {}
    for row in resp.json()["results"]["bindings"]:
        qid = row["item"]["value"].rsplit("/", 1)[-1]
        item = items.setdefault(qid, {"label": row["label"]["value"], "desc": None, "since": None, "wiki": None, "audio": set()})
        if "desc" in row:
            item["desc"] = row["desc"]["value"]
        if "article" in row:
            item["wiki"] = row["article"]["value"]
        if "audio" in row:
            item["audio"].add(unquote(row["audio"]["value"].rsplit("/", 1)[-1]))
        if "inception" in row:
            year = parse_year(row["inception"]["value"])
            precision = int(row["precision"]["value"])
            # Keep the earliest stated inception, the most precise one on a tie
            if year is not None and (
                item["since"] is None or (year, -precision) < (item["since"]["year"], -item["since"]["precision"])
            ):
                item["since"] = {"year": year, "precision": precision}
    return items

def strip_html(value: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", value or "")).strip()

def strip_tracking(url: str) -> str:
    return url.split("?", 1)[0]

def is_https(url: Optional[str]) -> bool:
    """These URLs end up in href/src attributes, so only plain https links are kept."""
    return bool(url) and url.startswith("https://")

def fetch_commons_audio(file_names: List[str]) -> Dict[str, Dict]:
    """Resolves Commons audio files to a browser-playable MP3 transcode plus license and author.
    Skips MIDI and files Commons categorises as AI-generated (the atlas only presents human-made work)."""
    resolved: Dict[str, Dict] = {}
    for start in range(0, len(file_names), COMMONS_BATCH):
        batch = file_names[start:start + COMMONS_BATCH]
        params = {
            "action": "query", "format": "json", "formatversion": 2,
            "titles": "|".join(f"File:{name}" for name in batch),
            "prop": "videoinfo|categories", "viprop": "url|extmetadata|derivatives|mime", "cllimit": "max",
        }
        pages: Dict[str, Dict] = {}
        while True:
            resp = requests.get(COMMONS_API, params=params, headers=HEADERS, timeout=60)
            resp.raise_for_status()
            data = resp.json()
            for page in data.get("query", {}).get("pages", []):
                merged = pages.setdefault(page["title"], {"categories": []})
                merged["categories"].extend(c["title"] for c in page.get("categories", []))
                if page.get("videoinfo"):
                    merged["videoinfo"] = page["videoinfo"][0]
            if "continue" not in data:
                break
            params.update(data["continue"])
            time.sleep(0.2)

        for title, page in pages.items():
            info = page.get("videoinfo")
            if not info or "midi" in info.get("mime", ""):
                continue
            if any("ai-generated" in c.lower() for c in page["categories"]):
                continue
            mp3 = next((d["src"] for d in info.get("derivatives", []) if d.get("type") == "audio/mpeg"), None)
            # Only the MP3 transcode plays in every browser (Safari can't play older Ogg uploads)
            if not mp3:
                continue
            src = strip_tracking(mp3)
            if not (is_https(src) and is_https(info.get("descriptionurl"))):
                continue
            meta = info.get("extmetadata", {})
            name = title.split(":", 1)[1]
            resolved[name] = {
                "src": src,
                "page": info["descriptionurl"],
                "title": strip_html(meta.get("ObjectName", {}).get("value", "")) or os.path.splitext(name)[0],
                "author": strip_html(meta.get("Artist", {}).get("value", "")),
                "license": strip_html(meta.get("LicenseShortName", {}).get("value", "")),
            }
        time.sleep(0.5)
    return resolved

def main():
    parser = argparse.ArgumentParser(description="Stage 7: Wikidata & Commons genre enrichment.")
    parser.add_argument("--offline", action="store_true", help="Skip network calls and keep the existing genre-info.json")
    args = parser.parse_args()

    print("=" * 70)
    print(" STAGE 7: GENRE ENRICHMENT (Wikidata + Wikimedia Commons)")
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

    by_label: Dict[str, List[str]] = {}
    for qid, item in items.items():
        by_label.setdefault(item["label"].lower(), []).append(qid)

    matches = {}
    ambiguous = 0
    for genre in genres:
        qids = by_label.get(genre.lower(), [])
        if len(qids) == 1:
            matches[genre] = qids[0]
        elif len(qids) > 1:
            ambiguous += 1

    audio_files = sorted({f for qid in matches.values() for f in items[qid]["audio"]})
    audio = fetch_commons_audio(audio_files)
    print(f"Resolved {len(audio)} of {len(audio_files)} Commons audio files.")

    genre_info = {}
    for genre, qid in matches.items():
        item = items[qid]
        entry = {"wd": qid}
        # The bare "music genre" placeholder description says nothing about the genre
        if item["desc"] and item["desc"].lower() != "music genre":
            entry["desc"] = item["desc"]
        if item["since"]:
            entry["since"] = item["since"]
        if is_https(item["wiki"]):
            entry["wiki"] = item["wiki"]
        sample = next((audio[f] for f in sorted(item["audio"]) if f in audio), None)
        if sample:
            entry["audio"] = sample
        genre_info[genre] = entry

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    for target in [os.path.join(OUTPUT_DIR, "genre-info.json"), os.path.join(WEB_DATA_DIR, "genre-info.json")]:
        with open(target, "w", encoding="utf-8") as f:
            json.dump(genre_info, f, separators=(",", ":"), ensure_ascii=False)

    print(f"\nStage 7 complete in {time.time() - start_time:.2f}s!")
    print(f"Matched {len(genre_info)} genres exactly ({ambiguous} ambiguous labels skipped): "
          f"{sum('since' in e for e in genre_info.values())} with inception, "
          f"{sum('audio' in e for e in genre_info.values())} with a free audio sample.")
    print("=" * 70)

if __name__ == "__main__":
    main()
