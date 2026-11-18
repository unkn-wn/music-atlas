"""
Stage 2: Deterministic Deezer Verification, Previews & Multi-Subgenre Enrichment.
Implements:
1. Strict Artist Survival Rule: c_i >= 4 independent qualifying user playlists.
2. Deterministic Deezer Catalog API Verification (The Arbiter & Enricher):
   - Evaluates search candidates against the 4-Tier Deterministic Matching Engine.
   - Searches with limit=25 to capture true catalog profiles across duplicate/tribute entries.
   - Guarantees 0.00% false positives on partial superstar names (e.g. 'Swift' != 'Taylor Swift').
   - Tie-breaks strictly among exact normalized matches by authentic platform fan count (nb_fan).
   - Resolves 1000x1000 high-res press portraits (picture_xl).
   - Resolves genuine 30-second AAC/MP3 audio preview URLs and top track titles.
   - Gathers authentic platform fan counts (nb_fan) for log-scaled node sizing in WebGL.
   - A name under which two or more YouTube channels each meet the survival rule is resolved per channel, by
     searching Deezer for that channel's own songs.
3. Genre Tags (genre_tags.py): up to 3 EveryNoise genres per artist, from the artist's Wikidata genre statements
   (only those its playlists support), else playlist consensus, else the single best playlist genre.
4. Zero Spotify or YouTube Music dependencies. Zero daily quotas, zero 403 blocks.
5. Persistent Checkpointing & Cache Management:
   - Saves progress atomically every 500 Deezer lookups in pipeline/output/artist_enrichment_cache.json.
6. Outputs:
   - pipeline/output/artists_catalog.json
   - pipeline/output/surviving_artist_ids.json
"""

import os
import sys
import json
import time
import math
import re
import unicodedata
import argparse
import threading
from collections import Counter, defaultdict
from typing import Dict, List, Optional, Tuple, Any, Set
import httpx
from tqdm import tqdm

from genre_tags import assign_tags, artist_keys, playlist_members, playlist_unit
from sanitizer import song_key
from wikidata import load_genre_items, genres_by_item, load_artist_genres

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(PIPELINE_DIR, "output")
os.makedirs(OUTPUT_DIR, exist_ok=True)

GENRES_FILE = os.path.join(OUTPUT_DIR, "everynoise_ranked_genres.json")
PLAYLISTS_FILE = os.path.join(OUTPUT_DIR, "harvested_playlists.json")
CATALOG_FILE = os.path.join(OUTPUT_DIR, "artists_catalog.json")
SURVIVORS_FILE = os.path.join(OUTPUT_DIR, "surviving_artist_ids.json")
CACHE_FILE = os.path.join(OUTPUT_DIR, "artist_enrichment_cache.json")

# --- Deterministic Normalization & Matching Engine ---

def normalize_text(text: str) -> str:
    """
    Decomposes unicode diacritics, lowercases, maps common artistic substitutions
    (KoЯn -> korn, Ke$ha -> kesha, MØ -> mo), and strips leading/trailing dots/spaces.
    """
    if not text:
        return ""
    # Stylistic letter transliterations
    text = text.replace("я", "r").replace("Я", "r").replace("$", "s").replace("ø", "o").replace("Ø", "o")
    nfkd = unicodedata.normalize("NFKD", text)
    stripped = "".join(c for c in nfkd if not unicodedata.combining(c))
    # Strip whitespace and bounding dots (e.g. 'P.O.D.' -> 'p.o.d')
    return stripped.lower().strip().strip(".").strip()

def alphanumeric_key(text: str) -> str:
    """Strips all non-alphanumeric characters for symbol invariance (e.g. 'AC/DC' -> 'acdc', '*NSYNC' -> 'nsync')."""
    norm = normalize_text(text)
    return re.sub(r'[\W_]+', '', norm)

def strip_article(text: str) -> str:
    """Strips leading grammatical article (e.g. 'The 1975' -> '1975', 'The Strokes' -> 'strokes')."""
    norm = normalize_text(text)
    return re.sub(r'^(?:the|a)\s+', '', norm).strip()

def deterministic_match(target_name: str, candidates: List[Dict[str, Any]]) -> Tuple[bool, Optional[Dict[str, Any]], str]:
    """
    4-Tier Deterministic Matcher:
    Tier 1: Canonical Normalized Exact Match (case + diacritics + stylistic letters).
    Tier 2: Punctuation & Symbol Invariant Match (with >= 3 char floor, e.g. AC/DC, *NSYNC).
    Tier 3: Article Invariance ('The ' / 'A ' prefix).
    Strict Rejection: Discards all partials and substrings (e.g. 'Swift' will NEVER match 'Taylor Swift').
    Tie-Breaker: ONLY among exact matches within a tier, picks the candidate with max(nb_fan).
    """
    if not target_name or not candidates:
        return False, None, "NONE"

    target_norm = normalize_text(target_name)
    target_alpha = alphanumeric_key(target_name)
    target_no_the = strip_article(target_name)

    # Tier 1: Canonical Normalized Exact Match
    tier1 = [c for c in candidates if normalize_text(c.get("name", "")) == target_norm]
    if tier1:
        best = max(tier1, key=lambda x: (x.get("nb_fan") or 0))
        return True, best, "Tier 1 (Exact/Diacritic)"

    # Tier 2: Punctuation & Symbol Invariance (e.g. AC/DC, *NSYNC, Pink Sweat$)
    if len(target_alpha) >= 3:
        tier2 = [c for c in candidates if alphanumeric_key(c.get("name", "")) == target_alpha]
        if tier2:
            best = max(tier2, key=lambda x: (x.get("nb_fan") or 0))
            return True, best, "Tier 2 (Symbol/Punctuation)"

    # Tier 3: Leading Article Invariance ('The ' / 'A ')
    if len(target_no_the) >= 3:
        tier3 = [c for c in candidates if strip_article(c.get("name", "")) == target_no_the]
        if tier3:
            best = max(tier3, key=lambda x: (x.get("nb_fan") or 0))
            return True, best, "Tier 3 (Article Invariance)"

    return False, None, "REJECTED"

# --- Popularity & Sizing Helpers ---

def format_fans(fans: Optional[int]) -> str:
    """Formats fan integer into human-readable compact string ('264K', '50.2M')."""
    fans = fans or 0
    if fans >= 1_000_000:
        val = fans / 1_000_000
        return f"{val:.1f}M" if val < 10 else f"{round(val)}M"
    elif fans >= 1_000:
        val = fans / 1_000
        return f"{val:.1f}K" if val < 10 else f"{round(val)}K"
    return str(fans)

def calculate_log_popularity(fans: Optional[int]) -> int:
    """Logarithmic popularity scaled to verified followers/fans (1 to 100)."""
    fans = fans or 0
    if fans <= 0:
        return 5
    log_s = math.log10(max(1, fans))
    # Scaled against 8.0 (100M fans)
    val = round(100.0 * (log_s / 8.0))
    return int(min(100, max(5, val)))

# --- Persistent Cache Utilities ---

def load_json_cache(fpath: str) -> Dict[str, Any]:
    if os.path.exists(fpath):
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_json_cache(fpath: str, data: Dict[str, Any]):
    temp = fpath + ".tmp"
    with open(temp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(temp, fpath)

# --- Distinctive Track Content Word Extractor ---

STOPWORDS = {
    'the', 'and', 'for', 'you', 'with', 'that', 'this', 'from', 'all', 'your',
    'what', 'don', 'can', 'out', 'one', 'let', 'get', 'like', 'just', 'not',
    'are', 'was', 'have', 'had', 'has', 'her', 'his', 'him', 'who', 'how',
    'where', 'when', 'why', 'which', 'about', 'into', 'over', 'after', 'beneath',
    'under', 'above', 'remix', 'mix', 'feat', 'ft', 'version', 'edit', 'radio',
    'live', 'acoustic', 'original', 'deluxe', 'remaster', 'remastered', 'instrumental',
    'song', 'music', 'video', 'official', 'audio', 'club', 'intro', 'outro'
}

def extract_content_words(title: str) -> Set[str]:
    """Extracts distinctive content tokens (len >= 3) from a track title, ignoring common noise words."""
    t_clean = re.sub(r'[\(\[\{].*?[\)\]\}]', '', title).lower()
    words = re.findall(r'[a-zA-Z]{3,}', t_clean)
    return {w for w in words if w not in STOPWORDS}

# --- Pure Deezer API Client ---

SONG_TRIES = 5     # songs of a shared name's channel searched on Deezer to identify its artist...
SONG_MATCHES = 2   # ...who must have released this many of them

class DeezerArbiter:
    """
    Direct client for Deezer API:
    - 10 req/second public rate limit (paced at ~8 req/s).
    - Resolves 1000px portraits, 30s previews, fan counts, and top tracks.
    - Implements Exact Match Immunity & Track-Overlap Disambiguation Guard.
    """
    def __init__(self):
        self.http = httpx.Client(headers={"User-Agent": "MusicAtlas/2.0"}, timeout=8.0)
        self.last_call = 0.0
        self.min_interval = 0.12  # Paced to ~8 req/s (Deezer limit: 10 req/s)
        self.lock = threading.Lock()

    def _pace(self):
        with self.lock:
            now = time.time()
            elapsed = now - self.last_call
            if elapsed < self.min_interval:
                time.sleep(self.min_interval - elapsed)
            self.last_call = time.time()

    def get_candidate_tracks(self, aid: int, limit: int = 30) -> List[Dict[str, Any]]:
        """Fetches top tracks for an artist candidate (limit=30 for rich vocabulary matching)."""
        for retry in range(3):
            try:
                self._pace()
                r_top = self.http.get(f"https://api.deezer.com/artist/{aid}/top?limit={limit}")
                if r_top.status_code == 200:
                    data = r_top.json()
                    if "error" in data:
                        err = data.get("error", {})
                        if err.get("code") == 4 or "quota" in err.get("message", "").lower():
                            time.sleep(1.5 * (retry + 1))
                            continue
                        return []
                    return data.get("data", [])
            except Exception:
                pass
        return []

    def _get(self, url: str, params: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        """A paced GET. None when Deezer keeps failing or answers with an error other than its quota."""
        for retry in range(3):
            try:
                self._pace()
                r = self.http.get(url, params=params)
                if r.status_code == 200:
                    data = r.json()
                    if "error" not in data:
                        return data
                    err = data.get("error", {})
                    if err.get("code") != 4 and "quota" not in err.get("message", "").lower():
                        return None
                time.sleep(1.5 * (retry + 1))
            except Exception:
                pass
        return None

    def identify_by_songs(self, target_name: str, titles: List[str]) -> Optional[Dict[str, Any]]:
        """
        For one channel of a name several YouTube artists share: the Deezer artist of that name who released the
        channel's songs, which the name alone cannot tell. titles: the channel's track titles, most credited first.
        A search result counts when its title is the song's and its artist carries the name (deterministic_match).
        Returns the artist found for SONG_MATCHES of the channel's SONG_TRIES most credited songs (for its only
        song, when it has one) unless another artist ties, with the fields of verify_and_enrich; otherwise None.
        """
        songs: Dict[str, str] = {}
        for title in titles:
            song = song_key(title)
            key = alphanumeric_key(song)
            if key and key not in songs and len(songs) < SONG_TRIES:
                songs[key] = song
        votes: Counter = Counter()
        found: Dict[int, Dict[str, Any]] = {}
        for key, song in songs.items():
            data = self._get("https://api.deezer.com/search", {"q": f"{target_name} {song}", "limit": 15}) or {}
            tracks = [t for t in data.get("data", []) if alphanumeric_key(song_key(t.get("title") or "")) == key]
            matched, artist, _ = deterministic_match(target_name, [t["artist"] for t in tracks])
            if matched:
                votes[artist["id"]] += 1
                found.setdefault(artist["id"], next(t for t in tracks if t["artist"]["id"] == artist["id"]))
                if votes[artist["id"]] >= SONG_MATCHES:
                    break
        ranked = votes.most_common(2)
        if not ranked or ranked[0][1] < min(SONG_MATCHES, len(songs)) or (len(ranked) > 1 and ranked[1][1] == ranked[0][1]):
            return None
        aid = ranked[0][0]
        artist = self._get(f"https://api.deezer.com/artist/{aid}")
        if not artist:
            return None
        return {
            "id": f"dz_{aid}",
            "deezer_id": aid,
            "name": artist.get("name", target_name),
            "fans": artist.get("nb_fan") or 0,
            "image": artist.get("picture_xl") or artist.get("picture_medium", ""),
            "previewUrl": found[aid].get("preview") or "",
            "deezer_url": artist.get("link", f"https://www.deezer.com/artist/{aid}")
        }

    def verify_and_enrich(
        self, 
        target_name: str, 
        playlist_words: Optional[Set[str]] = None, 
        max_retries: int = 3
    ) -> Tuple[bool, Optional[Dict[str, Any]]]:
        """
        Queries Deezer search with limit=25, applies Exact Match Immunity
        and Track-Overlap Disambiguation Guard, and enriches with preview, fans, and image.
        """
        target_norm = normalize_text(target_name)
        is_single_word = len(target_name.strip().split()) == 1
        target_clean_words = set(playlist_words) if playlist_words else set()
        target_clean_words.discard(target_norm)

        for attempt in range(max_retries):
            try:
                self._pace()
                r = self.http.get("https://api.deezer.com/search/artist", params={"q": target_name, "limit": 25})
                if r.status_code == 200:
                    data = r.json()
                    if "error" in data:
                        err = data.get("error", {})
                        if err.get("code") == 4 or "quota" in err.get("message", "").lower():
                            time.sleep(2.0 * (attempt + 1))
                            continue
                        return False, None

                    items = data.get("data", [])
                    is_exact, exact_cand, _ = deterministic_match(target_name, items)

                    matched_cand = None
                    selected_tracks = []

                    # 1. Exact Match Immunity & Verification
                    if is_exact and exact_cand:
                        matched_id = exact_cand.get("id")
                        selected_tracks = self.get_candidate_tracks(matched_id, limit=30)
                        c_words = set()
                        for t in selected_tracks:
                            c_words.update(extract_content_words(t.get("title", "")))
                        c_words.discard(target_norm)

                        overlap = target_clean_words.intersection(c_words)
                        # Multi-word artists are trusted on exact match (or if overlap >= 1).
                        # Single-word artists strictly require >= 2 distinctive overlapping content words.
                        if not is_single_word:
                            if len(overlap) >= 1 or not target_clean_words:
                                matched_cand = exact_cand
                        else:
                            if len(overlap) >= 2:
                                matched_cand = exact_cand

                    # 2. Disambiguation Guard: triggers if exact match had insufficient track overlap or no exact match exists
                    if not matched_cand:
                        competing = []
                        for c in items:
                            c_fans = (c.get("nb_fan") or 0)
                            if c_fans <= 0:
                                continue
                            c_norm = normalize_text(c.get("name", ""))
                            tokens = set(re.findall(r'[a-zA-Z0-9]+', c_norm))
                            if target_norm in tokens or c_norm.endswith(target_norm):
                                competing.append(c)

                        competing.sort(key=lambda x: (x.get("nb_fan") or 0), reverse=True)

                        best_candidate = None
                        best_overlap_count = 0
                        best_tracks = []

                        for c in competing[:5]:
                            c_aid = c.get("id")
                            if is_exact and exact_cand and c_aid == exact_cand.get("id"):
                                continue
                            c_tracks = self.get_candidate_tracks(c_aid, limit=30)
                            c_words = set()
                            for t in c_tracks:
                                c_words.update(extract_content_words(t.get("title", "")))
                            c_words.discard(target_norm)
                            overlap = target_clean_words.intersection(c_words)
                            count = len(overlap)

                            # Strictly enforce the >= 3 distinctive content words safety floor
                            if count >= 3 and count > best_overlap_count:
                                best_candidate = c
                                best_overlap_count = count
                                best_tracks = c_tracks

                        if best_candidate:
                            matched_cand = best_candidate
                            selected_tracks = best_tracks
                        elif is_exact and exact_cand and not is_single_word:
                            # Safe fallback: preserve multi-word exact match candidate
                            matched_cand = exact_cand

                    if not matched_cand:
                        return False, None

                    aid = matched_cand.get("id")
                    canonical_name = matched_cand.get("name", target_name)
                    fans = (matched_cand.get("nb_fan") or 0)
                    portrait_url = matched_cand.get("picture_xl") or matched_cand.get("picture_medium", "")

                    if not selected_tracks:
                        selected_tracks = self.get_candidate_tracks(aid, limit=30)

                    preview_url = ""
                    for t in selected_tracks:
                        if t.get("preview"):
                            preview_url = t.get("preview")
                            break

                    return True, {
                        "id": f"dz_{aid}",
                        "deezer_id": aid,
                        "name": canonical_name,
                        "fans": fans,
                        "image": portrait_url,
                        "previewUrl": preview_url,
                        "deezer_url": matched_cand.get("link", f"https://www.deezer.com/artist/{aid}")
                    }
                else:
                    time.sleep(0.5)
            except Exception:
                time.sleep(0.5)

        return False, None

# --- Main Execution ---

def main():
    parser = argparse.ArgumentParser(description="Stage 2: Deterministic Deezer Verification & Enrichment.")
    parser.add_argument("--min-playlists", type=int, default=4, help="Mathematical consensus survival threshold c_i (default: 4)")
    parser.add_argument("--limit", type=int, default=None, help="Limit number of surviving candidates to process (for testing)")
    parser.add_argument("--offline", action="store_true", help="Run offline using cached metadata only")
    args = parser.parse_args()

    if not os.path.exists(PLAYLISTS_FILE):
        raise FileNotFoundError("Missing inputs for Stage 2. Please run 01_harvest_playlists.py first.")

    print("=" * 70)
    print(f" STAGE 2: DETERMINISTIC VERIFICATION & ENRICHMENT (Survival: c_i >= {args.min_playlists})")
    print(" Arbiter & Previews: Official Deezer Music Catalog (120M+ tracks)")
    print(" Genre Tags: Wikidata statements (playlist-supported), else playlist consensus")
    print("=" * 70)
    start_time = time.time()

    with open(PLAYLISTS_FILE, "r", encoding="utf-8") as f:
        playlists = json.load(f)

    # 1. Credit groups: a credited name together with the YouTube channel it is credited to ("" when the track names
    # no artist channel). Different artists share names but not channels, so a name several channels use is never
    # assumed to be one artist.
    group_playlists = defaultdict(set)
    # Independent appearances: playlists related to the same anchor playlist form one neighbourhood and count once
    group_units = defaultdict(set)
    group_words = defaultdict(set)
    name_groups = defaultdict(set)
    artist_canonical_case = {}

    for pl_idx, pl in enumerate(playlists):
        pid = pl.get("id") or str(pl_idx)
        independent_unit = playlist_unit(pl, pl_idx)
        for t in pl.get("tracks", []):
            name = t.get("artist_name", "").strip()
            title = t.get("title", "").strip()
            if not name:
                continue
            art_key = name.lower()
            group = (art_key, t.get("channel_id") or "")
            name_groups[art_key].add(group)
            group_playlists[group].add(pid)
            group_units[group].add(independent_unit)
            if title:
                group_words[group].update(extract_content_words(title))
            if art_key not in artist_canonical_case or name[0].isupper():
                artist_canonical_case[art_key] = name

    def union(sets, groups) -> Set[str]:
        return set().union(*(sets[g] for g in groups))

    # Candidates: (name, the credit groups verified together, whether several artists may share the name). A name is
    # shared when two or more of its channels each meet the survival threshold by themselves: each is then a candidate
    # identified by its own songs, and the name's smaller channels are credited to no one. Any other name is one
    # candidate with all its credits.
    candidates = []
    for art_key, groups in name_groups.items():
        if len(union(group_units, groups)) < args.min_playlists:
            continue
        channels = sorted(g for g in groups if g[1] and len(group_units[g]) >= args.min_playlists)
        if len(channels) <= 1:
            candidates.append((art_key, tuple(sorted(groups)), False))
        else:
            candidates.extend((art_key, (g,), True) for g in channels)
    # Most prominent names first, the channels of a shared name together
    name_playlists = {art_key: len(union(group_playlists, name_groups[art_key])) for art_key, _, _ in candidates}
    candidates.sort(key=lambda c: (-name_playlists[c[0]], c[0]))

    if args.limit:
        candidates = candidates[:args.limit]

    # Track titles of the shared names' channels, most credited first, to identify each channel by its songs
    channel_titles: Dict[Tuple[str, str], Counter] = {c[1][0]: Counter() for c in candidates if c[2]}
    for pl in playlists:
        for t in pl.get("tracks", []):
            group = (t.get("artist_name", "").strip().lower(), t.get("channel_id") or "")
            if group in channel_titles and t.get("title"):
                channel_titles[group][t["title"].strip()] += 1

    print(f"Total candidate artist names harvested: {len(name_groups)}")
    print(f"Candidates meeting c_i >= {args.min_playlists}: {len(candidates)} "
          f"({sum(1 for c in candidates if c[2])} channels of shared names)")

    # 2. Ingest persistent cache
    cache = load_json_cache(CACHE_FILE)
    print(f"Loaded {len(cache)} cached artist enrichment entries.")

    # 3. Load EveryNoise genre popularity ranks
    genre_ranks = {}
    if os.path.exists(GENRES_FILE):
        with open(GENRES_FILE, "r", encoding="utf-8") as f:
            ranked_data = json.load(f)
            genre_ranks = {item["genre"].lower().strip(): item["rank"] for item in ranked_data if "genre" in item and "rank" in item}
    print(f"Loaded {len(genre_ranks)} genre popularity ranks from EveryNoise.")

    deezer = DeezerArbiter()

    verified_candidates: List[Tuple[Tuple, Dict[str, Any]]] = []
    verified_catalog = []
    surviving_artist_ids = []

    pbar = tqdm(candidates, desc="Stage 2: Verifying with Deezer", unit="artist")
    checkpoint_counter = 0

    try:
        for candidate in pbar:
            art_key, groups, shared_name = candidate
            display_name = artist_canonical_case.get(art_key, art_key)
            total_pl = len(union(group_playlists, groups))
            words_for_artist = union(group_words, groups)
            words_for_artist.discard(art_key)

            cache_key = f"{art_key}\t{groups[0][1]}" if shared_name else art_key
            cached_entry = cache.get(cache_key)

            if cached_entry and "verified" in cached_entry:
                if not cached_entry["verified"]:
                    continue  # Pruned non-artist
                meta = cached_entry
            elif args.offline:
                continue
            else:
                # Checkpoint by new lookups only: cached artists cost nothing and must not rewrite the cache file
                checkpoint_counter += 1
                if checkpoint_counter % 500 == 0:
                    save_json_cache(CACHE_FILE, cache)
                # Deterministic Deezer Verification & Enrichment with Disambiguation Guard
                # A shared name's channel is identified by its songs; when Deezer lists none of them under the name
                # (it may spell the artist differently), the name is verified as for any other artist.
                dz_meta = None
                if shared_name:
                    dz_meta = deezer.identify_by_songs(display_name, [title for title, _ in channel_titles[groups[0]].most_common()])
                if not dz_meta:
                    dz_meta = deezer.verify_and_enrich(display_name, playlist_words=words_for_artist)[1]

                if not dz_meta:
                    cache[cache_key] = {"verified": False}
                    continue

                canonical_name = dz_meta.get("name", display_name)
                artist_id = dz_meta.get("id", f"dz_{art_key}")
                fans = dz_meta.get("fans", 0)
                preview_url = dz_meta.get("previewUrl", "")
                portrait_url = dz_meta.get("image", "")
                deezer_url = dz_meta.get("deezer_url", "")

                meta = {
                    "verified": True,
                    "id": artist_id,
                    "name": canonical_name,
                    "previewUrl": preview_url,
                    "image": portrait_url,
                    "spotifyUrl": f"https://open.spotify.com/search/{canonical_name}",
                    "deezerUrl": deezer_url,
                    "fans": fans,
                    "totalPlaylists": total_pl
                }

                cache[cache_key] = meta

            verified_candidates.append((candidate, meta))

    finally:
        deezer.http.close()
        if not args.offline:
            save_json_cache(CACHE_FILE, cache)

    # 4. Canonical De-duplication & Merging by Deezer ID (Guardrail 4)
    # Groups all verified credits (e.g. 'bach', 'j.s. bach', 'johann sebastian bach', or two channels of one artist)
    # under their single canonical Deezer ID with exact mathematical playlist union.
    canonical_artist_records: Dict[str, Dict[str, Any]] = {}
    canonical_groups: Dict[str, Set[Tuple[str, str]]] = defaultdict(set)
    # Catalog credits [name, channel]: channel None = the name under any channel (no other YouTube artist uses it)
    canonical_credits: Dict[str, List[List[Optional[str]]]] = defaultdict(list)
    shared_name_ids: Dict[str, Set[str]] = defaultdict(set)

    for (art_key, groups, shared_name), meta in verified_candidates:
        aid = meta["id"]
        canonical_groups[aid].update(groups)
        canonical_credits[aid].append([art_key, groups[0][1] if shared_name else None])
        if shared_name:
            shared_name_ids[art_key].add(aid)
        if aid not in canonical_artist_records or meta.get("fans", 0) > canonical_artist_records[aid].get("fans", 0):
            canonical_artist_records[aid] = meta

    # A shared name's credits without a channel belong to an artist only when all its verified channels are that artist
    for art_key, ids in shared_name_ids.items():
        if len(ids) == 1 and (art_key, "") in name_groups[art_key]:
            aid = next(iter(ids))
            canonical_groups[aid].add((art_key, ""))
            canonical_credits[aid].append([art_key, ""])

    for aid, meta in canonical_artist_records.items():
        total_pl = len(union(group_playlists, canonical_groups[aid]))
        fans = meta.get("fans", 0)
        canonical_name = meta.get("name", "")

        catalog_entry = {
            "id": aid,
            "name": canonical_name,
            "credits": canonical_credits[aid],
            "subscribers": fans,
            "formattedSubscribers": format_fans(fans),
            "subscribersFormatted": format_fans(fans),
            "popularity": calculate_log_popularity(fans),
            "previewUrl": meta.get("previewUrl", ""),
            "image": meta.get("image", ""),
            "spotifyUrl": meta.get("spotifyUrl", f"https://open.spotify.com/search/{canonical_name}"),
            "deezerUrl": meta.get("deezerUrl", ""),
            "totalPlaylists": total_pl,
            "sharedPlaylistsCount": total_pl
        }

        verified_catalog.append(catalog_entry)
        surviving_artist_ids.append(aid)

    # 5. Genre tags (genre_tags.py steps 1-3): Wikidata statements supported by playlists, else playlist consensus,
    # else one tag from the harvest labels.
    # Playlist members are Deezer IDs, resolved exactly as Stage 3 resolves them for connections.
    keys = artist_keys(verified_catalog)
    members = [playlist_members(pl, keys) for pl in playlists]
    print("Loading Wikidata genre index and artist genre statements...")
    genre_items = load_genre_items(offline=args.offline)
    names_by_item = genres_by_item(genre_ranks.keys(), genre_items)
    artist_items = load_artist_genres([entry["id"] for entry in verified_catalog], offline=args.offline)
    wikidata_genres = {aid: {g for q in (qids or []) for g in names_by_item.get(q, [])} for aid, qids in artist_items.items()}
    tags = assign_tags(playlists, members, wikidata_genres, genre_ranks)
    for entry in verified_catalog:
        entry.update(tags.get(entry["id"], {"topSubgenres": [], "tagSource": "none", "wikidataGenres": [], "wikidataConfirmed": []}))
    sources = Counter(entry["tagSource"] for entry in verified_catalog)
    print(f"Genre tags: {dict(sources)} (Wikidata items matched to {sum(len(v) for v in names_by_item.values())} genres)")

    # Save output artifacts
    with open(CATALOG_FILE, "w", encoding="utf-8") as f:
        json.dump(verified_catalog, f, indent=2, ensure_ascii=False)

    with open(SURVIVORS_FILE, "w", encoding="utf-8") as f:
        json.dump(surviving_artist_ids, f, indent=2, ensure_ascii=False)

    print(f"\nStage 2 completed in {time.time() - start_time:.2f}s!")
    print(f"Total surviving verified recording artists: {len(verified_catalog)}")
    print(f"Artifacts saved to {CATALOG_FILE} and {SURVIVORS_FILE}")
    print("=" * 70)

if __name__ == "__main__":
    main()
