import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import Sigma from 'sigma';
import Graph from 'graphology';
import EdgeCurveProgram from '@sigma/edge-curve';
import { createNodeImageProgram } from '@sigma/node-image';
import { NodeCircleProgram, EdgeLineProgram } from 'sigma/rendering';

export interface AtlasCanvasHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  flyToNode: (nodeId: string) => void;
}

interface AtlasCanvasProps {
  graph: Graph | null;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  threshold: number;
  selectedContinentId: number | null;
  sizeMode: 'popularity' | 'degree';
}

const rgbaCache = new Map<string, string>();

function hexToRgba(hex: string, alpha: number): string {
  const key = `${hex}_${alpha.toFixed(2)}`;
  const cached = rgbaCache.get(key);
  if (cached) return cached;

  let result: string;
  if (!hex || hex.charAt(0) !== '#') {
    result = `rgba(148, 163, 184, ${alpha})`;
  } else {
    let clean = hex.slice(1);
    if (clean.length === 3) {
      clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
    }
    const r = parseInt(clean.substring(0, 2), 16) || 148;
    const g = parseInt(clean.substring(2, 4), 16) || 163;
    const b = parseInt(clean.substring(4, 6), 16) || 184;
    result = `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  rgbaCache.set(key, result);
  return result;
}

export const AtlasCanvas = forwardRef<AtlasCanvasHandle, AtlasCanvasProps>(({
  graph,
  selectedNodeId,
  onSelectNode,
  threshold,
  selectedContinentId,
  sizeMode
}, ref) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const zoomTierRef = useRef<'MACRO' | 'MESO' | 'MICRO'>('MACRO');

  // Initialize Sigma v3 with curved edges and image node programs
  useEffect(() => {
    if (!containerRef.current || !graph) return;

    const sigma = new Sigma(graph, containerRef.current, {
      renderEdgeLabels: false,
      labelFont: 'Plus Jakarta Sans, sans-serif',
      labelSize: 12,
      labelWeight: '700',
      labelColor: { color: '#ffffff' },
      labelRenderedSizeThreshold: 6,
      minCameraRatio: 0.05,
      maxCameraRatio: 6.0,
      enableEdgeEvents: false,
      allowInvalidContainer: true,
      stagePadding: 80,
      defaultEdgeColor: 'rgba(148, 163, 184, 0.15)',
      defaultNodeColor: '#94a3b8',
      defaultEdgeType: 'curve',
      defaultNodeType: 'circle',
      nodeProgramClasses: {
        image: createNodeImageProgram(),
        circle: NodeCircleProgram
      },
      edgeProgramClasses: {
        curve: EdgeCurveProgram,
        line: EdgeLineProgram
      },
      defaultDrawNodeLabel: (context: CanvasRenderingContext2D, data: any, settings: any) => {
        if (!data.label) return;
        const size = settings.labelSize || 12;
        const font = settings.labelFont || 'Plus Jakarta Sans, sans-serif';
        const weight = settings.labelWeight || '700';
        context.font = `${weight} ${size}px ${font}`;
        context.textAlign = 'center';
        context.textBaseline = 'top';

        const yOffset = data.y + data.size + 4;

        // Deep halo outline for high contrast against dark cosmos
        context.lineWidth = 3.5;
        context.strokeStyle = 'rgba(7, 9, 14, 0.95)';
        context.strokeText(data.label, data.x, yOffset);

        // Crisp white text fill
        context.fillStyle = '#ffffff';
        context.fillText(data.label, data.x, yOffset);
      },
      defaultDrawNodeHover: (context: CanvasRenderingContext2D, data: any, settings: any) => {
        // Radiant cyan halo around hovered node
        context.beginPath();
        context.arc(data.x, data.y, data.size + 4.0, 0, Math.PI * 2);
        context.strokeStyle = '#38bdf8';
        context.lineWidth = 2.5;
        context.stroke();

        // Label positioned beneath node with highlight color
        if (!data.label) return;
        const size = settings.labelSize || 12;
        const font = settings.labelFont || 'Plus Jakarta Sans, sans-serif';
        context.font = `700 ${size}px ${font}`;
        context.textAlign = 'center';
        context.textBaseline = 'top';

        const yOffset = data.y + data.size + 4;

        context.lineWidth = 3.5;
        context.strokeStyle = 'rgba(7, 9, 14, 0.95)';
        context.strokeText(data.label, data.x, yOffset);

        context.fillStyle = '#38bdf8';
        context.fillText(data.label, data.x, yOffset);
      }
    });

    const camera = sigma.getCamera();
    camera.setState({ x: 0.5, y: 0.5, ratio: 1.2 });

    // Discrete Camera Zoom LOD: updates zoom tier without React re-render cascade
    camera.on('updated', () => {
      const ratio = camera.getState().ratio;
      let nextTier: 'MACRO' | 'MESO' | 'MICRO' = 'MACRO';
      if (ratio < 0.38) nextTier = 'MICRO';
      else if (ratio < 0.85) nextTier = 'MESO';
      else nextTier = 'MACRO';

      if (nextTier !== zoomTierRef.current) {
        zoomTierRef.current = nextTier;
        sigma.refresh();
      }
    });

    sigmaRef.current = sigma;

    // Events: hover sets pointer cursor locally, selection triggers inspector
    sigma.on('enterNode', () => {
      if (containerRef.current) containerRef.current.style.cursor = 'pointer';
    });

    sigma.on('leaveNode', () => {
      if (containerRef.current) containerRef.current.style.cursor = 'grab';
    });

    sigma.on('clickNode', (e) => {
      onSelectNode(e.node);
    });

    sigma.on('clickStage', () => {
      onSelectNode(null);
    });

    return () => {
      sigma.kill();
      sigmaRef.current = null;
    };
  }, [graph]);

  // Expose camera methods via ref
  useImperativeHandle(ref, () => ({
    zoomIn: () => {
      if (!sigmaRef.current) return;
      const camera = sigmaRef.current.getCamera();
      camera.animatedZoom({ duration: 300 });
    },
    zoomOut: () => {
      if (!sigmaRef.current) return;
      const camera = sigmaRef.current.getCamera();
      camera.animatedUnzoom({ duration: 300 });
    },
    resetView: () => {
      if (!sigmaRef.current) return;
      const camera = sigmaRef.current.getCamera();
      camera.animatedReset({ duration: 600 });
    },
    flyToNode: (nodeId: string) => {
      if (!sigmaRef.current || !graph || !graph.hasNode(nodeId)) return;
      const sigma = sigmaRef.current;
      const nodeDisplayData = sigma.getNodeDisplayData(nodeId);
      if (!nodeDisplayData) return;
      const camera = sigma.getCamera();
      camera.animate(
        {
          x: nodeDisplayData.x,
          y: nodeDisplayData.y,
          ratio: 0.38
        },
        { duration: 750 }
      );
    }
  }));

  // Build fast edge lookup map with pre-calculated community colors & low-opacity fadeColors
  const edgeLookupRef = useRef<Map<string, {
    src: string;
    dst: string;
    weight: number;
    srcCont: number;
    dstCont: number;
    size: number;
    color: string;
    fadeColor: string;
  }>>(new Map());

  useEffect(() => {
    if (!graph) return;
    const map = new Map<string, {
      src: string;
      dst: string;
      weight: number;
      srcCont: number;
      dstCont: number;
      size: number;
      color: string;
      fadeColor: string;
    }>();

    graph.forEachEdge((edge, attrs, source, target) => {
      const srcColor = (graph.getNodeAttribute(source, 'color') as string) || (attrs.color as string) || '#94a3b8';
      map.set(edge, {
        src: source,
        dst: target,
        weight: (attrs.weight as number) || 0,
        srcCont: (graph.getNodeAttribute(source, 'continentId') as number) || 0,
        dstCont: (graph.getNodeAttribute(target, 'continentId') as number) || 0,
        size: (attrs.size as number) || 1,
        color: srcColor,
        fadeColor: hexToRgba(srcColor, 0.22)
      });
    });
    edgeLookupRef.current = map;
  }, [graph]);

  // Update Dynamic Reducers (Edge thresholding, top-10 crossover focus mode, and continent filtering)
  useEffect(() => {
    if (!sigmaRef.current || !graph) return;

    const sigma = sigmaRef.current;
    const edgeMap = edgeLookupRef.current;

    // Resolve all incident neighbor IDs when an artist is selected
    const neighborIds = new Set<string>();
    let selectedArtistColor = '#38bdf8';
    if (selectedNodeId && graph.hasNode(selectedNodeId)) {
      const nodeAttrs = graph.getNodeAttributes(selectedNodeId);
      selectedArtistColor = (nodeAttrs.color as string) || '#38bdf8';
      graph.forEachNeighbor(selectedNodeId, (neighbor) => {
        neighborIds.add(neighbor);
      });
    }

    // Dynamic Edge Reducer with Zoom-Tier LOD (faint background filaments -> focused artist-colored relationships on selection)
    sigma.setSetting('edgeReducer', (edge, data) => {
      const cached = edgeMap.get(edge);
      const src = cached ? cached.src : graph.source(edge);
      const dst = cached ? cached.dst : graph.target(edge);
      const weight = cached ? cached.weight : ((data.weight as number) || 0);
      const tier = zoomTierRef.current;

      // 1. When an artist is selected: illuminate ONLY their incident relationship lines in the artist's color!
      if (selectedNodeId) {
        const isIncident = (src === selectedNodeId || dst === selectedNodeId);

        if (isIncident) {
          return {
            ...data,
            hidden: false,
            color: selectedArtistColor, // Artist's community color instead of default blue
            size: Math.max(0.6, (cached ? cached.size : 1) * 0.85),
            zIndex: 10
          };
        } else {
          return {
            ...data,
            hidden: true // Dim all unrelated edges
          };
        }
      }

      // 2. Global View: Filter by user threshold slider
      if (weight < threshold) {
        return {
          ...data,
          hidden: true
        };
      }

      // 3. Filter by Continent if one is selected
      if (selectedContinentId !== null && cached) {
        if (cached.srcCont !== selectedContinentId && cached.dstCont !== selectedContinentId) {
          return { ...data, hidden: true };
        }
      }

      // 4. Subtle, faint cosmic filaments across all zoom levels
      // Unselected lines stay muted/dim so the circles remain the dominant visual focus
      let alpha = 0.04;
      let sizeFactor = 0.12;

      if (tier === 'MICRO') {
        alpha = 0.08;
        sizeFactor = 0.20;
      } else if (tier === 'MESO') {
        alpha = 0.055;
        sizeFactor = 0.15;
      }

      const baseColor = cached ? cached.color : '#94a3b8';
      const edgeColor = hexToRgba(baseColor, alpha);

      return {
        ...data,
        hidden: false,
        color: edgeColor,
        size: Math.max(0.12, (cached ? cached.size : 1) * sizeFactor)
      };
    });

    // Dynamic Node Reducer with Headliner Avatar Medallions & Hierarchical Label LOD
    sigma.setSetting('nodeReducer', (node, data) => {
      const continentId = data.continentId as number;
      const originalColor = data.originalColor || data.color;
      const isHeadliner = Boolean(data.isHeadliner);
      const tier = zoomTierRef.current;

      // Dynamic power-law sizing
      let size: number;
      if (sizeMode === 'degree') {
        const degree = graph.degree(node);
        const degRatio = Math.max(0, Math.min(1, (degree - 4) / 32));
        size = 1.8 + Math.pow(degRatio, 2.2) * 24.0;
      } else {
        const pop = (data.popularity as number) || 50;
        const popRatio = Math.max(0, Math.min(1, (pop - 40) / 60));
        size = 1.8 + Math.pow(popRatio, 2.6) * 26.0;
      }

      // Hierarchical Label Filtering: prevents overlapping collisions at macro zoom
      let showLabel = false;
      if (tier === 'MICRO') {
        showLabel = true;
      } else if (tier === 'MESO') {
        showLabel = isHeadliner || ((data.popularity as number) >= 84);
      } else {
        showLabel = isHeadliner;
      }

      // All nodes with valid portrait photos display as image medallions
      const hasImage = Boolean(data.image && !data.image.includes('d41d8cd98f00b204e9800998ecf8427e'));
      const nodeType = hasImage ? 'image' : 'circle';

      // 1. When an artist is selected: keep natural size (no scale-up), highlight focal artist and relationship peers
      if (selectedNodeId) {
        if (node === selectedNodeId) {
          return {
            ...data,
            type: nodeType,
            size, // Preserve exact same size (no scale-up)
            color: originalColor,
            highlighted: true,
            forceLabel: true,
            label: data.label || '',
            zIndex: 20
          };
        }

        if (neighborIds.has(node)) {
          return {
            ...data,
            type: nodeType,
            size, // Preserve exact same size (no scale-up)
            color: originalColor,
            forceLabel: true,
            label: data.label || '',
            zIndex: 10
          };
        }

        // Dim unrelated nodes into dark cosmos
        return {
          ...data,
          type: 'circle',
          size: Math.max(1.8, size * 0.6),
          color: 'rgba(50, 65, 85, 0.12)',
          label: '',
          zIndex: 0
        };
      }

      // 2. Continent Filtering (Global View)
      if (selectedContinentId !== null && continentId !== selectedContinentId) {
        return {
          ...data,
          type: 'circle',
          size: Math.max(1.8, size * 0.5),
          color: 'rgba(50, 65, 85, 0.08)',
          label: '',
          zIndex: 0
        };
      }

      // 3. Default Global View
      return {
        ...data,
        type: nodeType,
        size,
        color: originalColor,
        label: showLabel ? (data.label || '') : '',
        zIndex: isHeadliner ? 10 : 1
      };
    });

    sigma.refresh();
  }, [graph, selectedNodeId, threshold, selectedContinentId, sizeMode]);

  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100vw', height: '100vh' }}
      className="cursor-grab active:cursor-grabbing outline-none"
    />
  );
});

