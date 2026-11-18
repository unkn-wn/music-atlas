# Music Atlas

An interactive, authentic WebGL galaxy visualization of the global music streaming landscape. Built with autonomous Python data pipelines and a high-performance Cosmograph WebGL2 client.

Every node, connection, genre tag, and metric emerges organically from real-world data created by human listeners.

---

## Visual & Interactive Features

- **Massive Cosmic Web**: Tens of thousands of artists and cross-community listener bridges modeled across dynamic musical continents with GPU-accelerated WebGL rendering.
- **Organic Continents**: Continental partitioning via Louvain modularity with golden-angle multi-tonal color generation (Pastel, Deep Jewel, Radiant Warm, Muted Dusty, and Vivid Electric).
- **Steep Power-Law Scaling**: Artist nodes scale proportionally to authentic listener reach, with high-resolution portrait avatars rendered seamlessly at dynamic zoom thresholds.
- **Neighborhood Illumination**: Selecting an artist focuses the camera, dims unrelated nodes into deep space, and illuminates direct audience bridges colored by the artist's community.
- **Responsive Artist Drawer**:
  - **Desktop**: Floating glass inspector with artist artwork, listener count, subgenre tags, and adaptive Top Shared Playlists with relative crossover affinity bars.
  - **Mobile**: Touch-optimized bottom sheet with peek and expanded states, gesture toggles, and safe-area insets.
- **30s Audio Streamer**: Persistent bottom audio player streaming 30-second AAC audio previews with scrubbing, volume control, and animated visualizer bars.
- **Instant Search (`Ctrl+K` or `/`)**: Global fuzzy search across artists, genres, and continents with smooth camera fly-to animations.
- **Continent Filter HUD**: Filter the entire galaxy by macro continent with interactive artist counts and color swatches.
- **Degrees of Separation ("Trace path")**: From an artist's drawer (or the route button in the header), pick a second artist to see the shortest chain of shared-playlist connections between them (ties broken by the strongest links), lit up on the map with a shareable `#from=&to=` link.
- **Genre Panels**: Open any genre from search or an artist's subgenre tags to see its artists by popularity, the continents they live in, related genres (by shared artists), and, where Wikidata has an exact match, a short description and when it emerged. Shareable via `#genre=<slug>`.
- **Crawlable Pages**: Static pages generated at build time from the same data: an "Artists like…" page for every artist in at least 45 playlists (keeping the build under Cloudflare Pages' 20,000-file limit) (`/artist/<slug>/`), a page per genre with at least five artists (`/genres/<slug>/`: where it sits on the map and, when it has them, its strongest pairings and related genres), a paginated A–Z artist index (`/artists/`), and sitemaps for each. Every static page has a header search across all artists and genres; artists without their own page appear with a small arrow that opens them in the atlas.
- **About & Methodology Modal**: Built-in guide detailing data provenance (EveryNoise, YouTube Music, Deezer), map visual legend (nodes, connections, colors), and issue reporting links to GitHub and email.


---

## How Data Is Gathered (The 8-Stage Pipeline)

The entire universe is built on **one cardinal rule**:
*Strictly zero hardcoding, zero artist favoritism, zero artificial override lists, and zero auto-generated Spotify embed playlists ("The Sound of [genre]").*

```
┌──────────────────────────────────────────────────────────────┐
│                     AUTONOMOUS DATA PIPELINE                 │
│ 0. Ingest EveryNoise Popularity Taxonomy (6,291 genres)      │
│ 1. Harvest Real Community Playlists via YouTube Music API    │
│ 2. Filter by Survival Threshold (c_i >= 4) & Hydrate Metadata│
│ 3. Compute Bipartite Co-occurrence Matrix (C = M^T * M)      │
│ 4. Cosine Similarity Normalization & Adaptive Sparsification │
│ 5. Louvain Community Detection & Archipelago Spring Layout   │
│ 6. Export Compact Web Artifact (atlas-graph.json)            │
│ 7. Wikidata Genre Enrichment (genre-info.json)               │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                   INTERACTIVE WEBGL FRONTEND                 │
│ • Vite + React 19 + TypeScript + Tailwind CSS                │
│ • Cosmograph WebGL2 Engine + 2D High-DPI Avatar Canvas       │
│ • 60-120 FPS Rendering with Responsive Mobile Bottom Sheet   │
└──────────────────────────────────────────────────────────────┘
```

### 1. Stage 0: EveryNoise Popularity Taxonomy Ingestion (`00_harvest_genres.py`)
- Ingests the complete global taxonomy of **6,291 popularity-ranked subgenres** from EveryNoise at Once.
- Generates natural search queries per subgenre: `"{genre} playlist"`, `"{genre} mix"`, and `"best of {genre}"`.
- Avoids Spotify embeds, auto-generated dividers, and promotional override lists.

### 2. Stage 1: Deep Community Playlist Harvesting (`01_harvest_playlists.py`)
- Queries real, public user-created community playlists from YouTube Music across all subgenres equally.
- **Strict Quality & Anti-Algorithmic Filters**:
  - **Rejects system authors**: Discards playlists by `"YouTube Music"`, `"Spotify"`, `"Various Artists - Topic"`, etc.
  - **Rejects algorithmic mixes**: Discards `"My Supermix"`, `"Supermix"`, and `RDCLAK...` algorithmic radio shelves.
  - **Anti-discography guard**: Discards playlists where any single artist accounts for $> 50\%$ of tracks.
  - **Boundary limits**: Strictly enforces $10 \le \text{tracks} \le 150$.
  - **Global curator cap**: Limits maximum 2 playlists from any single curator ID to prevent user bias.
- **Verified Recommendation Expansion**: After every genre is searched, explores the "Recommended playlists" shelves of verified anchor songs with an equal budget per genre. An anchor artist must appear in at least 2 playlists whose human-written title names the genre (or 2 of its search playlists when no such titles exist), and that genre must be one of its strongest homes. Every valid playlist found is kept as co-occurrence evidence; its genre label is assigned from its artists, so off-genre playlists are relabeled rather than contaminating the seed genre.
- **Verified Related-Playlist Expansion**: Then follows the "Related playlists" of up to 3 verified anchor playlists per genre. An anchor is one of the genre's own search playlists whose artists, judged as if that playlist had not been harvested, clearly belong to the genre; a genre without one is not expanded. A related playlist never inherits the genre: every artist has one vote, split across the genres it is core to, and the playlist is labeled only if the genre wins at least 15% of the votes and beats every other genre by 1.5x. Otherwise it stays unlabeled and only counts as co-occurrence evidence. Playlists related to the same anchor count as one independent appearance toward the survival threshold.
- **Second Related Layer**: Finally follows the "Related playlists" of up to 3 more verified anchors per genre (`--layer2-anchors`), chosen from the recommended and related playlists that carry the genre and pass the same vote test, strongest first, one per neighbourhood before a second. Its playlists are labeled by the same rule, count toward survival as part of their anchor's neighbourhood, and are never used as anchors themselves, so the expansion stops at two layers.
- **Concurrent Fetching**: Playlists are fetched in parallel (`--workers`, default 8) and accepted one by one in a fixed order, so results do not depend on request timing.
- **Copied-Playlist Guard**: Rejects playlists whose tracklist is a near-copy (>= 90% of the smaller tracklist shared) of one already harvested, so re-saved copies cannot masquerade as independent curation.
- **Atomic Checkpointing**: Saves compact progress every 10 minutes, allowing long-running crawls to pause and resume seamlessly.

### 3. Stage 2: Verification & Metadata Hydration (`02_enrich_artists.py`)
- **Mathematical Survival Threshold**: Artists survive into the atlas if and only if they appear across $c_i \ge 4$ independent qualifying playlists and at least one of their connections rests on 2 or more shared independent playlists (stage 4). An artist whose connections each rest on a single playlist has no corroborated relationship, which is also how different artists sharing one name show up.
- **Same-Name Artists**: A credit is a name together with the YouTube channel it is credited to. When two or more channels each reach $c_i \ge 4$ under one name, each channel is identified by finding its own songs on Deezer (falling back to the name check only when Deezer lists none of them under that name): channels that resolve to the same Deezer artist are merged, the others become separate artists or are dropped.
- **Metadata Hydration**: Resolves authentic listener reach and high-resolution portrait imagery via Deezer's catalog API.
- **Genre Tags** (`genre_tags.py`): Up to 3 EveryNoise genres per artist. First the artist's [Wikidata](https://www.wikidata.org/) genre statements (found by Deezer artist ID, matched to EveryNoise names exactly by label or alias), kept only when the artist's harvested playlists also carry that genre. Otherwise playlist consensus: playlist labels are re-judged by member votes, and a genre needs at least 2 independent playlists (and at least 10% of those behind the artist's best-supported genre) and must over-represent the artist (lift >= 1, at least half its best lift). Otherwise the single best genre from the harvest labels. Stage 5 then keeps a tag only if it is one of the artist's Wikidata genres that its playlists over-represent it in, or one of its 10 strongest drawn connections carries it. An artist left with no tag takes its Wikidata genres even without playlist support: only those its connections carry when any do, otherwise all of them (by playlist support, then EveryNoise popularity). Artists without such evidence get no genre rather than a guessed one. Wikidata lookups are cached in `pipeline/output/wikidata_*_cache.json`.
- **Audio Previews**: Attaches authentic 30-second AAC audio preview streams via Deezer API (with client-side on-demand resolver for fresh CDN playback tokens).

### 4. Stage 3 & 4: Sparse Co-Occurrence & Normalization (`03_build_cooccurrence.py`, `04_normalize_and_sparsify.py`)
- Projects the bipartite artist-playlist matrix into a sparse co-occurrence matrix $C = M^T M$. Credits (name and YouTube channel) resolve to Deezer artist IDs through the one map Stage 2's genre tags also use (the credits Stage 2 verified for each artist), so tags and connections rest on the same playlists.
- Computes Salton's Cosine similarity between artist co-presences.
- Applies adaptive k-NN sparsification with evidence-scaled degree bounds (4 to 24, scaling with the artist's playlist count, while every artist keeps its own strongest 4), drops artists none of whose kept connections rests on 2 or more shared independent playlists (a corroborated pair too weak to be kept does not count), and bridges satellite clusters into one connected galaxy.

### 5. Stage 5 & 6: Community Partitioning, Layout & Export (`05_community_and_layout.py`, `06_export_web_artifacts.py`)
- Partitions the graph into macro continents using Louvain modularity.
- Applies the genre tag neighbour check on the same connections the drawer shows, and names continents from their members' final tags.
- Runs a two-level archipelago layout: continent centroids placed by a spring layout over inter-continent affinity, subgenre micro-centroids within each continent (from each artist's first tag), vectorized spring physics, and soft clearance to prevent node overlap.
- Exports the bundled graph directly to `web/public/data/atlas-graph.json`, drawing each artist's 6 strongest connections by playlist overlap, plus those where it is among the other artist's 6 and bridge edges; the drawer lists exactly these.

### 6. Stage 7: Genre Enrichment (`07_enrich_genres.py`)
- Matches each atlas subgenre to a Wikidata music-genre item by **exact** English label, or failing that by one of the item's English aliases (case-insensitive). Genres with no match or several matches get nothing; there is no hand mapping.
- Attaches the item's description, inception date and English Wikipedia article.
- Uses the Wikidata genre index cached by Stage 2, so genre facts and artist tags come from the same snapshot (`--offline` fails if the cache is missing).
- Writes `web/public/data/genre-info.json`, loaded lazily by the genre panel.

---

## Quickstart Guide

### Prerequisites
- Node.js 18+ & npm
- Python 3.10+

### 1. Run the Web Client Locally

```bash
# Navigate to web directory
cd web

# Install dependencies
npm install

# Start local development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

*(Note: The pre-bundled galaxy dataset is included in `web/public/data/atlas-graph.json.gz` alongside chunked continent details, so no pipeline run is required to explore immediately).*

### 2. Run the Data Pipeline (Optional)

To harvest more playlists or re-run the layout simulation:

```bash
# Install Python dependencies
pip install -r pipeline/requirements.txt

# Run the complete autonomous pipeline
python pipeline/run_pipeline.py --tier 4 --target-playlists 20

# Or re-generate graph layout from existing checkpoints (Stage 2 through 6)
python pipeline/run_pipeline.py --from-step 2

# Or keep harvesting from the checkpoint: genres still below the target get their recommended-playlist phase again
# (labeled by content; the name search and the related layers are not repeated)
python pipeline/run_pipeline.py --from-step 1 --target-playlists 40 --max-anchors 12 --revisit

# The same, appended bottom-up (lowest-ranked genres first) with a time limit; unfinished genres stay queued
python pipeline/01_harvest_playlists.py --reverse --revisit --target-playlists 100 --max-anchors 12 --workers 16 --max-hours 8
```

---

## Project Structure

```
music-atlas/
├── README.md                          # Project documentation
├── AGENTS.md                          # Core philosophy & engineering rules
├── pipeline/                          # Python data generation & layout pipeline
│   ├── 00_harvest_genres.py           # EveryNoise taxonomy ingestion (6,291 genres)
│   ├── 01_harvest_playlists.py        # Public community playlist crawler
│   ├── 02_enrich_artists.py           # Survival threshold (c_i >= 4) & Deezer enrichment
│   ├── 03_build_cooccurrence.py       # Sparse CSR bipartite matrix projection
│   ├── 04_normalize_and_sparsify.py   # Salton's Cosine similarity & degree bounds
│   ├── 05_community_and_layout.py     # Louvain continents, final genre tags & layout
│   ├── 06_export_web_artifacts.py     # Exports web/public/data/atlas-graph.json & .gz
│   ├── 07_enrich_genres.py            # Wikidata genre descriptions & dates (genre-info.json)
│   ├── run_pipeline.py                # Master CLI runner with checkpointing
│   ├── sanitizer.py                   # Strict Unicode sanitization & prefix parsing
│   ├── genre_votes.py                 # Member-vote genre judgement (stages 1 & 2)
│   ├── genre_tags.py                  # Artist genre tag tiers & neighbour check
│   ├── wikidata.py                    # Cached Wikidata genre index & artist genre statements
│   ├── connections.py                 # Drawn connections (stages 5 & 6)
│   └── requirements.txt               # Python dependencies
└── web/                               # WebGL React client
    ├── public/data/                   # Graph bundle (atlas-graph.json.gz) & continent details
    ├── src/
    │   ├── components/
    │   │   ├── AboutModal.tsx         # Data methodology, map legend & issue link
    │   │   ├── AtlasCanvas.tsx        # Cosmograph WebGL2 canvas & avatar overlay
    │   │   ├── ArtistDrawer.tsx       # Responsive mobile bottom sheet / desktop sidebar
    │   │   ├── AudioPlayerBar.tsx     # 30s AAC preview player with scrubber
    │   │   ├── SearchBar.tsx          # Global artist & genre search with camera fly-to
    │   │   ├── GenrePanel.tsx         # Genre artists, continents, related genres, Wikidata facts
    │   │   ├── PathCard.tsx           # Degrees-of-separation result chain
    │   │   └── ControlHUD.tsx         # Continents, filters & Connect popover
    │   ├── hooks/useGraphData.ts      # Streaming gzip graph loader & color generator
    │   ├── types/atlas.ts             # TypeScript definitions
    │   └── App.tsx                    # Root application state & loading screen
    ├── package.json
    └── vite.config.ts
```



---

## License

- **Code** (`pipeline/`, `web/`): [MIT](LICENSE).
- **Derived graph data** (`web/public/data/`: artist co-occurrence edges and weights, continents, layout coordinates, subgenre assignments): [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Credit "Music Atlas (music-atlas.app)".
- **Third-party content, not covered by either license:**
  - Artist images, audio preview URLs and fan counts come from the [Deezer API](https://developers.deezer.com/) and are governed by Deezer's terms.
  - Genre names come from [EveryNoise at Once](https://everynoise.com/).
  - Genre descriptions, inception dates and artist genre statements come from [Wikidata](https://www.wikidata.org/) (CC0).
