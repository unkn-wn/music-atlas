# AGENTS.md — Music Atlas Autonomous Architecture & Engineering Rules

> **CRITICAL DIRECTIVE**:
> Do not consider backwards compatibility. All unused, outdated, legacy, or deprecated files, functions, and code should be removed completely.

- Example: You are rewriting a function to update the logic for graphing onto the canvas. Instead of moving old code under a separate prop, and passing this prop to the python harness, you should delete the old function and rewrite the new function.

---

## 1. Project Overview & Core Philosophy

Music Atlas is an interactive, authentic galaxy visualization of the global music landscape built with Python data pipelines and a Cosmograph frontend.

The entire universe is built on **one cardinal rule**:
**Every node, edge, genre tag, and metric must emerge organically from authentic, real-world data created by real human users.**

---

## 2. Universal Engineering Rules (NON-NEGOTIABLE)

### A. Zero "The Sound of [genre]" & Zero Spotify Embeds

- **NEVER** scrape or ingest "The Sound of [genre]" playlists or Spotify embed playlists (`embed.spotify.com`, `everynoise1d` spotify links, or `engenremap` HTML divs).
- These playlists are outdated, auto-generated, and do not represent human curation.
- All playlist harvesting must query real, public, user-created community playlists from YouTube Music.
- Spotify's Million Playlist Dataset is also not allowed, as playlists are outdated and from 2018.

### B. Strictly ZERO Hardcoding or Artificial Data Injection

- **NEVER** hardcode artist names into the pipeline or frontend.
- **NEVER** create artificial override lists, whitelist conditions, or special-case hacks for specific artists or genres.
- **NEVER** hardcode the genre names or normalize genre categories. Continent macro-labels emerge dynamically from Louvain modularity clustering consensus over member artists' genre tags, and artist catalog verification comes directly from Deezer. Artist genre tags (up to 3 EveryNoise genre names) come from human sources, in order: the artist's Wikidata genre statements (found by Deezer artist ID, matched to EveryNoise names exactly by label or alias, and kept only when the artist's harvested playlists also carry that genre), otherwise playlist consensus (labels re-judged by member votes, $\ge 2$ independent playlists and at least 10% of those behind the artist's best-supported genre, scored by the artist's over-representation in the genre), otherwise the single best-scoring genre of its playlists' original harvest labels. A tag is then kept only if it is one of the artist's Wikidata genres that its playlists over-represent it in, or one of its 10 strongest drawn connections carries it. An artist left with no tag takes its Wikidata genres even without playlist support — the only place the playlist requirement is waived, because they are human statements about that artist — keeping only those its connections carry when any do, otherwise all of them by playlist support, then EveryNoise popularity. An artist without such evidence has no genre: never fill one in from its continent, neighbours, or a default.
- If an artist is missing, the solution is **always** broader, higher-volume playlist harvesting, never hardcoded injection.
- Artists survive into the atlas if and only if they satisfy the mathematical survival criterion: appearing across $c_i \ge 4$ independent qualifying user playlists, and having at least one connection that rests on $\ge 2$ shared independent playlists. Connections that all rest on a single playlist are not evidence of a relationship.

### C. Equal Analysis Across ALL Subgenres (Zero Favoritism)

- Do **NOT** prioritize, isolate, or give special treatment to any subgenre (e.g., EDM, gaming music, hip hop, pop).
- All subgenres in the EveryNoise taxonomy must be crawled with equal depth, equal query limits, and the identical ingestion pipeline.

### D. Deep User-Created Community Playlist Harvesting

- For every subgenre being processed, the pipeline must query playlists created by real human curators.
- Use natural search queries: `"{genre} playlist"`, `"{genre} mix"`, `"best of {genre}"`.
- **System & Algorithmic Reject Filters:**
  - Reject system authors: `"YouTube Music"`, `"Spotify"`, `"Various Artists - Topic"`, `"YouTube"`, `"Music"`.
  - Reject algorithmic mixes: `"My Supermix"`, `"Supermix"`, `rdampl` playlists.
  - Reject discographies / artist albums: Discard playlists where any single artist accounts for $> 50\%$ of tracks.
  - Reject inappropriate sizes: Strictly require $10 \le \text{track count} \le 150$.
  - Global curator cap: Limit maximum 2 playlists from any single curator ID to prevent user bias.

---

## 3. Pipeline Architecture

The pipeline consists of clean, decoupled stages in `pipeline/`:

1. `00_harvest_genres.py`: Ingests popularity-ranked genre taxonomy from EveryNoise (names and ranks only; zero Spotify embeds).
2. `01_harvest_playlists.py`: Harvests 20+ user-created community playlists per subgenre via YouTube Music public searches, then expands through recommended-playlist shelves of verified anchor songs and related playlists of verified anchor playlists, followed by one second layer: related playlists of verified recommended and related playlists (same anchor budget for every genre). Second-layer playlists are marked `layer: 2` and are never used as anchors. Expansion playlists never inherit the seed genre: they are labeled from their own artists or left unlabeled. Applies strict Unicode sanitization, anti-discography filters, and curator caps.
3. `02_enrich_artists.py`: Filters artists by $c_i \ge 4$ (playlists related to the same anchor playlist count as one independent appearance), verifies them against Deezer (when two or more YouTube channels each reach $c_i \ge 4$ under one name, each channel is resolved by finding its own songs on Deezer, so different artists sharing a name are never merged by name alone), assigns genre tags (Wikidata statements supported by playlists, else playlist consensus, else one tag from the harvest labels; see `genre_tags.py`), resolves authentic listener counts via Deezer's API call confirmations, and attaches genuine audio previews.
4. `03_build_cooccurrence.py`: Builds the sparse co-occurrence matrix from shared playlist co-presence. A playlist's credits (name and YouTube channel) resolve to Deezer artist IDs through the same map as Stage 2's genre tags (`artist_keys` and `playlist_members` in `genre_tags.py`): the credits Stage 2 verified for an artist, never a second name lookup.
5. `04_normalize_and_sparsify.py`: Calculates Salton's cosine similarity and k-NN sparsification (strongest connections first, up to a degree bound of 4 to 24 that scales with the artist's playlist count, while every artist keeps its own top 4), drops artists none of whose kept connections rests on at least 2 shared independent playlists (playlists related to the same anchor count once; a corroborated pair too weak to be kept does not count), and bridges satellite components into the giant component or drops them.
6. `05_community_and_layout.py`: Louvain continental partitioning, the genre tag neighbour check (on the connections Stage 6 draws), and a two-level archipelago layout: continent centroids by spring layout, subgenre micro-centroids from each artist's first tag, vectorized spring physics, and overlap clearance.
7. `06_export_web_artifacts.py`: Exports compact `atlas-graph.json` directly to `web/public/data/atlas-graph.json`. It draws each artist's 6 strongest connections by playlist overlap, plus those where it is among the other artist's 6 and bridge edges; the artist drawer lists exactly these (`connections.py`).
8. `07_enrich_genres.py`: Attaches human-curated Wikidata facts (description, inception, Wikipedia link) to genres whose name exactly matches the English label, or failing that an alias, of exactly one Wikidata music-genre item (no hand mapping), writing `web/public/data/genre-info.json`. It reads the Wikidata genre index Stage 2 cached, so tags and genre facts share one snapshot.

Master Runner:

- `run_pipeline.py` at /pipeline/ coordinates the entire execution from start to finish.
