# AGENTS.md — Music Atlas Autonomous Architecture & Engineering Rules

> **CRITICAL DIRECTIVE**:
> Do not consider backwards compatibility. All unused, outdated, legacy, or deprecated files, functions, and code should be removed completely.

- Example: You are rewriting a function to update the logic for graphing onto the canvas. Instead of moving old code under a separate prop, and passing this prop to the python harness, you should delete the old function and rewrite the new function.

---

## 1. Project Overview & Core Philosophy

Music Atlas is an interactive, authentic galaxy visualization of the global music landscape built with Python data pipelines and a Sigma.js WebGL frontend.

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

- **NEVER** hardcode artist names (e.g. Creo, Teminite, Apashe, Drake, etc.) into the pipeline or frontend.
- **NEVER** create artificial override lists, whitelist conditions, or special-case hacks for specific artists or genres.
- **NEVER** hardcode the genre names or normalize genre categories. Genres should explicitly come from the apple itunes api's primaryGenre, which would be the continent label. Secondary genres will come from everysoundatonce subgenre when an artist is scraped.
- If an artist is missing, the solution is **always** broader, higher-volume playlist harvesting, never hardcoded injection.
- Artists survive into the atlas if and only if they satisfy the mathematical survival criterion: appearing across $c_i \ge 2$ independent qualifying user playlists.

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
2. `01_harvest_playlists.py`: Harvests 20+ user-created community playlists per subgenre via YouTube Music public searches. Applies strict Unicode sanitization, anti-discography filters, and curator caps.
3. `02_enrich_artists.py`: Filters artists by $c_i \ge 2$, computes IDF-weighted Top 3 Subgenres, resolves authentic subscriber counts via YouTube Official Artist Channels, and attaches genuine audio previews.
4. `03_build_cooccurrence.py`: Builds the sparse co-occurrence matrix from shared playlist co-presence.
5. `04_normalize_and_sparsify.py`: Calculates cosine similarity, Jaccard coefficients, and k-NN sparsification.
6. `05_community_and_layout.py`: Dynamic continental partitioning, gentle genre macro-initialization, strong-gravity ForceAtlas2 simulation, radial knee compression, and disk clearance.
7. `06_export_web_artifacts.py`: Exports compact `atlas-graph.json` with adaptive affinity connections (6 to 20 links) directly to `web/public/data/atlas-graph.json`.

Master Runner:

- `run_pipeline.py` at repository root coordinates the entire execution from start to finish.
