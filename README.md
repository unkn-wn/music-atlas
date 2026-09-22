# Music Atlas (The Twitch Atlas for Music & Spotify)

An interactive, high-performance WebGL spatial graph visualization of the music streaming landscape. Modeled after the iconic **Twitch Atlas**, Music Atlas transforms streaming playlists into an organic virtual map where:

- **Node Size** represents artist popularity or listener reach.
- **Node Color** represents distinct musical communities and genres (Louvain modularity + Oklab color space).
- **Edges & Lines** represent listener crossover and audience overlap across playlists.
- **Dynamic Crossover Slider** filters lines in real time from macro bridges down to exclusive core affinities.

---

## Visual Preview & System Tour

- **Dense Cosmic Web**: 565 curated landmark artists and 3,911 high-signal listener crossover bridges modeled across 11 musical continents with outward-curving Bézier arcs.
- **Organic Continents**: Hip-Hop, Pop, Indie Rock, EDM, R&B / Soul, Urbano Latino, Rock / Metal, Country, K-Pop, Ambient / Classical, and Afrobeats.
- **Inter-Genre Bridges**: Explicit cross-genre playlist modeling ensures authentic listener crossovers (e.g. Pop ↔ EDM festival tracks, Hip-Hop ↔ R&B/Latin collaborations, Indie ↔ Folk crossover).
- **Steep Power-Law Visual Scaling**: Differentiates tiny starry nodes up to giant anchor headliners (2.0px to 28.0px), with portrait image medallions rendered directly on the WebGL canvas.
- **Neighborhood Illumination**: Selecting an artist maintains natural node sizes, dims non-neighbors into dark slate discs, and illuminates direct audience bridges in the artist's community color, perfectly matching the sidebar relationship list.
- **Live Search (`Ctrl+K` or `/`)**: Global fuzzy search across artists, genres, and continents with instant camera fly-to animation.
- **Artist Drawer & Audio Preview**: Slide-over inspector panel with framed artist artwork, follower and popularity metrics, Spotify links, and clickable audience overlap percentage bars for neighbor hopping.
- **Live 30s Audio Streamer**: Persistent bottom audio player bar streaming real 30-second AAC previews via cached iTunes Search catalog with progress scrubbing and volume controls.
- **World Radar (Minimap)**: Bottom-left macro map showing your viewport position in relation to all musical continents.
- **Sleek Minimalist HUD**: Clean floating top island bar inspired by `twitchmap.com` with a collapsible continent popover.

---

## Architecture & Pipeline

```
┌─────────────────────────────────────────────────────────┐
│                    DATA PIPELINE                        │
│ 1. Data Ingestion (Spotify MPD / Scaled Streaming DB)   │
│ 2. Bipartite Projection (CSR Sparse Matrix C = M^T M)   │
│ 3. Normalization (Salton's Cosine + Mutual k-NN)       │
│ 4. Community Detection (Louvain Modularity + TF-IDF)    │
│ 5. ForceAtlas2 Layout (Phase 1 LinLog + Phase 2 Spread) │
│ 6. Metadata Hydration (Images & 30s Audio Previews)    │
│ 7. Export Web Artifact (atlas-graph.json)               │
└──────────────────────────┬──────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                 WEBGL INTERACTIVE CLIENT                │
│ • Vite + React + TypeScript + Graphology + Sigma.js v3  │
│ • Curved Edges (@sigma/edge-curve) & WebGL Node Avatars │
│ • Custom Sigma Edge & Node Reducers (60-120 FPS)        │
│ • Glassmorphic Dark Space UI + Audio Preview Controller │
└─────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
music atlas/
├── DESIGN.md                          # Full architectural specification & mathematical models
├── README.md                          # Quickstart guide & documentation
├── pipeline/                          # Python data generation & graph layout pipeline
│   ├── 01_data_source.py              # Ingestion from Spotify MPD slices or streaming DB
│   ├── 02_build_cooccurrence.py       # Bipartite CSR sparse matrix projection
│   ├── 03_normalize_and_sparsify.py   # Salton's Cosine similarity & partitioned k-NN sparsification
│   ├── 04_community_detection.py      # Louvain modularity & consensus genre labeling
│   ├── 05_layout_forceatlas2.py       # LinLog ForceAtlas2 + radial power + anti-collision relaxation
│   ├── 06_hydrate_metadata.py         # Artist images, Spotify IDs & 30s iTunes AAC audio streams
│   ├── 07_export_web_artifacts.py     # Exports bundled web/public/data/atlas-graph.json
│   ├── expand_catalog.py              # Scaled catalog generator with 565 artists across 11 sectors
│   ├── run_pipeline.py                # Master runner for all 7 pipeline steps
│   └── requirements.txt               # Python dependencies (scipy, numpy, networkx, fa2)
└── web/                               # WebGL React client
    ├── public/data/atlas-graph.json   # Exported graph artifact
    ├── src/
    │   ├── components/
    │   │   ├── AtlasCanvas.tsx        # WebGL canvas with Sigma.js v3, curved edges & dynamic reducers
    │   │   ├── SearchBar.tsx          # Ctrl+K search with autocomplete & camera fly-to
    │   │   ├── ControlHUD.tsx         # Live threshold slider & continent filter pills
    │   │   ├── ArtistDrawer.tsx       # Slide-over inspector with crossover % overlap bars
    │   │   ├── AudioPlayerBar.tsx     # Persistent 30s preview player with equalizer
    │   │   └── Minimap.tsx            # Bottom-left world radar crosshair
    │   ├── hooks/useGraphData.ts      # Graphology graph loader & indexer
    │   ├── types/atlas.ts             # TypeScript interfaces
    │   └── App.tsx                    # Root state coordinator
    └── package.json
```

---

## Quickstart Guide

### 1. Run the Python Pipeline

Generate or update the graph data:

```bash
# Navigate to pipeline directory
cd pipeline

# Install requirements
pip install -r requirements.txt

# Run the master pipeline (executes all 7 stages in < 5 seconds)
python run_pipeline.py
```

This generates `web/public/data/atlas-graph.json`.

### 2. Run the Web Application

```bash
# Navigate to web directory
cd web

# Start development server
npm run dev

# Or build and run production preview
npm run build
npx vite preview --port 5173
```

Open `http://localhost:5173` in your browser.

---

## Keyboard & Mouse Controls

| Action                  | Control                                                      |
| :---------------------- | :----------------------------------------------------------- |
| **Pan**                 | Click & drag on canvas                                       |
| **Zoom**                | Mouse scroll wheel or On-screen `+` / `−` buttons            |
| **Search**              | Press `Ctrl+K` or `/`                                        |
| **Inspect Artist**      | Click on any artist circle                                   |
| **Audio Preview**       | Click Play on drawer card or press Space when drawer is open |
| **Hop to Neighbor**     | Click any crossover item in the artist drawer                |
| **Reset View**          | Click on-screen target crosshair button or press Escape      |
| **Filter Continent**    | Click any continent tag in the HUD                           |
| **Crossover Threshold** | Drag the slider in the top-left HUD                          |
