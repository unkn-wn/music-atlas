"""
Stage 1: Authentic Multi-Subgenre Community Playlist Harvesting.
Harvests public user-created playlists from YouTube Music across all EveryNoise subgenres equally.
Implements:
1. Equal Analysis Across All Subgenres: No hardcoded artists, promo keyword overrides, or subgenre favoritism.
2. Two-Phase Harvesting:
   - Phase 1 (search): "{genre} playlist", "{genre} mix", "best of {genre}", "{genre} songs" via filter="community_playlists",
     ranked by a consensus coherence gate (up to --tier1-limit per genre). Runs for every genre first.
   - Phase 2 (recommended): "Recommended playlists" shelves of verified anchor songs. Equal budget per genre:
     search playlists + playlists found through its anchors stop at --target-playlists.
     Uses an unauthenticated client, so shelves are never personalized to an account.
3. Verified Anchors & Content Labels (Phase 2), judged only against Phase 1 search results:
   - Anchor artist appears in >= 2 playlists whose human-written title contains the genre name (all search playlists
     if the genre has fewer than 2 such titles), and the genre is one of the artist's strongest homes.
   - Anchor song: the artist's catalog release most often included in those playlists.
   - Every valid recommended playlist is kept as co-occurrence evidence. Its genre label comes from its artists:
     the seed genre if >= 30% of them are its core artists (and it is close to the best match), else the
     best-matching genre at >= 30%, else unlabeled (no genre tag).
4. System & Algorithmic Guard:
   - Rejects system authors ("YouTube Music", "Spotify", "Various Artists - Topic", etc.)
   - Rejects algorithmic mixes ("RDCLAK...", "My Supermix", "Supermix", rdampl)
   - Rejects "Sound of" / auto-generated titles
5. Quality & Anti-Discography Filters:
   - Tracklist boundary strictly 10 <= tracks <= 150
   - Anti-discography guard: single-artist share <= 50%
   - Global curator cap: max 2 playlists per curator ID
6. Intra-Playlist Multi-Prefix Principle:
   - Mathematically detects uploader/curator channels having >= 2 distinct "Artist - Title" prefixes.
   - Extracts true recording artist candidate from prefix without hardcoded keyword lists.
7. Zero External API Calls in Stage 01 (Runs purely on YouTube Music; iTunes verification is deferred to Stage 02).
8. Near-duplicate guard: copied/re-saved/extended playlists (>= 90% of the smaller tracklist shared) are rejected.
9. Atomic compact checkpointing every 10 minutes.
"""

import os
import sys
import json
import time
import re
import random
import hashlib
import argparse
import unicodedata
from collections import Counter, defaultdict
from typing import Dict, List, Optional, Tuple, Any, Set

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

from ytmusicapi import YTMusic
from tqdm import tqdm
from sanitizer import sanitize_artist_name, split_artist_names

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(PIPELINE_DIR, "output")
os.makedirs(OUTPUT_DIR, exist_ok=True)

GENRES_FILE = os.path.join(OUTPUT_DIR, "everynoise_ranked_genres.json")
PLAYLISTS_FILE = os.path.join(OUTPUT_DIR, "harvested_playlists.json")
STATE_FILE = os.path.join(OUTPUT_DIR, "harvest_state.json")

SYSTEM_AUTHORS = {
    "youtube music", "spotify", "various artists - topic", "youtube", "music", "vevo"
}

DISALLOWED_TOKENS = ["rdampl", "my supermix", "supermix"]

DISALLOWED_TITLE_PATTERNS = [
    re.compile(r"\bthe sound of\b", re.IGNORECASE),
    re.compile(r"\bsound of\b", re.IGNORECASE),
    re.compile(r"^intro to\b", re.IGNORECASE),
    re.compile(r"^pulse of\b", re.IGNORECASE),
    re.compile(r"^edge of\b", re.IGNORECASE),
]

DUPLICATE_OVERLAP = 0.9
CHECKPOINT_INTERVAL_SEC = 600

ANCHOR_HOME_RATIO = 0.5       # anchor's share of this genre's playlists >= half its share in its strongest genre
REC_MIN_COHERENCE = 0.3       # recommended playlist label: share of its artists that are core artists of the genre
REC_RELATIVE_COHERENCE = 0.5  # ...and the seed genre must reach half the share of the best-matching genre

class PlaylistDeduper:
    """
    Detects copied / re-saved / extended playlists: if >= 90% of the smaller playlist's videoIds
    appear in an already accepted playlist, it adds no independent curation signal.
    """
    def __init__(self):
        self.sizes: List[int] = []
        self.index: Dict[str, List[int]] = defaultdict(list)

    def is_duplicate(self, track_ids: Set[str]) -> bool:
        overlap = Counter()
        for vid in track_ids:
            for k in self.index.get(vid, ()):
                overlap[k] += 1
        n = len(track_ids)
        return any(c / min(n, self.sizes[k]) >= DUPLICATE_OVERLAP for k, c in overlap.items())

    def add(self, track_ids: Set[str]):
        k = len(self.sizes)
        self.sizes.append(len(track_ids))
        for vid in track_ids:
            self.index[vid].append(k)

def playlist_track_ids(pl: Dict) -> Set[str]:
    return {t["videoId"] for t in pl.get("tracks", []) if t.get("videoId")}

def normalize_artist_id(name: str, channel_id: Optional[str] = None) -> str:
    """Creates a deterministic, unique identifier for an artist."""
    if channel_id and channel_id.strip() and channel_id.startswith("UC"):
        return f"yt_{channel_id.strip()}"
    clean = name.strip().lower()
    return f"name_{hashlib.md5(clean.encode('utf-8')).hexdigest()[:12]}"

def is_system_or_algorithmic_playlist(title: str, author_name: str, author_id: str, browse_id: str) -> bool:
    """Rejects algorithmic, auto-generated, system, or 'Sound of' playlists."""
    t_clean = (title or "").lower().strip()
    a_clean = (author_name or "").lower().strip()
    b_clean = (browse_id or "").strip()

    # Algorithmic shelf mixes start with RDCLAK
    if b_clean.startswith("RDCLAK") or "rdclak" in b_clean.lower():
        return True
    if a_clean in SYSTEM_AUTHORS:
        return True
    if any(token in b_clean.lower() for token in DISALLOWED_TOKENS):
        return True
    if any(token in t_clean for token in DISALLOWED_TOKENS):
        return True
    for pattern in DISALLOWED_TITLE_PATTERNS:
        if pattern.search(t_clean):
            return True
    return False

def analyze_uploader_channels(raw_tracks: List[Dict]) -> Set[str]:
    """
    Intra-Playlist Multi-Prefix Principle:
    Analyzes all tracks in a playlist to detect uploader/curator channels.
    If a channel uploads tracks with >= 2 distinct title prefixes ('Artist - Title')
    that do not match the channel's own name, that channel is 100% an uploader channel.
    """
    channel_prefixes = defaultdict(set)
    for t in raw_tracks:
        artists_list = t.get("artists") or []
        channel_name = artists_list[0].get("name", "").strip().lower() if artists_list and isinstance(artists_list[0], dict) else ""
        title = t.get("title") or ""
        if " - " in title and channel_name:
            prefix = title.split(" - ")[0].strip().lower()
            if prefix and prefix != channel_name:
                channel_prefixes[channel_name].add(prefix)

    uploader_channels = set()
    for ch, prefixes in channel_prefixes.items():
        if len(prefixes) >= 2:
            uploader_channels.add(ch)
    return uploader_channels

def extract_track_artist(track: Dict, uploader_channels: Set[str]) -> Tuple[str, Optional[str]]:
    """
    Extracts the authentic candidate artist name and channel ID from a track.
    If the uploader is a detected curator/label, extracts the true artist from the title prefix.
    """
    artists_list = track.get("artists") or []
    primary_channel_name = artists_list[0].get("name", "").strip() if artists_list else ""
    channel_id = artists_list[0].get("id") if artists_list else None
    title = track.get("title") or ""

    clean_ch = primary_channel_name.lower().strip()
    if clean_ch in uploader_channels and " - " in title:
        prefix = title_sides(title)[0]
        if len(prefix) > 1:
            return sanitize_artist_name(prefix), None

    if primary_channel_name:
        return sanitize_artist_name(primary_channel_name), channel_id

    return "", None

def title_sides(title: str) -> Tuple[str, str]:
    """Both sides of an 'X - Y' upload title: numbering stripped from X, trailing notes ('(Cover)', '| ...') from Y."""
    left, right = title.split(" - ", 1)
    # Clean prefix from numbering like '01. Artist' or '01 - Artist'
    left = re.sub(r"^\d+[\.\-_–—]+\s*", "", left.strip()).strip()
    right = re.split(r"\s+[-|/]+\s+|\s*[\(\[【]", right, maxsplit=1)[0].strip()
    return left, right

def song_key(title: str) -> str:
    """Song title without bracketed notes or featured artists, for matching uploads against official releases."""
    title = re.split(r"\s*[\(\[【]|\s+(?:ft\.?|feat\.?)\s+", title, maxsplit=1, flags=re.I)[0]
    return unicodedata.normalize("NFKC", title).strip().lower()

def verify_title_credits(playlists: List[Dict]) -> int:
    """
    Title-derived credits (re-upload channels name no artist channel) are kept only when backed by official artist
    channels in the harvest: first an official release of the named song ('Artist - Song', then 'Song - Artist (Cover)'),
    otherwise the usual 'Artist - Song' order when the whole left side is an official artist and the right side is not.
    Collaborations ('A & B - Song') are credited to their first artist that released the song. Otherwise the track keeps no
    artist credit, so song or franchise names are never mistaken for artists. Returns the number of changed credits.
    """
    official_tracks = [t for p in playlists for t in p["tracks"] if t.get("channel_id")]
    official = {t["artist_name"].lower() for t in official_tracks}
    released = {(t["artist_name"].lower(), song_key(t.get("title") or "")) for t in official_tracks}

    def names(side: str) -> List[str]:
        parts = [side] + re.split(r"\s*(?:&|,|\bx\b|\bfeat\.?|\bft\.?)\s*", side, flags=re.I)
        return [n for n in (sanitize_artist_name(p) for p in parts) if n]

    def credit(artist_side: str, song_side: str) -> str:
        song = song_key(song_side)
        return next((n for n in names(artist_side) if (n.lower(), song) in released), "")

    def credit_left(left: str, right: str) -> str:
        name = sanitize_artist_name(left) or ""
        if name.lower() not in official or any(n.lower() in official for n in names(right)):
            return ""
        return name

    changed = 0
    for p in playlists:
        for t in p["tracks"]:
            title = t.get("title") or ""
            if t.get("channel_id") or not t.get("artist_name") or " - " not in title:
                continue
            left, right = title_sides(title)
            if t["artist_name"] != sanitize_artist_name(left):
                continue  # credited by a channel name, not by the title
            name = credit(left, right) or credit(right, left) or credit_left(left, right)
            if name != t["artist_name"]:
                t["artist_name"] = name
                t["artist_id"] = normalize_artist_id(name) if name else ""
                changed += 1
    return changed

DISALLOWED_TRACK_PATTERNS = [
    re.compile(r"\bplaylist\b", re.IGNORECASE),
    re.compile(r"\bcompilation\b", re.IGNORECASE),
    re.compile(r"\b\d+\s*hours?\b", re.IGNORECASE),
    re.compile(r"\b\d+\s*hrs?\b", re.IGNORECASE),
    re.compile(r"\bfull album\b", re.IGNORECASE),
    re.compile(r"\bbest of 20\d\d\b", re.IGNORECASE),
    re.compile(r"\btop \d+ songs\b", re.IGNORECASE),
    re.compile(r"\bcontinuous mix\b", re.IGNORECASE),
    re.compile(r"\bdj mix\b", re.IGNORECASE),
    re.compile(r"\bdj set\b", re.IGNORECASE),
    re.compile(r"\bnonstop\b", re.IGNORECASE),
]

def parse_duration_to_seconds(dur_str: str) -> int:
    """Parses 'MM:SS' or 'HH:MM:SS' to seconds."""
    if not dur_str:
        return 0
    parts = dur_str.strip().split(":")
    try:
        if len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
        elif len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    except Exception:
        return 0
    return 0

def is_catalog_qualified(track: Dict) -> bool:
    """
    Strict Catalog Release Qualification Guard:
    Verifies that a track is an authentic, official catalog release,
    preventing 15m/1h/2h DJ mixes, video loops, and raw UGC uploads
    (which lack 'Recommended playlists' shelves) from being chosen as anchor songs.
    """
    title = track.get("title") or ""
    for pat in DISALLOWED_TRACK_PATTERNS:
        if pat.search(title):
            return False

    dur_sec = track.get("duration_seconds")
    if not dur_sec and track.get("duration"):
        dur_sec = parse_duration_to_seconds(track.get("duration"))

    # Legitimate singles/tracks are between 30 seconds and 10 minutes (600s)
    if dur_sec is not None and dur_sec > 0:
        if dur_sec < 30 or dur_sec > 600:
            return False
        if dur_sec > 600 and re.search(r"\bmix\b", title, re.IGNORECASE):
            return False

    return True

def normalize_title(text: str) -> str:
    """Lowercase, strip accents and punctuation, pad with spaces for whole-phrase matching."""
    text = unicodedata.normalize("NFKD", (text or "").lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    return " " + re.sub(r"[\W_]+", " ", text).strip() + " "

def canonical_playlist_id(pid: str) -> str:
    """Search results use 'VL' browse IDs, shelves use bare playlist IDs; store one form."""
    return pid if pid.startswith("VL") else "VL" + pid

def parse_author(author: Any, browse_id: str) -> Tuple[str, str]:
    if isinstance(author, dict):
        name = author.get("name", "") or ""
        return name, author.get("id") or name or f"anon_{browse_id[:8]}"
    name = str(author or "")
    return name, name or f"anon_{browse_id[:8]}"

def playlist_artists(pl: Dict) -> Set[str]:
    return {t["artist_name"].lower().strip() for t in pl["tracks"] if t.get("artist_name")}

def parse_playlist(raw_pl: Dict, browse_id: str, genre: str, author_name: str, author_id: str) -> Optional[Dict]:
    """Validates track count, anti-discography, detects uploaders, and parses tracks."""
    title = raw_pl.get("title") or ""
    if is_system_or_algorithmic_playlist(title, author_name, author_id, browse_id):
        return None

    raw_tracks = raw_pl.get("tracks", [])
    if not (10 <= len(raw_tracks) <= 150):
        return None

    uploader_channels = analyze_uploader_channels(raw_tracks)

    parsed_tracks = []
    track_artist_names = []
    for t in raw_tracks:
        t_title = t.get("title") or ""
        if any(p.search(t_title) for p in DISALLOWED_TRACK_PATTERNS):
            continue
        dur_sec = t.get("duration_seconds")
        if not dur_sec and t.get("duration"):
            dur_sec = parse_duration_to_seconds(t.get("duration"))
        if dur_sec is not None and dur_sec > 600:
            continue

        clean_name, channel_id = extract_track_artist(t, uploader_channels)
        if not clean_name:
            continue
        canonical_id = normalize_artist_id(clean_name, channel_id)
        parsed_tracks.append({
            "videoId": t.get("videoId", ""),
            "title": t_title,
            "artist_name": clean_name,
            "artist_id": canonical_id,
            "channel_id": channel_id or "",
            "is_qualified": is_catalog_qualified(t),
            # Raw YouTube Music metadata kept for offline identity analysis (not used downstream yet)
            "video_type": t.get("videoType") or "",
            "artists": [[a.get("name") or "", a.get("id") or ""] for a in t.get("artists") or [] if isinstance(a, dict)]
        })
        track_artist_names.append(clean_name)

    if len(parsed_tracks) < 10:
        return None

    # Anti-discography guard: max artist share <= 50%
    freq = Counter(track_artist_names)
    if (max(freq.values()) / float(len(track_artist_names))) > 0.50:
        return None

    return {
        "id": browse_id,
        "title": title,
        "author": author_name,
        "author_id": author_id,
        "genre": genre,
        "tracks": parsed_tracks
    }

class GenreEvidence:
    """
    Genre statistics built from search-phase playlists only (recommendations never feed back).
    - Core artists of a genre: in >= 2 of its playlists.
    - Named playlists: the human-written title contains the genre name. They are the strongest
      evidence that an anchor actually defines the genre; without them, all search playlists are used.
    """
    def __init__(self, playlists: List[Dict]):
        self.size = Counter()
        self.named_size = Counter()
        self.counts: Dict[str, Counter] = defaultdict(Counter)        # genre -> artist -> playlists
        self.named_counts: Dict[str, Counter] = defaultdict(Counter)  # genre -> artist -> named playlists
        self.songs: Dict[str, Counter] = defaultdict(Counter)         # genre -> (artist, videoId) -> playlists
        self.named_songs: Dict[str, Counter] = defaultdict(Counter)   # genre -> (artist, videoId) -> named playlists
        for p in playlists:
            genre = p["genre"]
            named = normalize_title(genre) in normalize_title(p.get("title", ""))
            self.size[genre] += 1
            self.named_size[genre] += named
            for a in playlist_artists(p):
                self.counts[genre][a] += 1
                if named:
                    self.named_counts[genre][a] += 1
            for song in {(t["artist_name"].lower().strip(), t["videoId"]) for t in p["tracks"]
                         if t.get("artist_name") and t.get("videoId") and t.get("is_qualified", True)}:
                self.songs[genre][song] += 1
                if named:
                    self.named_songs[genre][song] += 1

        self.core_genres: Dict[str, Set[str]] = defaultdict(set)  # artist -> genres it is core to
        self.best_coverage: Dict[str, float] = defaultdict(float)  # artist -> max share of a genre's playlists
        for genre, counts in self.counts.items():
            for a, n in counts.items():
                if n >= 2:
                    self.core_genres[a].add(genre)
                    self.best_coverage[a] = max(self.best_coverage[a], n / self.size[genre])

    def anchors(self, genre: str, k: int) -> List[Tuple[str, str]]:
        """
        Verified (artist, videoId) anchors. An artist qualifies only if it
        (1) appears in >= 2 playlists titled with the genre name (or, when the genre has fewer than
            2 such playlists, in >= 2 of its search playlists), and
        (2) the genre is one of its strongest homes (big crossover artists whose identity lies elsewhere are excluded).
        Its song is the one most often included in those playlists.
        """
        named = self.named_size[genre] >= 2
        counts = self.named_counts[genre] if named else self.counts[genre]
        songs = self.named_songs[genre] if named else self.songs[genre]
        verified = [
            a for a, n in counts.items()
            if n >= 2 and self.counts[genre][a] / self.size[genre] >= ANCHOR_HOME_RATIO * self.best_coverage[a]
        ]
        verified.sort(key=lambda a: (-counts[a], -self.counts[genre][a], a))
        song_of: Dict[str, str] = {}
        for (a, vid), _ in sorted(songs.items(), key=lambda x: (-x[1], x[0])):
            song_of.setdefault(a, vid)
        return [(a, song_of[a]) for a in verified if a in song_of][:k]

    def label(self, artists: Set[str], seed_genre: str) -> str:
        """
        Genre label of a recommended playlist, judged by its content:
        the seed genre if enough of its artists are core to it and it is close to the best match,
        otherwise the best-matching genre if confident, otherwise unlabeled ("": counts for co-occurrence, adds no genre tag).
        """
        hits = Counter(g for a in artists for g in self.core_genres.get(a, ()))
        n = max(1, len(artists))
        best_genre, best = max(hits.items(), key=lambda x: (x[1], x[0]), default=("", 0))
        if hits[seed_genre] / n >= REC_MIN_COHERENCE and hits[seed_genre] >= REC_RELATIVE_COHERENCE * best:
            return seed_genre
        return best_genre if best / n >= REC_MIN_COHERENCE else ""

def load_checkpoint(deduper: PlaylistDeduper) -> Tuple[List[Dict], Counter, Set[str], Set[str], Set[str]]:
    """Loads existing harvesting state, sanitizing against algorithmic and copied/duplicate playlists."""
    if not os.path.exists(STATE_FILE) or not os.path.exists(PLAYLISTS_FILE):
        return [], Counter(), set(), set(), set()

    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            state = json.load(f)
        with open(PLAYLISTS_FILE, "r", encoding="utf-8") as f:
            raw_playlists = json.load(f)

        valid_playlists = []
        seen_authors = Counter()
        duplicates_dropped = 0

        for pl in raw_playlists:
            title = pl.get("title", "")
            author = pl.get("author", "")
            author_id = pl.get("author_id", "")
            browse_id = pl.get("id", "")
            tracks = pl.get("tracks", [])

            if is_system_or_algorithmic_playlist(title, author, author_id, browse_id):
                continue

            cleaned_tracks = []
            for t in tracks:
                t_title = t.get("title", "")
                if any(p.search(t_title) for p in DISALLOWED_TRACK_PATTERNS):
                    continue
                cleaned_tracks.append(t)

            if not (10 <= len(cleaned_tracks) <= 150):
                continue
            if author_id and seen_authors[author_id] >= 2 and author_id != "Community Curator":
                continue

            artist_names = [t.get("artist_name", "") for t in cleaned_tracks if t.get("artist_name")]
            freq = Counter(artist_names)
            if freq and (max(freq.values()) / float(len(artist_names))) > 0.50:
                continue

            pl["tracks"] = cleaned_tracks
            track_ids = playlist_track_ids(pl)
            if deduper.is_duplicate(track_ids):
                duplicates_dropped += 1
                continue
            deduper.add(track_ids)

            if author_id and author_id != "Community Curator":
                seen_authors[author_id] += 1
            valid_playlists.append(pl)

        seen_authors.pop("Community Curator", None)
        searched = set(state.get("searched_genres", []))
        expanded = set(state.get("expanded_genres", []))
        rejected = set(state.get("rejected_ids", []))
        print(f"Resuming from checkpoint: {len(searched)} genres searched, {len(expanded)} expanded, {len(valid_playlists)} valid community playlists retained ({duplicates_dropped} copied/duplicate playlists dropped).")
        return valid_playlists, seen_authors, searched, expanded, rejected
    except Exception as e:
        print(f"Checkpoint corrupted ({e}), starting fresh.")
        return [], Counter(), set(), set(), set()

def save_checkpoint(playlists: List[Dict], seen_authors: Counter, searched: Set[str], expanded: Set[str], rejected: Set[str]):
    """Atomically saves the harvesting state."""
    state = {
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "playlistsCount": len(playlists),
        "searched_genres": sorted(searched),
        "expanded_genres": sorted(expanded),
        "seen_authors": dict(seen_authors),
        "rejected_ids": sorted(rejected)
    }
    temp_state = STATE_FILE + ".tmp"
    with open(temp_state, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)
    os.replace(temp_state, STATE_FILE)

    temp_pl = PLAYLISTS_FILE + ".tmp"
    with open(temp_pl, "w", encoding="utf-8") as f:
        json.dump(playlists, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(temp_pl, PLAYLISTS_FILE)

class Harvester:
    """Rate-limited YouTube Music client plus the shared acceptance state (curator cap, dedupe, IDs)."""

    def __init__(self, rate_limit: float, playlists: List[Dict], seen_authors: Counter, deduper: PlaylistDeduper, rejected: Set[str]):
        self.yt = YTMusic()  # unauthenticated: results are never personalized to an account
        self.min_interval = 1.0 / max(0.5, rate_limit)
        self.last_req_time = 0.0
        self.playlists = playlists
        self.seen_authors = seen_authors
        self.deduper = deduper
        self.playlist_ids = {p["id"] for p in playlists}
        self.genre_counts = Counter(p["genre"] for p in playlists)
        # Recommended playlists found through each genre's anchors (they count toward that genre's budget)
        self.seeded = Counter(p["seed_genre"] for p in playlists if p["source"] == "recommended")
        # Playlists that failed genre-independent validation; never re-fetched for later genres or runs
        self.rejected = rejected

    def call(self, fn, *args, **kwargs):
        """Paced API call: long exponential backoff on rate limits, one quick retry on other transient errors."""
        for attempt in range(3):
            elapsed = time.time() - self.last_req_time
            needed = self.min_interval + random.uniform(0.1, 0.25) - elapsed
            if needed > 0:
                time.sleep(needed)
            self.last_req_time = time.time()
            try:
                return fn(*args, **kwargs)
            except Exception as e:
                err = str(e).lower()
                if "429" in err or "quota" in err or "rate" in err:
                    time.sleep(10.0 * (2 ** attempt) + random.uniform(1.0, 3.0))
                elif attempt >= 1 or isinstance(e, KeyError):
                    # KeyError: the page has no such section (e.g. a song without a related tab); retrying cannot help
                    return None
                else:
                    time.sleep(1.0)
        return None

    def screen(self, bid: str, genre: str, author_hint: Any = None) -> Optional[Tuple[Dict, Set[str], str]]:
        """Fetches and validates a playlist (curator cap, filters, copy guard). Genre relevance is checked by callers."""
        if bid in self.playlist_ids or bid in self.rejected:
            return None
        if author_hint is not None:
            _, author_id = parse_author(author_hint, bid)
            if self.seen_authors[author_id] >= 2:
                return None
        raw = self.call(self.yt.get_playlist, bid, limit=150)
        if not raw:
            return None
        author_name, author_id = parse_author(author_hint if author_hint is not None else raw.get("author"), bid)
        if self.seen_authors[author_id] >= 2:
            return None
        pl = parse_playlist(raw, bid, genre, author_name, author_id)
        if not pl:
            self.rejected.add(bid)
            return None
        track_ids = playlist_track_ids(pl)
        if self.deduper.is_duplicate(track_ids):
            self.rejected.add(bid)
            return None
        return pl, track_ids, author_id

    def accept(self, pl: Dict, track_ids: Set[str], author_id: str, source: str):
        pl["source"] = source
        self.seen_authors[author_id] += 1
        self.playlist_ids.add(pl["id"])
        self.deduper.add(track_ids)
        self.playlists.append(pl)
        self.genre_counts[pl["genre"]] += 1

    def search_genre(self, g_info: Dict, limit: int):
        """Phase 1: multi-query name search with a consensus coherence gate."""
        genre = g_info["genre"]
        queries = [
            g_info.get("primary_query") or f"{genre} playlist",
            g_info.get("secondary_query") or f"{genre} mix",
            g_info.get("tertiary_query") or f"best of {genre}",
            f"{genre} songs"
        ]
        candidates = []
        seen_cand_ids = set()
        for q in queries:
            if len(candidates) >= 35:
                break
            for item in self.call(self.yt.search, q, filter="community_playlists", limit=20) or []:
                bid = item.get("browseId")
                if bid and bid not in seen_cand_ids and bid not in self.playlist_ids:
                    candidates.append(item)
                    seen_cand_ids.add(bid)

        pool = []
        pool_deduper = PlaylistDeduper()
        for cand in candidates:
            if len(pool) >= 30:
                break
            screened = self.screen(cand["browseId"], genre, cand.get("author") or {})
            if not screened:
                continue
            pl, track_ids, author_id = screened
            # Copies within this candidate pool would otherwise inflate the consensus gate
            if pool_deduper.is_duplicate(track_ids):
                continue
            pool_deduper.add(track_ids)
            pool.append((pl, track_ids, author_id, playlist_artists(pl)))

        # Consensus artists: appeared in >= 2 candidate playlists
        art_freq = Counter(a for *_, arts in pool for a in arts)
        consensus = {a for a, c in art_freq.items() if c >= 2}
        if consensus:
            scored = [(len(item[3] & consensus), item) for item in pool if item[3] & consensus]
        else:
            # Rare genre with no consensus yet: retain all valid candidates
            scored = [(0, item) for item in pool]
        scored.sort(key=lambda x: x[0], reverse=True)

        for _, (pl, track_ids, author_id, _) in scored:
            if self.genre_counts[genre] >= limit:
                break
            if self.seen_authors[author_id] >= 2 or pl["id"] in self.playlist_ids:
                continue
            self.accept(pl, track_ids, author_id, "search")

    def recommended_playlist_ids(self, video_id: str) -> List[str]:
        """User playlists on a song's 'Recommended playlists' shelf (PL IDs only: no albums or YouTube mixes)."""
        watch = self.call(self.yt.get_watch_playlist, videoId=video_id, limit=5)
        token = (watch or {}).get("related")
        if not token:
            return []
        ids = []
        for shelf in self.call(self.yt.get_song_related, token) or []:
            if not isinstance(shelf, dict) or "playlist" not in (shelf.get("title") or "").lower():
                continue
            for item in shelf.get("contents") or []:
                pid = (item.get("playlistId") or item.get("browseId") or "") if isinstance(item, dict) else ""
                pid = canonical_playlist_id(pid) if pid else ""
                if pid.startswith("VLPL") and pid not in ids:
                    ids.append(pid)
        return ids

    def expand_genre(self, genre: str, evidence: GenreEvidence, target: int, max_anchors: int):
        """
        Phase 2: recommended playlists of verified anchor songs. Every genre gets the same budget:
        its search playlists plus the playlists found through its anchors stop at `target`.
        Every valid playlist is kept as co-occurrence evidence; its genre label comes from its content.
        """
        budget = target - evidence.size[genre] - self.seeded[genre]
        tried: Set[str] = set()
        for _, video_id in evidence.anchors(genre, max_anchors):
            if budget <= 0:
                return
            for bid in self.recommended_playlist_ids(video_id):
                if budget <= 0:
                    return
                if bid in tried:
                    continue
                tried.add(bid)
                screened = self.screen(bid, genre)
                if not screened:
                    continue
                pl, track_ids, author_id = screened
                pl["genre"] = evidence.label(playlist_artists(pl), genre)
                pl["seed_genre"] = genre
                self.accept(pl, track_ids, author_id, "recommended")
                self.seeded[genre] += 1
                budget -= 1

def main():
    parser = argparse.ArgumentParser(description="Stage 1: Authentic Multi-Subgenre Community Playlist Harvesting.")
    parser.add_argument("--limit-genres", type=int, default=None, help="Limit number of genres to crawl")
    parser.add_argument("--target-playlists", type=int, default=20, help="Target qualifying playlists per genre (default: 20)")
    parser.add_argument("--tier1-limit", type=int, default=20, help="Max playlists from direct search (default: 20)")
    parser.add_argument("--max-anchors", type=int, default=8, help="Max verified anchor songs per genre for recommendation discovery (default: 8)")
    parser.add_argument("--rate-limit", type=float, default=3.0, help="Max requests per second for YTM (default: 3.0)")
    parser.add_argument("--fresh", action="store_true", help="Start fresh without loading existing checkpoint")
    parser.add_argument("--reverse", action="store_true", help="Process genres in reverse rank order (niche/underground genres first)")
    parser.add_argument("--revisit", action="store_true", help="Re-run both phases for checkpointed genres still below --target-playlists")
    args = parser.parse_args()

    if not os.path.exists(GENRES_FILE):
        raise FileNotFoundError(f"Missing {GENRES_FILE}. Please run 00_harvest_genres.py first.")

    with open(GENRES_FILE, "r", encoding="utf-8") as f:
        genres_data = json.load(f)

    if args.reverse:
        genres_data = list(reversed(genres_data))
        print("Reverse order active: Harvesting from deepest niche/underground subgenres backward.")

    if args.limit_genres:
        genres_data = genres_data[:args.limit_genres]

    search_limit = min(args.tier1_limit, args.target_playlists)
    print("=" * 70)
    print(f" STAGE 1: AUTHENTIC COMMUNITY PLAYLIST HARVESTING ({len(genres_data)} genres queued)")
    print(f" Target: {args.target_playlists} qualifying community playlists per subgenre")
    print(f" Phase 1: Name search (up to {search_limit}) for every genre")
    print(f" Phase 2: Recommended playlists of verified anchor songs, filling up to {args.target_playlists}")
    print(f" Equal Analysis: Every subgenre processed through identical quality pipeline")
    print("=" * 70)
    start_time = time.time()

    deduper = PlaylistDeduper()
    if args.fresh:
        playlists, seen_authors, searched, expanded, rejected = [], Counter(), set(), set(), set()
        for fpath in [STATE_FILE, PLAYLISTS_FILE]:
            if os.path.exists(fpath):
                try:
                    os.remove(fpath)
                except Exception:
                    pass
        print("Fresh run requested: Cleared previous checkpoints.")
    else:
        playlists, seen_authors, searched, expanded, rejected = load_checkpoint(deduper)

    harvester = Harvester(args.rate_limit, playlists, seen_authors, deduper, rejected)
    if args.revisit:
        # Same criterion for every genre: search playlists plus recommended playlists found through it
        found = Counter(p["genre"] for p in playlists if p["source"] == "search") + harvester.seeded
        under = {g["genre"] for g in genres_data if found[g["genre"]] < args.target_playlists}
        searched -= under
        expanded -= under
        print(f"Revisit: {len(under)} genres below {args.target_playlists} playlists queued again.")
    last_checkpoint_time = time.time()

    def maybe_checkpoint():
        nonlocal last_checkpoint_time
        if time.time() - last_checkpoint_time >= CHECKPOINT_INTERVAL_SEC:
            save_checkpoint(playlists, seen_authors, searched, expanded, rejected)
            last_checkpoint_time = time.time()

    pbar = tqdm(genres_data, desc="Phase 1 (search)", unit="genre")
    for g_info in pbar:
        genre = g_info["genre"]
        if genre in searched:
            continue
        pbar.set_postfix({"genre": genre[:16], "total_pl": len(playlists)})
        if harvester.genre_counts[genre] < search_limit:
            harvester.search_genre(g_info, search_limit)
        searched.add(genre)
        maybe_checkpoint()

    # Anchors and coherence are judged against search results only, so recommendations never feed back
    evidence = GenreEvidence([p for p in playlists if p["source"] == "search"])
    pbar = tqdm(genres_data, desc="Phase 2 (recommended)", unit="genre")
    for g_info in pbar:
        genre = g_info["genre"]
        if genre in expanded:
            continue
        pbar.set_postfix({"genre": genre[:16], "total_pl": len(playlists)})
        harvester.expand_genre(genre, evidence, args.target_playlists, args.max_anchors)
        expanded.add(genre)
        maybe_checkpoint()

    print(f"Title-derived artist credits revised: {verify_title_credits(playlists)}")
    save_checkpoint(playlists, seen_authors, searched, expanded, rejected)
    sources = Counter(p["source"] for p in playlists)
    print(f"\nStage 1 completed in {time.time() - start_time:.2f}s!")
    unlabeled = sum(1 for p in playlists if not p["genre"])
    print(f"Total surviving authentic playlists: {len(playlists)} (search {sources['search']}, recommended {sources['recommended']}, unlabeled {unlabeled})")
    print("=" * 70)

if __name__ == "__main__":
    main()
