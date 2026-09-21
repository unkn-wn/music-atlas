import { useState, useEffect, useCallback, useRef } from 'react';
import { AtlasGraphBundle, AtlasNode, AtlasEdge, ArtistDetail } from '../types/atlas';

/**
 * Optimizes Deezer avatar URLs:
 * - Downsamples 1000x1000 avatars to 64x64 thumbnails to prevent GPU texture exhaustion
 * - Strips Deezer default placeholder hash (d41d8cd98f00b204e9800998ecf8427e)
 */
function sanitizeAvatarUrl(url: string | undefined): string {
  if (!url || url.includes('d41d8cd98f00b204e9800998ecf8427e')) return '';
  let clean = url.trim();
  if (clean.startsWith('//')) clean = 'https:' + clean;
  if (clean.includes('dzcdn.net')) {
    clean = clean.replace(/\d+x\d+-/, '64x64-');
  }
  return clean;
}

export function useGraphData() {
  const [data, setData] = useState<AtlasGraphBundle | null>(null);
  const [nodeMap, setNodeMap] = useState<Map<string, AtlasNode>>(new Map());
  const [nodeIndexMap, setNodeIndexMap] = useState<Map<string, number>>(new Map());
  const [continentIndicesMap, setContinentIndicesMap] = useState<Map<number, number[]>>(new Map());
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
        const rawChunk: Record<string, any> = await res.json();
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
        const resp = await fetch('/data/atlas-graph.json');
        if (!resp.ok) {
          throw new Error(`Failed to load atlas-graph.json (status ${resp.status})`);
        }
        const bundle: AtlasGraphBundle = await resp.json();

        // Build quick lookup for continent names
        const continentNames = new Map<number, string>();
        if (bundle.continents) {
          bundle.continents.forEach((c) => continentNames.set(c.id, c.name));
        }

        const nMap = new Map<string, AtlasNode>();
        const nIndexMap = new Map<string, number>();
        const cIndicesMap = new Map<number, number[]>();

        // Sort nodes by size ascending so larger artists have higher indices.
        // In Cosmos WebGL and the GPU picking buffer, higher index = nearer / drawn on top = clickable & hoverable first!
        bundle.nodes.sort((a, b) => ((a.size ?? 1.1) - (b.size ?? 1.1)) || a.id.localeCompare(b.id));

        // Pre-index nodes for O(1) lookups and sanitize avatar URLs
        bundle.nodes.forEach((node, index) => {
          if (!node.continentName) {
            node.continentName = continentNames.get(node.continentId) || '';
          }
          node.image = sanitizeAvatarUrl(node.image);
          nMap.set(node.id, node);
          nIndexMap.set(node.id, index);

          const cList = cIndicesMap.get(node.continentId) || [];
          cList.push(index);
          cIndicesMap.set(node.continentId, cList);
        });

        // Filter valid edges to prevent orphaned link rendering crashes in WebGL
        const validEdges: AtlasEdge[] = [];
        const nbrMap = new Map<string, string[]>();

        bundle.edges.forEach((edge) => {
          if (nMap.has(edge.source) && nMap.has(edge.target)) {
            const sourceIndex = nIndexMap.get(edge.source) ?? 0;
            const targetIndex = nIndexMap.get(edge.target) ?? 0;
            edge.sourceIndex = sourceIndex;
            edge.targetIndex = targetIndex;
            validEdges.push(edge);

            // Populate adjacency list
            const sNbrs = nbrMap.get(edge.source) || [];
            sNbrs.push(edge.target);
            nbrMap.set(edge.source, sNbrs);

            const tNbrs = nbrMap.get(edge.target) || [];
            tNbrs.push(edge.source);
            nbrMap.set(edge.target, tNbrs);
          }
        });

        bundle.edges = validEdges;

        if (isMounted) {
          setData(bundle);
          setNodeMap(nMap);
          setNodeIndexMap(nIndexMap);
          setContinentIndicesMap(cIndicesMap);
          setNeighborMap(nbrMap);
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
    neighborMap,
    detailsMap,
    loading,
    error,
    loadContinentDetails
  };
}
