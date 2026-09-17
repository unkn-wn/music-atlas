import { useState, useEffect, useCallback, useRef } from 'react';
import Graph from 'graphology';
import { AtlasGraphBundle, ArtistDetail } from '../types/atlas';
import { hexToRgba } from '../utils/color';

export function useGraphData() {
  const [data, setData] = useState<AtlasGraphBundle | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
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
        const chunk: Record<string, ArtistDetail> = await res.json();
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

        // Instantiate in-memory Graphology graph
        const g = new Graph({ type: 'undirected', multi: false });

        // Add nodes: all nodes rendered as circles in WebGL
        bundle.nodes.forEach((node) => {
          g.addNode(node.id, {
            ...node,
            type: 'circle',
            originalImage: node.image,
            originalSize: node.size,
            originalColor: node.color,
            originalLabel: node.label
          });
        });

        // Add high-performance straight line edges with precomputed layout attributes
        bundle.edges.forEach((edge) => {
          if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
            if (!g.hasEdge(edge.source, edge.target)) {
              const srcColor = (g.getNodeAttribute(edge.source, 'color') as string) || '#94a3b8';
              const srcCont = (g.getNodeAttribute(edge.source, 'continentId') as number) || 0;
              const dstCont = (g.getNodeAttribute(edge.target, 'continentId') as number) || 0;

              g.addEdge(edge.source, edge.target, {
                ...edge,
                type: 'line',
                originalSize: edge.size || 1,
                srcCont,
                dstCont,
                defaultColor: hexToRgba(srcColor, 0.12)
              });
            }
          }
        });

        // Free edge objects from bundle before setting React state to prevent double-retention in memory
        bundle.edges = [];

        if (isMounted) {
          setData(bundle);
          setGraph(g);
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

  return { data, graph, detailsMap, loading, error, loadContinentDetails };
}

