# Dynamic Music Atlas: Real-Time Streaming Data & Co-Occurrence Architecture
*End-to-End Autonomous Harvesting of 1,000–2,500+ Artists & Thousands of Public Playlists with Zero Hardcoding and Zero Synthetic Seeding*

---

## 1. Executive Summary & Real Data Mandate

### 1.1 The Strict Zero-Hardcoding Mandate
The initial prototype of Music Atlas relied on hardcoded Python arrays ([`artist_catalog.py`](file:///G:/Other%20computers/Leon%20PC/_CODE/music%20atlas/pipeline/artist_catalog.py) and [`expand_catalog.py`](file:///G:/Other%20computers/Leon%20PC/_CODE/music%20atlas/pipeline/expand_catalog.py)) and procedural playlist generation ([`generate_high_fidelity_playlists()`](file:///G:/Other%20computers/Leon%20PC/_CODE/music%20atlas/pipeline/01_data_source.py#L104-L256)). 

While convenient for small-scale testing, this introduced fundamental architectural flaws:
1. **Selection Bias**: Hand-curated lists favor personal preferences and miss explosive global breakthroughs.
2. **Artificial Topology**: Synthetic co-occurrence simulations generate connections based on presumed genre affinity rather than real human listening behavior.
3. **Stale Metrics**: Manually typed follower and popularity counts diverge from streaming reality.

**Architectural Principle**: **All data must be empirical**.
- Every artist must originate from live global streaming charts.
- Every monthly listener count must be the exact daily ground-truth metric.
- Every edge in the atlas must represent real co-occurrence across actual public streaming playlists.
- No hardcoded artist dictionaries, no synthetic bridge probabilities, and no randomized playlist seeding.

---

### 1.2 Evaluation of Streaming APIs & The Spotify Paywall Reality

| Vector | Source | Access / Auth | Real World Viability | Verdict |
| :--- | :--- | :--- | :--- | :--- |
| **Official Spotify Developer API** | `api.spotify.com/v1/*` | Client Credentials (`client_id` + `secret`) | **BLOCKED (HTTP 403)**: Spotify recently enacted a policy requiring an active Spotify Premium subscription for the app owner. Free developer accounts receive `403 Forbidden` on search, playlists, and artists. | **Unusable for open-source / zero-cost deployment.** |
| **Deezer Public API** | `api.deezer.com/*` | Open / Keyless | **Niche Representation**: Deezer has ~16M MAU (concentrated in France and Brazil) vs. Spotify's 620M+ and YouTube's 100M+. Lacks global zeitgeist and underrepresents US/Asian hip-hop, indie, and K-Pop. | **Insufficient for primary global catalog.** Used only as fallback metadata provider. |
| **Kworb Daily Spotify Index** | `kworb.net/spotify/listeners.html` | Open Static HTML | **Ground Truth**: Scrapes daily Spotify client metrics for the top 2,500 artists globally. Provides exact 22-char Spotify IDs and true Monthly Active Listeners (e.g., Bruno Mars 133M, The Weeknd 115M). | **Definitive source for Artist Universe & Active Listeners.** |
| **Spotify Public Embeds** | `open.spotify.com/embed/playlist/*` | Open SSR JSON (`__NEXT_DATA__`) | **Official Editorial Playlists**: No auth, zero 403 errors. Returns full tracklists, artist names, and direct official Spotify 30s MP3 audio previews (`p.scdn.co/mp3-preview/...`). | **Definitive source for Flagship Editorial Playlists & Previews.** |
| **YouTube Music Public Engine** | `ytmusicapi` | Open Unauthenticated Session | **Massive Public Curations**: Millions of public and community playlists across all genres and countries without login. | **Definitive source for large-scale playlist harvesting (thousands of playlists).** |
| **Apple iTunes Search API** | `itunes.apple.com/search` | Open REST API | **Deterministic Taxonomy**: Standardized, clean `primaryGenreName` across all artists without API keys. | **Definitive source for automated genre classification.** |

---

## 2. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    LAYER 0: ARTIST HARVESTING & TAXONOMY                    │
│                        (pipeline/00_harvest_artists.py)                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. Kworb Top 2,500 Spotify Artists Index                                   │
│     └── Slices top artists globally with 22-char Spotify IDs & Listeners    │
│  2. Apple iTunes Search API (Throttled + Disk-Cached)                       │
│     └── Direct raw primaryGenreName output (no quotas, no normalization)    │
│  3. Raw Empirical Taxonomy:                                                 │
│     └── Preserves exact iTunes genres (Hip-Hop/Rap, Pop, Rock, Country...)  │
│  4. Export: pipeline/output/artists_catalog.json                            │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    LAYER 1: LARGE-SCALE PLAYLIST HARVESTING                 │
│                          (pipeline/01_data_source.py)                       │
├─────────────────────────────────────────────────────────────────────────────┤
│  Multi-Vector Public Streaming Playlist Ingestion:                          │
│  ├── Vector A: Spotify Public Embeds (~500 Flagship Editorial Playlists)    │
│  │   └── Today's Top Hits, RapCaviar, mint, Viva Latino, Rock This, etc.   │
│  ├── Vector B: YouTube Music Engine (500–800 Genre/Mood/Artist Playlists)   │
│  │   └── Public community & user playlists via unauthenticated ytmusicapi   │
│  └── Vector C: Kworb / Spotify Daily Country Charts (70+ Country Top 200)   │
│      └── Regional listening patterns from US, UK, Brazil, Japan, Mexico...  │
│                                                                             │
│  Total Dataset: 1,200–1,800 real playlists yielding >300,000 pairings       │
│  Normalization & Canonical Matching:                                        │
│  ├── 22-char Spotify ID matching (Vectors A & C)                             │
│  └── NFKD Unicode normalization + delimiter splitting for YouTube Music     │
│  Prune disconnected orphan nodes (<3 co-occurrences)                        │
│  Export: pipeline/output/playlist_artist_pairs.json                         │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                 LAYER 2: GRAPH COMPUTATION & EMBEDDING                      │
│                         (Steps 02 ──> 07)                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  02_build_cooccurrence.py   ──> Sparse co-occurrence matrix C = B^T B       │
│  03_normalize_and_sparsify  ──> Pointwise Mutual Information (PMI) + k-NN   │
│  04_community_detection.py  ──> Native Louvain Modularity (11 communities)  │
│  05_layout_forceatlas2.py   ──> Canvas [-2200, 2200] + cKDTree relaxation   │
│  06_hydrate_metadata.py     ──> Multi-tier hydration (Spotify Embed / Deezer│
│                                 / iTunes 30s previews + 640x640 artwork)    │
│  07_export_web_artifacts.py ──> atlas-graph.json (Top 5% headliners)        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Component Mechanics

### 3.1 Step 0: Artist Harvesting (`00_harvest_artists.py`)

#### A. Ingestion from Kworb Spotify Daily Listeners Table
* **URL**: `https://kworb.net/spotify/listeners.html`
* **Payload Structure**: Static HTML containing table rows:
  ```html
  <tr>
    <td>1</td>
    <td><a href="artist/0du5cEVh5yTK9QJze8zA0C_songs.html">Bruno Mars</a></td>
    <td>133,072,425</td>
    <td>+254,120</td>
  </tr>
  ```
* **Extraction**: Regex `href="artist/([a-zA-Z0-9]{22})_songs\.html">([^<]+)</a>.*?<td>([0-9,]+)</td>`
* **Logarithmic Popularity Mapping**:
  Because Spotify's private API `popularity` (0–100) is unavailable, we derive an exact empirical popularity index from the Monthly Listeners ($L$):
  $$\text{popularity} = \min\left(100, \max\left(20, \text{round}\left(20 + 80 \times \frac{\log_{10}(L) - 6.0}{8.2 - 6.0}\right)\right)\right)$$
  * $L = 150,000,000 \implies 100$
  * $L = 50,000,000 \implies 82$
  * $L = 10,000,000 \implies 56$
  * $L = 1,000,000 \implies 20$

#### B. Automated Genre Classification via Apple iTunes Search
* **Endpoint**: `https://itunes.apple.com/search?term={name}&entity=musicArtist&limit=1`
* **Return Schema**:
  ```json
  {
    "resultCount": 1,
    "results": [
      {
        "artistName": "The Weeknd",
        "primaryGenreName": "R&B/Soul",
        "primaryGenreId": 15
      }
    ]
  }
  ```
* **Rate-Limit Mitigation**:
  * Apple limits requests to ~20 req/minute per IP.
  * **Persistent Cache**: `pipeline/output/itunes_genre_cache.json` stores `{ "artist_name_lower": "primaryGenreName" }`.
  * Cold runs enforce a 3.1s polite delay between uncached requests. Warm runs execute instantly from disk.
  * Filter down to target artist quota *before* querying iTunes to minimize API calls.

#### C. Raw Apple iTunes Genres (Zero Quotas, Zero Mapping)
To eliminate manual bias, synthetic sector buckets, and heuristic grouping errors, genres are kept **100% raw as returned by the Apple iTunes API**:

- The exact string returned in `primaryGenreName` (e.g. `Hip-Hop/Rap`, `Pop`, `Alternative`, `Rock`, `Country`, `R&B/Soul`, `K-Pop`, `Latin`, `Dance`, etc.) is retained as the artist's genre.
- **Zero Hardcoded Quotas**: Artists are selected strictly by their true global listening popularity from Kworb, rather than forcing quotas across synthetic continent categories.
- **Zero Heuristic Normalization**: No dictionary mapping or substring rules. The raw Apple iTunes classification is preserved as empirical ground truth.

---

### 3.2 Step 1: Large-Scale Public Playlist Harvesting (`01_data_source.py`)

#### Vector A: Spotify Public Embed Crawler (~500 Flagship Playlists)
* **Mechanism**: Spotify renders public playlists via Next.js SSR at `https://open.spotify.com/embed/playlist/{playlist_id}`.
* **Extraction**:
  Extract `<script id="__NEXT_DATA__" type="application/json">` and parse `props.pageProps.state.data.entity`:
  * `title`: Playlist title (e.g., *"Today's Top Hits"*, *"RapCaviar"*)
  * `trackList`: Array of up to 100 tracks:
    ```json
    {
      "uri": "spotify:track:02HyFYmpzt02VJ8k0CqxKj",
      "title": "Ain't In LA",
      "subtitle": "ADÉLA",
      "audioPreview": {
        "format": "MP3_96",
        "url": "https://p.scdn.co/mp3-preview/a3d0119e3182fbb19636c2a44737fa3e0b71f939"
      }
    }
    ```
* **Playlist Index**:
  Maintain a registry of ~500 curated Spotify flagship playlists covering:
  1. **Global Editorial**: *Today's Top Hits, RapCaviar, Viva Latino, mint, Rock This, Are & Be, Hot Country, K-Pop ON!, African Heat, All New Indie*.
  2. **Subgenre Deep-Dives**: *Techno Bunker, Gold School, Melodic House, Microhouse, Lo-Fi Beats, Bedroom Pop, Deathcore, Neo-Psychedelia, Reggaeton Classics*.
  3. **Decade Archives**: *All Out 70s, All Out 80s, All Out 90s, All Out 2000s, All Out 2010s*.
  4. **Mood & Context**: *Workout, Late Night, Chill Hits, Deep Focus, Party, Dinner*.

#### Vector B: YouTube Music Public Playlist Crawler (500–800 Playlists)
* **Mechanism**: Using `ytmusicapi` with an unauthenticated session (`YTMusic()`).
* **Search Execution**:
  Iterate across 80+ targeted musical queries (genres, subgenres, and cultural movements):
  ```python
  from ytmusicapi import YTMusic
  yt = YTMusic()
  results = yt.search("progressive house playlist", filter="playlists", limit=10)
  for pl in results:
      full_pl = yt.get_playlist(pl["playlistId"], limit=100)
  ```
* **Rate-Limit & Anti-Scraping Strategy**:
  * 0.4s–0.8s randomized delay between requests.
  * Local JSON caching under `pipeline/data/crawled_playlists/`.
  * Target volume: 500–800 playlists (delivers high density while remaining safely within Google/YouTube unauthenticated thresholds).

#### Vector C: Kworb / Spotify Daily Country Charts (70+ Countries)
* **Mechanism**: Kworb maintains static tables of daily Spotify Top 200 for 70+ countries at `https://kworb.net/spotify/country/{country_code}_daily.html`.
* **Value**: Captures localized co-listening (e.g. Japanese City Pop & J-Rock in `jp`, Latin Urbano in `co` and `pr`, Afrofusion in `ng`, UK Drill in `gb`).
* Each country chart acts as a high-density regional playlist containing 200 verified Spotify tracks.

#### Bipartite Normalization & Graph Connectivity Safeguards
1. **Type-Safe Playlist IDs**:
   All playlist IDs are strictly cast to prefixed strings (`f"sp_{pl_id}"`, `f"yt_{pl_id}"`, `f"kw_{pl_id}"`) to prevent Python sorting errors (`TypeError: '<' not supported between instances of 'str' and 'int'`).
2. **Robust Track-to-Catalog Name Matching**:
   * For Spotify Embeds and Charts: Direct match on 22-char `spotify_id` first.
   * For YouTube Music strings:
     1. Unicode normalize using `unicodedata.normalize('NFKD', s)`.
     2. Lowercase and strip punctuation (`.`, `-`, `'`, `"`).
     3. Split multi-artist track tags by standard collaboration delimiters (`,`, `&`, `feat.`, `ft.`, `with`, `prod.`), preserving recognized band names (e.g. *"Earth, Wind & Fire"*).
     4. Match exclusively via exact whole-token equality against the catalog name index. **Never use substring containment** (prevents *"Future"* matching *"Future Islands"*).
3. **Orphan Node Prevention**:
   Any artist harvested in Step 0 that fails to achieve at least 3 co-occurrences across the harvested playlists is pruned from `artists_catalog.json` before Step 2. This guarantees $0\%$ unpositioned nodes stacking at $(0, 0)$ in the WebGL canvas.

---

## 4. Downstream Pipeline Mathematical Alignment

### 4.1 Step 2: Co-Occurrence Matrix (`02_build_cooccurrence.py`)
From the set of bipartite pairs $\mathcal{B} = \{(p_i, a_j)\}$, construct the binary affiliation matrix $B \in \{0, 1\}^{M \times N}$, where $M$ is total playlists and $N$ is catalog artists.

The artist co-occurrence matrix $C \in \mathbb{N}^{N \times N}$ is computed via sparse matrix multiplication:
$$C = B^T B, \quad C_{jk} = \sum_{i=1}^M B_{ij} B_{ik}$$

### 4.2 Step 3: PMI Normalization & Sparsification (`03_normalize_and_sparsify.py`)
Raw co-occurrence is heavily biased toward mega-artists. We normalize using **Positive Pointwise Mutual Information (PPMI)**:
$$\text{PMI}(a_j, a_k) = \log_2 \left( \frac{P(a_j, a_k)}{P(a_j) P(a_k)} \right) = \log_2 \left( \frac{C_{jk} \cdot M}{C_{jj} \cdot C_{kk}} \right)$$
$$\text{PPMI}(a_j, a_k) = \max\left(0, \text{PMI}(a_j, a_k) - \log_2(T)\right)$$

**Adaptive $k$-NN Sparsification**:
To ensure cosmic web clustering and avoid visual hairballs:
* Retain the top $k = 12$ mutual nearest neighbors per artist.
* Retain all edges with $\text{PPMI} > \tau_{\text{global}}$.
* Verify giant component connectivity ($|\mathcal{V}_{\text{giant}}| / N > 0.98$).

### 4.3 Step 4: Raw Apple iTunes Genre Grouping (`04_community_detection.py`)
* Artists are grouped strictly by their raw Apple iTunes API `primaryGenreName` output.
* Zero hardcoding, zero quotas, and zero heuristic genre mapping.
* Each unique raw genre is assigned a distinctive color from an expanded, vibrant palette.

### 4.4 Step 5: Natural ForceAtlas2 Spatial Optimization (`05_layout_forceatlas2.py`)
To produce the natural, organic cosmic web from commit `691cd95` without artificial circular boundary constraints:
- **Stage 1 (LinLog Macro Spreading)**: ForceAtlas2 LinLog attraction (`linLogMode=True`, `scalingRatio=6.5`, `gravity=0.35`, `edgeWeightInfluence=1.0`, `strongGravityMode=False`) clusters naturally related peers and spreads distant genres into an organic topography with real bays and straits.
- **Stage 2 (Local Refinement & Anti-Collision)**: ForceAtlas2 local refinement (`linLogMode=False`, `adjustSizes=True`, `scalingRatio=24.0`, `gravity=0.15`, `edgeWeightInfluence=0.6`) accounts for physical node size footprints to prevent overlap.
- **Stage 3 (Pairwise Spacing Relaxation)**: Pairwise distance relaxation with `min_dist=28.0px` ensures clean breathing room between neighboring artists.
- Coordinates normalized to expanded galactic canvas `[-1350.0, 1350.0]`.
- **Zero Circular Constraints**: No circular harmonic angle seeding, no artificial radial jitter, and no `strongGravityMode` spherical forcing.

### 4.5 Step 6: Multi-Tier Metadata Hydration (`06_hydrate_metadata.py`)
Because the Spotify Web API is locked behind HTTP 403, media assets are hydrated using a resilient multi-tier fallback:
1. **Tier 1 (Spotify CDN)**: High-res artwork (640x640) and official 30-second MP3 audio preview captured directly during Step 1 Spotify Embed harvesting.
2. **Tier 2 (Deezer Artist Search)**: High-resolution portrait photograph via open endpoint `https://api.deezer.com/search/artist?q={name}`.
3. **Tier 3 (Apple iTunes Search)**: Guaranteed 256kbps AAC audio preview stream and 600x600 artwork via `https://itunes.apple.com/search?term={name}&entity=song`.
4. **Persistent Cache**: All hydrated metadata cached to `pipeline/output/artist_metadata_cache.json`.

### 4.6 Step 7: Web Artifacts Export (`07_export_web_artifacts.py`)
* **Headliner Threshold**: Dynamic top 5% of nodes by empirical Monthly Listeners (e.g., top 50 nodes for $N=1,000$).
* **Format**: Exports `web/public/data/atlas-graph.json` strictly compliant with Sigma.js WebGL and React state schema.

---

## 5. File Deprecation & Cleanup Plan

To honor the zero-hardcoding mandate, the following files and routines are permanently decommissioned:

1. **Delete**: [`pipeline/artist_catalog.py`](file:///G:/Other%20computers/Leon%20PC/_CODE/music%20atlas/pipeline/artist_catalog.py) (legacy seed dictionary).
2. **Delete**: [`pipeline/expand_catalog.py`](file:///G:/Other%20computers/Leon%20PC/_CODE/music%20atlas/pipeline/expand_catalog.py) (legacy 550 hardcoded catalog).
3. **Refactor**: [`pipeline/01_data_source.py`](file:///G:/Other%20computers/Leon%20PC/_CODE/music%20atlas/pipeline/01_data_source.py)
   * Remove `ADDITIONAL_ARTISTS` in-memory list.
   * Remove `generate_high_fidelity_playlists()` procedural generator.
   * Implement the Multi-Vector Public Playlist Harvester (Vectors A, B, C).
4. **Create**: `pipeline/00_harvest_artists.py`
   * Implement Kworb Spotify 2,500 index scraping + Apple iTunes genre taxonomy.
5. **Update**: [`pipeline/run_pipeline.py`](file:///G:/Other%20computers/Leon%20PC/_CODE/music%20atlas/pipeline/run_pipeline.py)
   * Add Step 0 (`00_harvest_artists.py`) as the foundational stage of pipeline execution.

---

## 6. Execution Verification Protocol

1. **Phase 1: Catalog Harvesting (`00_harvest_artists.py`)**
   * Execute: `python pipeline/00_harvest_artists.py --target 1000`
   * Verification: Confirm `pipeline/output/artists_catalog.json` contains 1,000 artists with valid `spotify_id`, verified `monthly_listeners > 0`, and balanced macro-genre tags across all 11 sectors.
2. **Phase 2: Playlist Crawling & Edge Mapping (`01_data_source.py`)**
   * Execute: `python pipeline/01_data_source.py`
   * Verification: Confirm >1,200 real playlists parsed and >250,000 pairs written to `playlist_artist_pairs.json`. Confirm zero orphan nodes.
3. **Phase 3: End-to-End Pipeline Run**
   * Execute: `python pipeline/run_pipeline.py`
   * Verification: Confirm all 8 stages execute without errors in under 3 minutes.
4. **Phase 4: Frontend WebGL Verification**
   * Start Vite dev server: `npm run dev` in `web/`.
   * Open browser to verify:
     * Sigma.js renders 1,000 nodes without overlap or (0,0) black holes.
     * Dynamic Minimap tracks viewport accurately.
     * Clicking an artist opens `ArtistDrawer.tsx` showing valid Monthly Listeners, portrait photo, and functional audio preview playback.
