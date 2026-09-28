import { useState, useEffect, useCallback, useRef } from 'react';
import { AtlasGraphBundle, AtlasNode, AtlasEdge, ArtistDetail } from '../types/atlas';
import { hslToHex } from '../utils/color';
import { sanitizeAvatarUrl } from '../utils/imageUtils';

export interface ProcessedGraphData {
  bundle: AtlasGraphBundle;
  nodeMap: Map<string, AtlasNode>;
  nodeIndexMap: Map<string, number>;
  continentIndicesMap: Map<number, number[]>;
  sortedGlobalIndices: number[];
  sortedContinentIndices: Map<number, number[]>;
  neighborMap: Map<string, string[]>;
}

// Configurable seed to reroll continent colors deterministically
const CONTINENT_COLOR_SEED = 46;

// Multi-tier palettes combining soft pastel, deep jewel, radiant, and muted tones
const COLOR_TIERS = [
  { s: 55, l: 72 }, // Soft Pastel
  { s: 84, l: 46 }, // Deep Jewel
  { s: 75, l: 62 }, // Radiant Warm
  { s: 58, l: 52 }, // Muted Dusty
];

/**
 * Fetches the atlas graph bundle using streaming gzip decompression with uncompressed fallback.
 */
async function fetchAtlasGraphBundle(): Promise<AtlasGraphBundle> {
  const gzResp = await fetch('/data/atlas-graph.json.gz?v=2');
  if (gzResp.ok) {
    const contentEncoding = gzResp.headers.get('content-encoding');
    if (contentEncoding === 'gzip') {
      return await gzResp.json();
    } else if (typeof DecompressionStream !== 'undefined' && gzResp.body) {
      try {
        const ds = new DecompressionStream('gzip');
        const decompressedStream = gzResp.body.pipeThrough(ds);
        return await new Response(decompressedStream).json();
      } catch {
        return await gzResp.json();
      }
    } else {
      return await gzResp.json();
    }
  }

  const resp = await fetch('/data/atlas-graph.json?v=2');
  if (!resp.ok) {
    throw new Error(`Failed to load atlas-graph data (status ${resp.status})`);
  }
  return await resp.json();
}

/**
 * Processes raw graph bundle into indexed maps, sorted picking buffers, and validated edges.
 */
export function processAtlasGraphBundle(bundle: AtlasGraphBundle): ProcessedGraphData {
  // 1. Assign visually diverse, multi-tonal deterministic colors to continents
  const continentNames = new Map<number, string>();
  const continentColors = new Map<number, string>();

  if (bundle.continents) {
    bundle.continents.forEach((c) => {
      continentNames.set(c.id, c.name);
      const hue = Math.round((c.id * 137.508 + CONTINENT_COLOR_SEED * 83.17) % 360);
      const tier = COLOR_TIERS[(c.id + CONTINENT_COLOR_SEED) % COLOR_TIERS.length];
      const distinctColor = hslToHex(hue, tier.s, tier.l);
      c.color = distinctColor;
      continentColors.set(c.id, distinctColor);
    });
  }

  // 2. Sort nodes by size ascending so larger artists have higher indices.
  // In Cosmos WebGL and the GPU picking buffer, higher index = nearer / drawn on top = clickable & hoverable first!
  bundle.nodes.sort(
    (a, b) => (a.size ?? 1.1) - (b.size ?? 1.1) || a.id.localeCompare(b.id)
  );

  // 3. Pre-index nodes for O(1) lookups and sanitize avatar URLs
  const nodeMap = new Map<string, AtlasNode>();
  const nodeIndexMap = new Map<string, number>();
  const continentIndicesMap = new Map<number, number[]>();

  bundle.nodes.forEach((node, index) => {
    if (!node.continentName) {
      node.continentName = continentNames.get(node.continentId) || '';
    }
    if (continentColors.has(node.continentId)) {
      node.color = continentColors.get(node.continentId)!;
    }
    node.image = sanitizeAvatarUrl(node.image);
    nodeMap.set(node.id, node);
    nodeIndexMap.set(node.id, index);

    const cList = continentIndicesMap.get(node.continentId) || [];
    cList.push(index);
    continentIndicesMap.set(node.continentId, cList);
  });

  // 4. Filter valid edges to prevent orphaned link rendering crashes in WebGL
  const validEdges: AtlasEdge[] = [];
  const neighborMap = new Map<string, string[]>();

  bundle.edges.forEach((edge) => {
    if (nodeMap.has(edge.source) && nodeMap.has(edge.target)) {
      const sourceIndex = nodeIndexMap.get(edge.source) ?? 0;
      const targetIndex = nodeIndexMap.get(edge.target) ?? 0;
      edge.sourceIndex = sourceIndex;
      edge.targetIndex = targetIndex;
      validEdges.push(edge);

      // Populate adjacency list
      const sNbrs = neighborMap.get(edge.source) || [];
      sNbrs.push(edge.target);
      neighborMap.set(edge.source, sNbrs);

      const tNbrs = neighborMap.get(edge.target) || [];
      tNbrs.push(edge.source);
      neighborMap.set(edge.target, tNbrs);
    }
  });

  bundle.edges = validEdges;

  // 5. Pre-sort node indices descending by subscribers for O(1) top-artist filtering
  const sortedGlobalIndices = Array.from({ length: bundle.nodes.length }, (_, i) => i).sort(
    (a, b) => (bundle.nodes[b].subscribers || 0) - (bundle.nodes[a].subscribers || 0)
  );

  const sortedContinentIndices = new Map<number, number[]>();
  continentIndicesMap.forEach((indices, cId) => {
    const sorted = [...indices].sort(
      (a, b) => (bundle.nodes[b].subscribers || 0) - (bundle.nodes[a].subscribers || 0)
    );
    sortedContinentIndices.set(cId, sorted);
  });

  return {
    bundle,
    nodeMap,
    nodeIndexMap,
    continentIndicesMap,
    sortedGlobalIndices,
    sortedContinentIndices,
    neighborMap
  };
}

/**
 * Parses raw continent detail JSON into normalized ArtistDetail records.
 */
export function parseContinentDetails(
  rawChunk: Record<string, any>
): Record<string, ArtistDetail> {
  const chunk: Record<string, ArtistDetail> = {};

  for (const [artistId, detail] of Object.entries(rawChunk)) {
    chunk[artistId] = {
      ...detail,
      topCrossovers: Array.isArray(detail.topCrossovers)
        ? detail.topCrossovers.map((c: any) => {
            if (Array.isArray(c)) {
              return {
                neighborId: c[0],
                cosineSimilarity: c[1],
                sharedPlaylists: c[2],
                crossoverPercent: c[3]
              };
            }
            return c;
          })
        : []
    };
  }

  return chunk;
}

export function useGraphData() {
  const [data, setData] = useState<AtlasGraphBundle | null>(null);
  const [nodeMap, setNodeMap] = useState<Map<string, AtlasNode>>(new Map());
  const [nodeIndexMap, setNodeIndexMap] = useState<Map<string, number>>(new Map());
  const [continentIndicesMap, setContinentIndicesMap] = useState<Map<number, number[]>>(new Map());
  const [sortedGlobalIndices, setSortedGlobalIndices] = useState<number[]>([]);
  const [sortedContinentIndices, setSortedContinentIndices] = useState<Map<number, number[]>>(new Map());
  const [neighborMap, setNeighborMap] = useState<Map<string, string[]>>(new Map());
  const [detailsMap, setDetailsMap] = useState<Record<string, ArtistDetail>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // In-flight fetch deduplication and memory cache for continent details
  const inFlightContinentFetches = useRef(new Map<number, Promise<Record<string, ArtistDetail> | null>>());
  const continentCache = useRef(new Map<number, Record<string, ArtistDetail>>());
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadContinentDetails = useCallback(async (continentId: number) => {
    if (!continentId) return null;
    const cached = continentCache.current.get(continentId);
    if (cached) return cached;

    const inFlight = inFlightContinentFetches.current.get(continentId);
    if (inFlight) return inFlight;

    const fetchPromise = fetch(`/data/details/continent_${continentId}.json`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Status ${res.status}`);
        const rawChunk = await res.json();
        const chunk = parseContinentDetails(rawChunk);

        continentCache.current.set(continentId, chunk);
        if (isMountedRef.current) {
          setDetailsMap((prev) => ({ ...prev, ...chunk }));
        }
        return chunk;
      })
      .catch((err) => {
        console.warn(`Could not load details for continent ${continentId}:`, err);
        const fallback: Record<string, ArtistDetail> = {};
        continentCache.current.set(continentId, fallback);
        return null;
      })
      .finally(() => {
        inFlightContinentFetches.current.delete(continentId);
      });

    inFlightContinentFetches.current.set(continentId, fetchPromise);
    return fetchPromise;
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      try {
        setLoading(true);
        const bundle = await fetchAtlasGraphBundle();
        const processed = processAtlasGraphBundle(bundle);

        if (isMounted) {
          setData(processed.bundle);
          setNodeMap(processed.nodeMap);
          setNodeIndexMap(processed.nodeIndexMap);
          setContinentIndicesMap(processed.continentIndicesMap);
          setSortedGlobalIndices(processed.sortedGlobalIndices);
          setSortedContinentIndices(processed.sortedContinentIndices);
          setNeighborMap(processed.neighborMap);
          setLoading(false);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || 'Error loading atlas data');
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, []);

  return {
    data,
    nodeMap,
    nodeIndexMap,
    continentIndicesMap,
    sortedGlobalIndices,
    sortedContinentIndices,
    neighborMap,
    detailsMap,
    loading,
    error,
    loadContinentDetails
  };
}
