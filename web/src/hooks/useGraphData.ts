import { useState, useEffect } from 'react';
import Graph from 'graphology';
import { AtlasGraphBundle, ArtistDetail } from '../types/atlas';

export function useGraphData() {
  const [data, setData] = useState<AtlasGraphBundle | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [detailsMap, setDetailsMap] = useState<Record<string, ArtistDetail> | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

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

        // Add high-performance straight line edges
        bundle.edges.forEach((edge) => {
          if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
            if (!g.hasEdge(edge.source, edge.target)) {
              g.addEdge(edge.source, edge.target, {
                ...edge,
                type: 'line',
                originalSize: edge.size
              });
            }
          }
        });

        if (isMounted) {
          setData(bundle);
          setGraph(g);
          setLoading(false);
        }

        // Concurrently fetch rich artist details in the background (fail-soft)
        fetch('/data/atlas-details.json')
          .then((res) => {
            if (!res.ok) throw new Error(`Status ${res.status}`);
            return res.json();
          })
          .then((details: Record<string, ArtistDetail>) => {
            if (isMounted) {
              setDetailsMap(details);
            }
          })
          .catch((err) => {
            console.warn("Could not load atlas-details.json in background:", err);
          });

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

  return { data, graph, detailsMap, loading, error };
}

