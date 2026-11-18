"""
Genre votes over search-playlist evidence, shared by Stage 1 (labels of related playlists) and Stage 2 (genre tags).
Every member of a playlist has one vote, split across the genres it is core to (it appears in >= 2 of the genre's
search playlists) in proportion to its share of each genre's search playlists: a member spread over dozens of genres
says little about any of them, so famous crossover artists cannot pull a playlist into a small genre.
Members are whatever identifies an artist for the caller: lowercased credited names in Stage 1, Deezer IDs in Stage 2.
"""

from collections import Counter, defaultdict
from typing import Dict, Hashable, Iterable, Optional, Set, Tuple

RELATED_MIN_SCORE = 0.15      # share of a playlist's member votes that go to the genre
RELATED_MARGIN = 1.5          # ...and the genre must beat every other genre by this factor
RELATED_MIN_ARTISTS = 5       # fewer members cannot say anything reliable about a genre

class GenreVotes:
    def __init__(self, search_playlists: Iterable[Tuple[str, Set[Hashable]]]):
        """search_playlists: (genre, members) of every labeled search-phase playlist."""
        self.size: Counter = Counter()                                       # genre -> search playlists
        self.artist_genres: Dict[Hashable, Counter] = defaultdict(Counter)  # member -> genre -> search playlists
        for genre, members in search_playlists:
            self.size[genre] += 1
            for a in members:
                self.artist_genres[a][genre] += 1

    def votes(self, artists: Set[Hashable], own_genre: Optional[str] = None) -> Counter:
        """Vote totals per genre. own_genre judges one of that genre's own search playlists as if it had not been harvested."""
        totals = Counter()
        for a in artists:
            shares = {}
            for g, n in self.artist_genres.get(a, {}).items():
                size = self.size[g]
                if g == own_genre:
                    n, size = n - 1, size - 1
                if n >= 2:
                    shares[g] = n / size
            total = sum(shares.values())
            for g, s in shares.items():
                totals[g] += s / total
        return totals

    def belongs(self, artists: Set[Hashable], genre: str, own: bool = False) -> float:
        """Share of a playlist's member votes that go to `genre`, or 0.0 unless the genre is its clear best match."""
        if len(artists) < RELATED_MIN_ARTISTS:
            return 0.0
        totals = self.votes(artists, genre if own else None)
        score = totals[genre] / len(artists)
        rival = max((v for g, v in totals.items() if g != genre), default=0.0) / len(artists)
        return score if score >= RELATED_MIN_SCORE and score >= RELATED_MARGIN * rival else 0.0

    def best(self, artists: Set[Hashable]) -> str:
        """The playlist's clear best-matching genre, or "" when no genre is a clear match."""
        if len(artists) < RELATED_MIN_ARTISTS:
            return ""
        totals = self.votes(artists)
        ranked = sorted(totals.items(), key=lambda x: (-x[1], x[0]))
        if not ranked:
            return ""
        genre, top = ranked[0]
        rival = ranked[1][1] if len(ranked) > 1 else 0.0
        return genre if top / len(artists) >= RELATED_MIN_SCORE and top >= RELATED_MARGIN * rival else ""
