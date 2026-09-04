# Dynamic Artist Catalog Harvesting: Spotify API Architecture & Scaling Plan
*Automated Ingestion of 1,000 to 10,000 Artists for Music Atlas*

---

## 1. Executive Summary & Problem Analysis

### 1.1 The Limitations of Hardcoded Catalogs
The initial prototype of Music Atlas relied on hardcoded lists of artists across 11 sectors ([`expand_catalog.py`](file:///G:/Other%20computers/Leon%20PC/_CODE/music%20atlas/pipeline/expand_catalog.py)). While effective for rapid prototyping and guaranteeing specific landmark artists (e.g., Taylor Swift, Drake, Coldplay, The Chainsmokers), hardcoding presents severe bottlenecks as the atlas scales:
1. **Selection Bias & Omissions**: Landmark global acts or trending breakthrough artists are easily omitted without manual auditing.
2. **Maintenance Debt**: Adding hundreds or thousands of artists by hand is unsustainable.
3. **Stale Metrics**: Hardcoded follower counts and popularity scores become inaccurate over time.
4. **Scale Ceiling**: Scaling to 1,000, 5,000, or 10,000+ artists requires programmatic discovery, deduplication, and automated hydration.

### 1.2 Evaluation of Data Sources: Last.fm vs. Spotify Developer API

| Dimension | Last.fm Web API (`chart.getTopArtists`) | Spotify Web API (`/v1/search` + Playlists) | Verdict |
| :--- | :--- | :--- | :--- |
| **Data Integrity & Representation** | **Biased towards scrobbler power users**. Relies entirely on users installing browser extensions or third-party scrobblers. Heavily skewed towards indie rock, shoegaze, metal, and retro genres. | **Ground truth for global streaming**. Reflects billions of daily active streams across all demographics and regions worldwide. | **Spotify is vastly superior for real streaming charts.** |
| **Authentication & Cost** | Simple API key (free, instant). | Free Spotify Developer App (`client_id` + `client_secret`, Client Credentials Grant, zero OAuth login required). | **Tie** (Both are free and take < 2 minutes to set up). |
| **Data Richness** | Artist name, scrobbles, listeners, MBID. Images are low-res or deprecated. | High-res album/artist artwork (640x640), exact Spotify popularity index (0–100), follower count, verified Spotify IDs, and rich genre tags. | **Spotify is vastly superior for UI assets and metrics.** |
| **Direct Endpoints for "Top Artists"** | Provides direct `chart.getTopArtists` with pagination up to 10,000. | Does not provide a single `GET /artists/top` endpoint; requires multi-dimensional search matrix & playlist harvesting. | **Last.fm is simpler, but Spotify produces vastly higher-quality output.** |

**Conclusion**: Spotify Developer Web API is the definitive choice for Music Atlas. By building an intelligent multi-query crawling matrix across subgenres and official editorial playlists, we can reliably harvest 1,000 to 10,000+ artists with authentic Spotify metrics, native artwork, and diverse genre distribution.

---

## 2. Spotify Developer API Ingestion Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          SPOTIFY DEVELOPER PORTAL                           │
│                 Create App ──> Obtain Client ID & Client Secret             │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│              STEP 0: pipeline/00_fetch_spotify_catalog.py                   │
│                                                                             │
│  1. Client Credentials OAuth Flow (POST https://accounts.spotify.com/token) │
│  2. Dual-Engine Ingestion Pipeline:                                         │
│     ├── Engine A: Subgenre Query Matrix (/v1/search?q=genre:"..."&type=art) │
│     │    └── 60+ Subgenre buckets × Top 50-200 artists/bucket               │
│     └── Engine B: Editorial Flagship Playlists (/v1/playlists/{id}/tracks)  │
│          └── Today's Top Hits, RapCaviar, Viva Latino, mint, Rock This, etc.│
│  3. Token-Bucket Rate Limiting (Exponential Backoff + 429 Retry-After)      │
│  4. Deduplication & Cross-Genre Merging by Spotify Artist URI               │
│  5. Popularity Thresholding & Quota Balancing                               │
│  6. Export Normalized JSON: pipeline/output/catalog_expanded.json           │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      DOWNSTREAM MUSIC ATLAS PIPELINE                        │
│  01_data_source.py ──> 02_build_cooccurrence.py ──> 03_normalize.py        │
│  ──> 04_community.py ──> 05_layout_fa2.py ──> 06_hydrate.py ──> 07_export   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Ingestion Mechanics

### 3.1 Authentication: Client Credentials Grant Flow
The Client Credentials Flow is designed specifically for server-to-server and automated backend scripts. It does not require any user authorization popups or OAuth redirect URIs:

```http
POST https://accounts.spotify.com/api/token
Authorization: Basic <base64(client_id:client_secret)>
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
```

**Response**:
```json
{
  "access_token": "BQ...xyz",
  "token_type": "Bearer",
  "expires_in": 3600
}
```
The token is cached in memory and automatically refreshed every 55 minutes.

### 3.2 Bypassing the 1,000-Offset Limit via Multi-Dimensional Search
The Spotify Web API enforces a strict constraint on search pagination:
$$\text{offset} + \text{limit} \le 1000$$
Attempting to request `offset=1000` returns `HTTP 400 Bad Request`. Therefore, one cannot simply query `q=*` and paginate to 10,000.

Instead, we employ a **Multi-Dimensional Query Matrix**:

#### Dimension 1: Micro-Genre Partitioning
Spotify indexes over 6,000 micro-genres derived from the Every Noise at Once taxonomy. When searching `q=genre:"<genre_name>"&type=artist`, Spotify automatically orders matches by relevance and artist popularity:
- `genre:"trap"` returns Drake, Travis Scott, Future, 21 Savage...
- `genre:"indie rock"` returns Arctic Monkeys, The Strokes, Tame Impala, The 1975...
- `genre:"melodic techno"` returns ARTBAT, Tale of Us, Anyma, Stephan Bodzin...
- `genre:"bachata"` returns Romeo Santos, Aventura, Prince Royce...

By sampling 40–80 targeted subgenres across all 11 musical continents at depths of 50 to 150 artists per query, we acquire 3,000 to 8,000 distinct artists without ever approaching the 1,000-item offset boundary.

#### Dimension 2: Year Interval Slicing (For Massive Macro-Genres)
For enormous genres like "rock" or "pop" where the top 1,000 only scratches the surface, Spotify supports the `year:` search modifier:
- `q=genre:"rock" year:2020-2025` (contemporary modern rock)
- `q=genre:"rock" year:2010-2019` (2010s alternative & indie)
- `q=genre:"rock" year:2000-2009` (2000s post-grunge & emo)
- `q=genre:"rock" year:1990-1999` (90s grunge & alt-rock)
- `q=genre:"rock" year:1970-1989` (classic rock & metal pioneers)

Each sub-query resets the 1,000-item offset limit, allowing systematic harvesting of deep catalog legends alongside modern chart-toppers.

#### Dimension 3: Flagship Editorial Playlist Ingestion
Spotify's editorial team maintains official cultural playlists that define the streaming zeitgeist. Each playlist contains 50 to 100 tracks from leading artists currently receiving algorithmic and editorial promotion:
- **Global / Pop**: *Today's Top Hits* (`37i9dQZF1DXcBWIGoYBM5M`), *Pop Rising* (`37i9dQZF1DWUa8ZRTfalHk`)
- **Hip-Hop / Rap**: *RapCaviar* (`37i9dQZF1DX0XUsuxWHRQd`), *Get Turnt* (`37i9dQZF1DWY4xHQp97fN6`)
- **Latin**: *Viva Latino* (`37i9dQZF1DX10zKzsJ2jva`), *Baila Reggaeton* (`37i9dQZF1DWY7IeIP1vjxl`)
- **Rock / Alternative**: *Rock This* (`37i9dQZF1DX1rVvRgNX2YR`), *New Noise* (`37i9dQZF1DWT2jS7NwYPVI`)
- **EDM / Dance**: *mint* (`37i9dQZF1DX4dyzvuaRJ0n`), *Dance Party* (`37i9dQZF1DXaXB8fQg7xif`)
- **R&B**: *Are & Be* (`37i9dQZF1DX4SBhb3fqCJd`), *Chilled R&B* (`37i9dQZF1DX2UgsUIg75Vg`)
- **Country**: *Hot Country* (`37i9dQZF1DX1lVhptIYRda`), *Country Gold* (`37i9dQZF1DWZBCPUIUs2iU`)
- **K-Pop**: *K-Pop ON!* (`37i9dQZF1DX9tPFwDMOaN1`)
- **Afrobeats**: *African Heat* (`37i9dQZF1DX48TTZL62Yht`)
- **Ambient / Classical**: *Peaceful Piano* (`37i9dQZF1DX4sWSpwq3LiO`), *Classical Essentials* (`37i9dQZF1DWWEJlAGA9gs0`)

Querying these playlists extracts the primary artists and guarantees that every contemporary streaming giant is included in the catalog with 100% certainty.

---

## 4. Genre Taxonomy & Balanced Continent Distribution

To ensure Music Atlas does not collapse into an undifferentiated mass of pop and rap, the ingestion engine uses a **Balanced Partitioning Strategy**. The 11 continents are divided into curated subgenre clusters:

| Continent Name | Default Hex Color | Curated Subgenres for Spotify Search Matrix | Target Quota (1k Tier) | Target Quota (5k Tier) | Target Quota (10k Tier) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Hip-Hop / Rap** | `#E11D48` (Crimson) | `hip hop`, `trap`, `southern hip hop`, `drill`, `boom bap`, `gangster rap`, `conscious hip hop`, `melodic rap` | 130 | 650 | 1,300 |
| **Pop & Mainstream** | `#3B82F6` (Electric Blue) | `pop`, `dance pop`, `post-teen pop`, `synthpop`, `electropop`, `europop`, `teen pop` | 130 | 650 | 1,300 |
| **Indie & Alt Rock** | `#F59E0B` (Amber) | `indie rock`, `modern rock`, `indie pop`, `shoegaze`, `bedroom pop`, `post-punk`, `indie folk`, `dream pop` | 110 | 550 | 1,100 |
| **EDM & Electronic** | `#EC4899` (Hot Pink) | `edm`, `electro house`, `slap house`, `progressive house`, `melodic techno`, `drum and bass`, `dubstep`, `trance` | 100 | 500 | 1,000 |
| **R&B & Soul** | `#8B5CF6` (Purple) | `r&b`, `contemporary r&b`, `urban contemporary`, `neo soul`, `soul`, `afro r&b` | 90 | 450 | 900 |
| **Urbano Latino** | `#10B981` (Emerald) | `reggaeton`, `trap latino`, `urbano latino`, `latin pop`, `bachata`, `regional mexican`, `corridos tumbados` | 100 | 500 | 1,000 |
| **Rock & Metal** | `#EF4444` (Flame Red) | `hard rock`, `alternative metal`, `metalcore`, `heavy metal`, `nu metal`, `classic rock`, `punk`, `grunge` | 90 | 450 | 900 |
| **Country & Americana** | `#D97706` (Ochre) | `country`, `contemporary country`, `country road`, `americana`, `outlaw country`, `bluegrass` | 70 | 350 | 700 |
| **K-Pop & Asian Pop** | `#06B6D4` (Cyan) | `k-pop`, `k-pop boy group`, `k-pop girl group`, `j-pop`, `j-rock`, `c-pop`, `mandopop` | 70 | 350 | 700 |
| **Afrobeats & African** | `#F97316` (Orange) | `afrobeats`, `amapiano`, `afropop`, `nigerian pop`, `gengetone`, `alté` | 60 | 300 | 600 |
| **Ambient & Classical** | `#64748B` (Slate Blue) | `ambient`, `soundtrack`, `modern classical`, `composition ambient`, `neo-classical`, `piano cover`, `lo-fi beats` | 50 | 250 | 500 |
| **TOTALS** | — | — | **1,000** | **5,000** | **10,000** |

---

## 5. Rate Limiting, Deduplication, and Normalization

### 5.1 Rate Limiting Architecture
Spotify enforces a rolling 30-second rate-limit window. When exceeded, the API responds with:
```http
HTTP/1.1 429 Too Many Requests
Retry-After: 12
```

The crawler implements a **Token-Bucket Rate Limiter**:
```python
import time
import requests

class SpotifyRateLimiter:
    def __init__(self, requests_per_second=10):
        self.delay = 1.0 / requests_per_second

    def get(self, session, url, headers, params=None):
        while True:
            time.sleep(self.delay)
            resp = session.get(url, headers=headers, params=params)
            if resp.status_code == 200:
                return resp.json()
            elif resp.status_code == 429:
                retry_after = int(resp.headers.get("Retry-After", 5))
                print(f"[Rate Limit] 429 received. Sleeping {retry_after + 1}s...")
                time.sleep(retry_after + 1)
            elif resp.status_code in [500, 502, 503]:
                time.sleep(2.0)
            else:
                resp.raise_for_status()
```

### 5.2 Performance & Execution Time Estimates
- **1,000 Artists Target**:
  - ~30 genre queries $\times$ 1–2 pages (50 items/page) = ~50 HTTP calls.
  - At 10 requests/sec: **~5 seconds execution time**.
- **5,000 Artists Target**:
  - ~60 genre queries $\times$ 2–3 pages = ~150 HTTP calls.
  - Execution time: **~15–20 seconds**.
- **10,000 Artists Target**:
  - ~80 genre queries $\times$ 3–4 pages = ~300 HTTP calls.
  - Execution time: **~30–45 seconds**.

### 5.3 Deduplication & Multi-Genre Attribution
Because an artist like Drake appears in `hip hop`, `trap`, `canadian pop`, and `pop rap`:
1. Use the unique Spotify Artist ID (`artist["id"]`) as the dictionary key.
2. Accumulate all unique genres in a `set`:
   ```python
   catalog[artist_id]["genres"].update(artist_payload["genres"])
   ```
3. Store the highest recorded popularity score (0–100) and exact Spotify follower count.
4. Extract the highest-resolution image:
   ```python
   images = artist_payload.get("images", [])
   # Pick the 640x640 or highest available image URL
   image_url = images[0]["url"] if images else ""
   ```
5. Assign the primary `macro_genre` using TF-IDF / keyword matching against the 11 continent definitions.

---

## 6. Algorithmic Scalability (1,000 $\to$ 10,000 Artists)

Scaling from 565 artists to 1,000, 5,000, and 10,000 artists introduces specific computational and rendering challenges across the pipeline and frontend:

### 6.1 Bipartite Projection & Sparse Matrix Multiplication ($C = M^T M$)
In [`02_build_cooccurrence.py`](file:///G:/Other%20computers/Leon%20PC/_CODE/music%20atlas/pipeline/02_build_cooccurrence.py), we construct the artist-playlist incidence matrix $M \in \mathbb{R}^{P \times N}$ and compute the co-occurrence matrix $C = M^T M$.
- At $N = 1,000$ artists: $C$ has $10^6$ potential elements. Matrix multiplication takes **< 0.05 seconds**.
- At $N = 5,000$ artists: $C$ has $2.5 \times 10^7$ potential elements. Using `scipy.sparse.csr_matrix`, $M^T M$ completes in **~0.3 seconds**.
- At $N = 10,000$ artists: $C$ has $10^8$ potential elements, but with $99.2\%$ sparsity, memory footprint is $< 40$ MB and computation takes **~1.2 seconds**.

### 6.2 ForceAtlas2 Physics Simulation at 10,000 Nodes
In [`05_layout_forceatlas2.py`](file:///G:/Other%20computers/Leon%20PC/_CODE/music%20atlas/pipeline/05_layout_forceatlas2.py), naive force calculation is $O(N^2)$. At $N = 10,000$, $N^2 = 10^8$ operations per step (would take hours).
**Solution: Barnes-Hut Quadtree Approximation ($O(N \log N)$)**:
The `fa2` Python C-extension implements Barnes-Hut spatial quadtrees where far-off clusters are approximated as single centers of mass:
- For $N = 1,000$: 800 iterations take **~4 seconds**.
- For $N = 5,000$: 1,200 iterations take **~25 seconds**.
- For $N = 10,000$: 1,500 iterations with Barnes-Hut $\theta = 1.2$ take **~65 seconds**.

#### Coordinate Space Expansion Table
To preserve visual breathing room and prevent artist overlap:
| Artist Count | Canvas Bounding Range | ForceAtlas2 Scaling Ratio ($s$) | Gravity ($g$) | Min Distance Relaxation |
| :--- | :--- | :--- | :--- | :--- |
| **565 (Current)** | `[-1350, 1350]` | 24.0 | 0.15 | 28.0 px |
| **1,000** | `[-2200, 2200]` | 32.0 | 0.12 | 32.0 px |
| **5,000** | `[-5000, 5000]` | 55.0 | 0.08 | 38.0 px |
| **10,000** | `[-9000, 9000]` | 85.0 | 0.05 | 45.0 px |

### 6.3 Frontend WebGL & Memory Footprint (Sigma.js v3)
Sigma.js v3 is built on WebGL 2.0 with instanced geometry rendering. Nodes and edges are batched into typed `Float32Array` vertex buffers:
- **WebGL Buffer Capacity**: Modern GPUs easily handle $100,000$ vertices in a single draw call. At $N = 10,000$ nodes and $E = 60,000$ edges, Sigma uses approximately 45 MB of VRAM, running at a smooth 60–120 FPS.
- **Bundle File Size**:
  - 1,000 nodes + 7,000 edges: `atlas-graph.json` $\approx 2.4$ MB uncompressed (approx. 450 KB gzipped).
  - 5,000 nodes + 35,000 edges: `atlas-graph.json` $\approx 11$ MB uncompressed (approx. 2.1 MB gzipped).
  - 10,000 nodes + 70,000 edges: `atlas-graph.json` $\approx 22$ MB uncompressed (approx. 4.2 MB gzipped).
- **Hierarchical Label LOD (Level of Detail)**:
  At 10,000 artists, rendering text labels for every node simultaneously would cause severe visual clutter. The label LOD thresholds in [`AtlasCanvas.tsx`](file:///G:/Other%20computers/Leon%20PC/_CODE/music%20atlas/web/src/components/AtlasCanvas.tsx#L370-L377) scale dynamically:
  - **Macro Zoom (Ratio > 0.85)**: Show labels only for Top 50 global anchor superstars (`isHeadliner == true`).
  - **Meso Zoom (0.38 < Ratio <= 0.85)**: Show labels for artists with `popularity >= 82` (~400 artists).
  - **Micro Zoom (Ratio <= 0.38)**: Render labels for all visible artists within the active viewport bounds.

---

## 7. Step-by-Step Implementation Roadmap

```
Phase 1: Credentials & Configuration
  └── Set up Spotify Developer App at developer.spotify.com
  └── Configure environment variables (SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET)

Phase 2: Ingestion Engine Development
  └── Create pipeline/00_fetch_spotify_catalog.py
  └── Implement SpotifyRateLimiter with Client Credentials token refresh
  └── Build subgenre query taxonomy & playlist track harvester
  └── Implement deduplication, popularity filtering, and JSON export

Phase 3: 1,000-Artist Milestone Execution
  └── Run 00_fetch_spotify_catalog.py --target 1000
  └── Execute pipeline steps 01 through 07
  └── Validate co-occurrence, Louvain modularity (11-14 communities), and FA2 layout
  └── Verify WebGL canvas, search bar fly-to, and drawer interactions in browser

Phase 4: Scaling to 5,000 & 10,000 Artists
  └── Expand query matrix with 80+ micro-genres and historical year slices
  └── Expand coordinate bounds to [-9000, 9000] and tune Barnes-Hut theta
  └── Benchmark client bundle compression and zoom LOD performance
```

### Phase 1: Developer Account & Configuration
1. User visits [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and logs in with any free or premium Spotify account.
2. Click **Create App**:
   - App Name: `Music Atlas Ingestion`
   - App Description: `Spatial music graph catalog harvester`
   - Redirect URI: `http://localhost:8080` (placeholder; not used for Client Credentials)
   - Which API/SDKs: **Web API**
3. In app settings, copy:
   - **Client ID**
   - **Client Secret**
4. Store in `pipeline/.env`:
   ```bash
   SPOTIFY_CLIENT_ID="your_spotify_client_id_here"
   SPOTIFY_CLIENT_SECRET="your_spotify_client_secret_here"
   ```

### Phase 2: Ingestion Script (`pipeline/00_fetch_spotify_catalog.py`)
A standalone, robust script accepting CLI arguments:
```bash
python 00_fetch_spotify_catalog.py --target 1000 --min-popularity 35
python 00_fetch_spotify_catalog.py --target 5000 --min-popularity 25
python 00_fetch_spotify_catalog.py --target 10000 --min-popularity 20
```

The script outputs `pipeline/output/catalog_expanded.json` with the exact schema expected by [`01_data_source.py`](file:///G:/Other%20computers/Leon%20PC/_CODE/music%20atlas/pipeline/01_data_source.py):
```json
{
  "artists": [
    {
      "id": "4q3ewBCX7sLwd24euuV69X",
      "name": "Bad Bunny",
      "spotify_id": "4q3ewBCX7sLwd24euuV69X",
      "macro_genre": "Urbano Latino",
      "genres": ["reggaeton", "trap latino", "urbano latino"],
      "popularity": 96,
      "followers": 84200000,
      "image": "https://i.scdn.co/image/ab6761610000e5eb...",
      "spotify_url": "https://open.spotify.com/artist/4q3ewBCX7sLwd24euuV69X"
    }
  ]
}
```

### Phase 3: Verification Protocol
1. **Catalog Balance Check**: Verify that every one of the 11 sectors contains between $6\%$ and $14\%$ of the total artist pool, ensuring no genre starvation.
2. **Graph Connectivity**: Run [`03_normalize_and_sparsify.py`](file:///G:/Other%20computers/Leon%20PC/_CODE/music%20atlas/pipeline/03_normalize_and_sparsify.py) and confirm the giant connected component contains $> 98\%$ of nodes with an average degree between 12 and 18.
3. **WebGL Frame Rate**: Monitor browser devtools FPS counter at 1,000, 5,000, and 10,000 nodes during rapid zoom/pan and node selection.
