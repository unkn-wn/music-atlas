import { useState, useEffect } from 'react';
import Graph from 'graphology';
import { AtlasGraphBundle, AtlasNode } from '../types/atlas';

export function useGraphData() {
  const [data, setData] = useState<AtlasGraphBundle | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
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

        // Add nodes: only prominent headliners/artists load image textures initially (prevents 13k texture blowout)
        bundle.nodes.forEach((node) => {
          const hasImage = Boolean(node.image && !node.image.includes('d41d8cd98f00b204e9800998ecf8427e'));
          const isProminent = Boolean(node.isHeadliner || (node.size && node.size >= 3.2));
          g.addNode(node.id, {
            ...node,
            type: hasImage && isProminent ? 'image' : 'circle',
            originalSize: node.size,
            originalColor: node.color,
            originalLabel: node.label
          });
        });

        // Add edges
        bundle.edges.forEach((edge) => {
          if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
            // Avoid duplicate edges
            if (!g.hasEdge(edge.source, edge.target)) {
              g.addEdge(edge.source, edge.target, {
                ...edge,
                type: 'curve',
                curvature: typeof edge.curvature === 'number' ? edge.curvature : -0.14,
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

  return { data, graph, loading, error };
}
