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

---

## How Data Is Gathered (The 7-Stage Pipeline)

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
│ 5. Louvain Community Detection & ForceAtlas2 Physics Layout  │
│ 6. Export Compact Web Artifact (atlas-graph.json)            │
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
- **Tier 2 Recommendation Expansion**: Discovers deeper community playlists via Song Related shelves of consensus catalog releases.
- **Atomic Checkpointing**: Saves progress incrementally every 5 genres, allowing long-running crawls to pause and resume seamlessly.

### 3. Stage 2: Verification & Metadata Hydration (`02_enrich_artists.py`)
- **Mathematical Survival Threshold**: Artists survive into the atlas if and only if they appear across $c_i \ge 4$ independent qualifying playlists.
- **Metadata Hydration**: Resolves authentic listener reach and high-resolution portrait imagery via Deezer and YouTube Music Official Artist Channels.
- **IDF-Weighted Subgenres**: Computes Top 3 Subgenres using inverse-document-frequency weighting across playlist provenance.
- **Audio Previews**: Attaches authentic 30-second AAC audio preview streams via iTunes Search API.

### 4. Stage 3 & 4: Sparse Co-Occurrence & Normalization (`03_build_cooccurrence.py`, `04_normalize_and_sparsify.py`)
- Projects the bipartite artist-playlist matrix into a sparse co-occurrence matrix $C = M^T M$.
- Computes Salton's Cosine similarity and Jaccard coefficients between artist co-presences.
- Applies adaptive k-NN sparsification with dynamic degree bounds (6 to 20 links per artist) to eliminate noise while preserving bridge filaments.

### 5. Stage 5 & 6: Community Partitioning, Layout & Export (`05_community_and_layout.py`, `06_export_web_artifacts.py`)
- Partitions the graph into macro continents using Louvain modularity.
- Runs a multi-phase ForceAtlas2 physics simulation with Barnes-Hut quadtree optimization, strong gravity, radial knee compression, and disk clearance to prevent node overlap.
- Exports the bundled graph directly to `web/public/data/atlas-graph.json`.

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

### 2. Run the Data Pipeline (Optional)

To harvest more playlists or re-run the layout simulation:

```bash
# Install Python dependencies
pip install -r pipeline/requirements.txt

# Run the complete autonomous pipeline
python pipeline/run_pipeline.py --tier 4 --target-playlists 20

# Or re-generate graph layout from existing checkpoints (Stage 2 through 6)
python pipeline/run_pipeline.py --from-step 2
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
│   ├── 02_enrich_artists.py           # Survival threshold (c_i >= 4) & Deezer/iTunes enrichment
│   ├── 03_build_cooccurrence.py       # Sparse CSR bipartite matrix projection
│   ├── 04_normalize_and_sparsify.py   # Salton's Cosine similarity & degree bounds
│   ├── 05_community_and_layout.py     # Louvain continents & ForceAtlas2 layout simulation
│   ├── 06_export_web_artifacts.py     # Exports web/public/data/atlas-graph.json
│   ├── run_pipeline.py                # Master CLI runner with checkpointing
│   ├── sanitizer.py                   # Strict Unicode sanitization & prefix parsing
│   └── requirements.txt               # Python dependencies
└── web/                               # WebGL React client
    ├── public/data/atlas-graph.json   # Exported graph artifact
    ├── src/
    │   ├── components/
    │   │   ├── AtlasCanvas.tsx        # Cosmograph WebGL2 canvas & avatar overlay
    │   │   ├── ArtistDrawer.tsx       # Responsive mobile bottom sheet / desktop sidebar
    │   │   ├── AudioPlayerBar.tsx     # 30s AAC preview player with scrubber
    │   │   ├── SearchBar.tsx          # Global fuzzy search with camera fly-to
    │   │   └── ControlHUD.tsx         # Macro continent selector popover
    │   ├── hooks/useGraphData.ts      # Graph data loader & golden-angle color generator
    │   ├── types/atlas.ts             # TypeScript definitions
    │   └── App.tsx                    # Root application state & loading screen
    ├── package.json
    └── vite.config.ts
```


