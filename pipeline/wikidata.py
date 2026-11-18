"""
Wikidata access shared by Stage 2 (artist genre statements) and Stage 7 (genre facts).
- Genre index: every item that is a music genre (Q188451) or one of its subclasses, with English label, aliases,
  description, inception and English Wikipedia article. Fetched once and cached, so tags and genre facts come from
  the same snapshot. Delete the cache file to refresh it.
- Name matching: exact (case-insensitive) on the item's English label, or failing that on one of its English aliases,
  and only when exactly one item matches. There is no hand mapping.
- Artist genres: the genre statements (P136) of the item carrying the artist's Deezer artist ID (P2722). Cached per
  artist: None = no Wikidata item, [] = item without genre statements, else the sorted genre item IDs.
"""

import os
import re
import json
import time
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Set, Tuple
import requests

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(PIPELINE_DIR, "output")
GENRE_CACHE_FILE = os.path.join(OUTPUT_DIR, "wikidata_genre_cache.json")
ARTIST_CACHE_FILE = os.path.join(OUTPUT_DIR, "wikidata_artist_cache.json")

WDQS_URL = "https://query.wikidata.org/sparql"
HEADERS = {"User-Agent": "MusicAtlas/1.0 (https://music-atlas.app; https://github.com/unkn-wn/music-atlas)"}
ARTIST_BATCH = 400
MAX_ATTEMPTS = 6

GENRE_SPARQL = """
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

def save_json_cache(fpath: str, data) -> None:
    """Atomic write: a crash mid-write never leaves a truncated cache."""
    temp = fpath + ".tmp"
    with open(temp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    os.replace(temp, fpath)

def load_json_cache(fpath: str, default):
    if os.path.exists(fpath):
        with open(fpath, "r", encoding="utf-8") as f:
            return json.load(f)
    return default

def query(sparql: str, timeout: int = 180) -> List[Dict]:
    """POSTs a SPARQL query, honouring Retry-After on 429 and backing off on server errors and timeouts."""
    for attempt in range(MAX_ATTEMPTS):
        try:
            resp = requests.post(WDQS_URL, data={"query": sparql, "format": "json"}, headers=HEADERS, timeout=timeout)
            if resp.status_code == 429:
                time.sleep(float(resp.headers.get("Retry-After", 30)))
                continue
            if 400 <= resp.status_code < 500:
                raise RuntimeError(f"Wikidata rejected the query (HTTP {resp.status_code}): {resp.text[:200]}")
            resp.raise_for_status()
            return resp.json()["results"]["bindings"]
        except (requests.RequestException, ValueError, KeyError) as e:
            wait = 10 * (attempt + 1)
            print(f"  Wikidata query failed ({e}); retrying in {wait}s")
            time.sleep(wait)
    raise RuntimeError("Wikidata query service unavailable after retries")

def parse_year(time_value: str) -> Optional[int]:
    """Wikidata time values look like '1965-01-01T00:00:00Z' or '-1999-01-01T00:00:00Z'."""
    m = re.match(r"^(-?\d+)-", time_value)
    return int(m.group(1)) if m else None

def load_genre_items(offline: bool = False) -> Dict[str, Dict]:
    """Genre items {qid: {label, aliases, desc, since, wiki}} from the cache, fetched first if it is missing."""
    cached = load_json_cache(GENRE_CACHE_FILE, None)
    if cached is not None:
        return cached["items"]
    if offline:
        raise FileNotFoundError(f"Offline run without {GENRE_CACHE_FILE}; run once online to fetch the Wikidata genre index.")
    items: Dict[str, Dict] = {}
    aliases: Dict[str, Set[str]] = {}
    for row in query(GENRE_SPARQL):
        qid = row["item"]["value"].rsplit("/", 1)[-1]
        item = items.setdefault(qid, {"label": row["label"]["value"], "desc": None, "since": None, "wiki": None})
        aliases.setdefault(qid, set())
        if "alias" in row:
            aliases[qid].add(row["alias"]["value"].lower())
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
    for qid, item in items.items():
        item["aliases"] = sorted(aliases[qid])
    # An empty answer would be cached for good and silently switch off the Wikidata tag tier and genre facts
    if not items:
        raise RuntimeError("Wikidata returned no music-genre items; not caching an empty genre index.")
    save_json_cache(GENRE_CACHE_FILE, {"fetchedAt": datetime.now(timezone.utc).isoformat(), "items": items})
    return items

def index_names(items: Dict[str, Dict]) -> Tuple[Dict[str, Set[str]], Dict[str, Set[str]]]:
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

def genres_by_item(genre_names: Iterable[str], items: Dict[str, Dict]) -> Dict[str, List[str]]:
    """
    Reverse of match_genre over a genre vocabulary: item -> the genre names it matches. When an item matches some names
    by its label, names that only match one of its aliases are dropped, so such a statement does not become several
    synonym tags (an "uplifting trance" statement must not also tag "dutch trance"). An item that matches no name by
    its label keeps every alias-matched name (a few items, e.g. banda / banda sinaloense).
    """
    by_label, by_alias = index_names(items)
    matched: Dict[str, List[Tuple[bool, str]]] = {}
    for name in genre_names:
        qid = match_genre(name, by_label, by_alias)
        if qid:
            matched.setdefault(qid, []).append((name.lower() in by_label, name))
    out = {}
    for qid, names in matched.items():
        has_label = any(is_label for is_label, _ in names)
        out[qid] = sorted(n for is_label, n in names if is_label or not has_label)
    return out

def load_artist_genres(deezer_ids: Iterable[str], offline: bool = False) -> Dict[str, Optional[List[str]]]:
    """Genre item IDs per Deezer artist ID ("dz_<id>"), fetched for IDs missing from the cache."""
    deezer_ids = list(deezer_ids)
    cache: Dict[str, Optional[List[str]]] = load_json_cache(ARTIST_CACHE_FILE, {})
    todo = sorted(i for i in set(deezer_ids) if i not in cache and i.startswith("dz_") and i[3:].isdigit())
    if todo and offline:
        print(f"  Offline: {len(todo)} artists missing from the Wikidata cache are treated as having no Wikidata genres.")
        todo = []
    if todo:
        print(f"  Fetching Wikidata genre statements for {len(todo)} artists ({ARTIST_BATCH} per query)...")
    for b in range(0, len(todo), ARTIST_BATCH):
        batch = todo[b:b + ARTIST_BATCH]
        values = " ".join(f'"{i[3:]}"' for i in batch)
        rows = query(f"SELECT ?dz ?genre WHERE {{ VALUES ?dz {{ {values} }} ?item wdt:P2722 ?dz . OPTIONAL {{ ?item wdt:P136 ?genre }} }}", timeout=90)
        found: Dict[str, Set[str]] = {}
        for row in rows:
            genres = found.setdefault("dz_" + row["dz"]["value"], set())
            if "genre" in row:
                genres.add(row["genre"]["value"].rsplit("/", 1)[-1])
        for i in batch:
            cache[i] = sorted(found[i]) if i in found else None
        save_json_cache(ARTIST_CACHE_FILE, cache)
        time.sleep(1.0)
    return {i: cache.get(i) for i in deezer_ids}
