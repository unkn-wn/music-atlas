"""
Artist genre tags: up to 3 EveryNoise genre names per artist, from human sources only. The five steps below are every
place a tag can come from or be removed; the functions of the same names follow in the same order.

Stage 2 (assign_tags): the first of steps 1-3 that yields a tag wins.
1. wikidata_tags: the artist's Wikidata genre statements (matched to EveryNoise names by wikidata.py), kept only when
   at least one harvested playlist labeled with that genre contains the artist. Ordered by those playlists, then
   EveryNoise popularity rank. Up to 3.
2. consensus_tags: playlist labels re-judged by member votes (judged_labels, genre_votes.py), ranked by lift
   (lift_ranking). Up to 3.
3. fallback_tags: the same lift ranking on the original harvest labels. Only the single best tag.
   An artist none of them tags has no tag (tagSource "none").
Stage 5 (check_with_neighbours), on the artist's 10 strongest drawn connections (connections.py):
4. neighbour_check: a Stage-2 tag stays when it is a Wikidata genre the artist's playlists confirm (confirmed_wikidata),
   or when one of those connections carries it as a Stage-2 tag. Any other tag is dropped.
5. wikidata_rescue: an artist left with no tag takes its Wikidata genres that those connections carry, failing that
   its Wikidata genres as stated, even without playlist support (the one place that requirement is waived: these are
   human statements about the artist itself).
Nothing else assigns a genre: an artist with none of this evidence is never given one from its continent or neighbours.

Lift (steps 2 and 3) is computed on the artist x genre table of independent playlist neighbourhoods (playlists related
to the same anchor count once): lift = c * N / (n_artist * n_genre), where c counts the neighbourhoods in which the
artist appears under that genre label and N, n_artist, n_genre are the table's total, row and column sums. A genre is eligible when c >= 2 and c >= 10% of the artist's best-supported
genre's c (two playlists of a tiny genre cannot outrank dozens of a real one), and is tagged when its lift is >= 1 and
>= half the artist's best eligible lift.
"""

from collections import Counter, defaultdict
from typing import Dict, List, Optional, Set, Tuple

from genre_votes import GenreVotes
from sanitizer import split_artist_names

MAX_TAGS = 3             # tags per artist (steps 1, 2 and 5)
FALLBACK_TAGS = 1        # step 3 tags only its single best genre
MIN_UNITS = 2            # independent playlist neighbourhoods behind a lift-ranked tag (steps 2 and 3)
UNIT_FLOOR = 0.10        # ...and at least this share of those behind the artist's best-supported genre
MIN_LIFT = 1.0           # the artist must be over-represented in the genre (steps 2 and 3, and confirmed_wikidata)
RELATIVE_LIFT = 0.5      # secondary tags need half the artist's best lift (steps 2 and 3)
NEIGHBOUR_CHECK_K = 10   # strongest drawn connections consulted by steps 4 and 5
UNRANKED = 9999          # EveryNoise rank given to a genre missing from the ranking, so it sorts last

# Display casing of genre-name words that are acronyms; every other word is title-cased
ACRONYMS = {"r&b": "R&B", "ccm": "CCM", "edm": "EDM", "k-pop": "K-Pop", "j-pop": "J-Pop", "j-rock": "J-Rock", "ost": "OST",
            "uk": "UK", "idm": "IDM", "opm": "OPM", "mpb": "MPB", "nz": "NZ", "v-pop": "V-Pop"}

LiftTable = Dict[str, Dict[str, Tuple[int, float]]]  # artist -> genre -> (independent neighbourhoods, lift)

def display_name(genre: str) -> str:
    """A raw EveryNoise genre name as shown and stored in the catalog."""
    return " ".join(ACRONYMS.get(p.lower(), p.title()) for p in (genre or "").strip().split())

def display_names(genres: List[str]) -> List[str]:
    """Display names in order, without the duplicates display casing can create."""
    return list(dict.fromkeys(display_name(g) for g in genres))

def playlist_unit(pl: Dict, idx: int) -> str:
    """Independent neighbourhood of a playlist: related playlists of one anchor share it (Stages 2 and 3 count by it too)."""
    return pl.get("anchor_id") or pl.get("id") or str(idx)

def artist_keys(catalog: List[Dict]) -> Dict[Tuple[str, Optional[str]], str]:
    """
    (lowercased credited name, YouTube channel ID) -> Deezer ID, the one identity map of Stages 2 (tags) and 3
    (connections). Harvested tracks carry YouTube names and channels, never Deezer IDs, so the link is the credit
    Stage 2 verified (the catalog's credits): channel None stands for the name under any channel (only one YouTube
    artist uses it), "" for the name's credits without a channel. An artist's Deezer name is a key only when no
    verified credit uses that name and no other artist has the same Deezer name.
    """
    keys = {(name, channel): a["id"] for a in catalog for name, channel in a["credits"]}
    verified_names = {name for name, _ in keys}
    deezer_names: Dict[str, Set[str]] = defaultdict(set)
    for a in catalog:
        deezer_names[a["name"].lower().strip()].add(a["id"])
    for name, ids in deezer_names.items():
        if len(ids) == 1 and name not in verified_names:
            keys[(name, None)] = next(iter(ids))
    return keys

def playlist_members(pl: Dict, keys: Dict[Tuple[str, Optional[str]], str]) -> Set[str]:
    """
    Deezer IDs of the catalog artists a playlist credits: by the whole credited name and its channel, else by its
    collaboration parts, which have no channel of their own.
    """
    members = set()
    for t in pl.get("tracks", []):
        raw_name = t.get("artist_name", "")
        name = raw_name.lower().strip()
        aid = keys.get((name, t.get("channel_id") or "")) or keys.get((name, None))
        if aid:
            members.add(aid)
        else:
            parts = (s.lower().strip() for s in split_artist_names(raw_name))
            members.update(a for a in (keys.get((k, "")) or keys.get((k, None)) for k in parts if k != name) if a)
    return members

def lift_table(labels: List[str], units: List[str], members: List[Set[str]]) -> LiftTable:
    """Per artist and genre label: the independent neighbourhoods in which the artist appears under it, and its lift."""
    table: Dict[str, Dict[str, Set[str]]] = defaultdict(lambda: defaultdict(set))
    for genre, unit, m in zip(labels, units, members):
        if genre:
            for a in m:
                table[a][genre].add(unit)
    n_artist = {a: sum(len(u) for u in genres.values()) for a, genres in table.items()}
    n_genre = Counter()
    for genres in table.values():
        for g, u in genres.items():
            n_genre[g] += len(u)
    total = sum(n_genre.values())
    return {a: {g: (len(u), len(u) * total / (n_artist[a] * n_genre[g])) for g, u in genres.items()} for a, genres in table.items()}

def lift_ranking(lifts: LiftTable) -> Dict[str, List[str]]:
    """Per artist, the genres that pass the lift rule (module docstring), strongest lift first."""
    ranking = {}
    for a, genres in lifts.items():
        min_units = max(MIN_UNITS, UNIT_FLOOR * max(c for c, _ in genres.values()))
        scored = sorted(((lift, c, g) for g, (c, lift) in genres.items() if c >= min_units), reverse=True)
        if scored:
            top = scored[0][0]
            ranking[a] = [g for lift, _, g in scored if lift >= MIN_LIFT and lift >= RELATIVE_LIFT * top]
    return ranking

def judged_labels(playlists: List[Dict], members: List[Set[str]]) -> List[str]:
    """
    Each playlist's label re-judged by member votes over the search playlists: a search playlist keeps its genre only
    if its artists clearly belong to it (judged as if it had not been harvested), a recommended playlist takes its
    clear best-voted genre or none, and a related playlist keeps its label (Stage 1 gave it by the same vote test).
    """
    votes = GenreVotes((pl["genre"], m) for pl, m in zip(playlists, members) if pl.get("source") == "search" and pl.get("genre"))
    labels = []
    for pl, m in zip(playlists, members):
        genre = pl.get("genre") or ""
        if pl.get("source") == "search":
            labels.append(genre if genre and votes.belongs(m, genre, own=True) else "")
        elif pl.get("source") == "recommended":
            labels.append(votes.best(m))
        else:
            labels.append(genre)
    return labels

def wikidata_tags(stated: List[str], carrying: Counter) -> List[str]:
    """Step 1: the artist's stated Wikidata genres that at least one of its harvested playlists is labeled with."""
    return [g for g in stated if carrying[g] >= 1]

def consensus_tags(playlists: List[Dict], members: List[Set[str]], units: List[str]) -> Dict[str, List[str]]:
    """Step 2: per artist, the lift ranking on vote-judged labels, which keep only playlists whose artists fit them."""
    return lift_ranking(lift_table(judged_labels(playlists, members), units, members))

def fallback_tags(harvest_lifts: LiftTable) -> Dict[str, List[str]]:
    """Step 3: per artist, the lift ranking on the original harvest labels, for artists the vote-judged labels miss."""
    return lift_ranking(harvest_lifts)

def confirmed_wikidata(stated: List[str], lifts: Dict[str, Tuple[int, float]]) -> List[str]:
    """Stated Wikidata genres the artist's harvested playlists over-represent it in (lift >= 1); step 4 keeps these."""
    return sorted({display_name(g) for g in stated if lifts.get(g, (0, 0.0))[1] >= MIN_LIFT})

def assign_tags(playlists: List[Dict], members: List[Set[str]], wikidata_genres: Dict[str, Set[str]],
                genre_ranks: Dict[str, int]) -> Dict[str, Dict]:
    """
    Stage 2: steps 1-3 for every artist that is a playlist member or has Wikidata genres.
    playlists: harvested playlists; members: their member Deezer IDs (same order); wikidata_genres: artist -> raw
    EveryNoise genre names from its Wikidata statements. Returns artist -> catalog fields {topSubgenres, tagSource,
    wikidataGenres (all stated genres, by playlists carrying them, then EveryNoise rank), wikidataConfirmed}.
    """
    harvest_labels = [pl.get("genre") or "" for pl in playlists]
    units = [playlist_unit(pl, i) for i, pl in enumerate(playlists)]
    harvest_lifts = lift_table(harvest_labels, units, members)
    consensus = consensus_tags(playlists, members, units)
    fallback = fallback_tags(harvest_lifts)
    carrying: Dict[str, Counter] = defaultdict(Counter)  # artist -> genre -> harvested playlists labeled with it
    for genre, m in zip(harvest_labels, members):
        if genre:
            for a in m:
                carrying[a][genre] += 1

    out = {}
    for a in set().union(*members) | set(wikidata_genres):
        stated = sorted(wikidata_genres.get(a, set()), key=lambda g: (-carrying[a][g], genre_ranks.get(g, UNRANKED), g))
        steps = [("wikidata", wikidata_tags(stated, carrying[a]), MAX_TAGS),
                 ("playlists", consensus.get(a), MAX_TAGS),
                 ("fallback", fallback.get(a), FALLBACK_TAGS)]
        source, raw, limit = next((step for step in steps if step[1]), ("none", [], 0))
        out[a] = {
            "topSubgenres": display_names(raw)[:limit],
            "tagSource": source,
            "wikidataGenres": display_names(stated),
            "wikidataConfirmed": confirmed_wikidata(stated, harvest_lifts.get(a, {})),
        }
    return out

def neighbour_check(tags: List[str], confirmed: List[str], carried: Counter) -> List[str]:
    """Step 4: keeps the Stage-2 tags that are confirmed Wikidata genres or that a strongest connection carries."""
    return [t for t in tags if t in confirmed or carried[t] >= 1]

def wikidata_rescue(stated: List[str], carried: Counter) -> List[str]:
    """
    Step 5, for an artist step 4 left without a tag: its stated Wikidata genres that its strongest connections carry
    (most carried first, then name), failing that its stated genres in catalog order (playlists carrying them, then
    EveryNoise rank).
    """
    held = sorted((g for g in stated if carried[g] >= 1), key=lambda g: (-carried[g], g))
    return held[:MAX_TAGS] or stated[:MAX_TAGS]

def check_with_neighbours(stage2: Dict[str, Dict], strongest: Dict[str, List[str]]) -> Dict[str, List[str]]:
    """
    Stage 5: steps 4-5 for every artist in stage2 (artist -> its Stage-2 catalog fields), with strongest: artist -> its
    strongest drawn connections. Connections are judged on their unchecked Stage-2 tags, so the result does not
    depend on processing order. Returns artist -> final tags.
    """
    final = {}
    for a, fields in stage2.items():
        carried = Counter(t for n in strongest.get(a, [])[:NEIGHBOUR_CHECK_K] if n in stage2 for t in stage2[n]["topSubgenres"])
        final[a] = (neighbour_check(fields["topSubgenres"], fields["wikidataConfirmed"], carried)
                    or wikidata_rescue(fields["wikidataGenres"], carried))
    return final
