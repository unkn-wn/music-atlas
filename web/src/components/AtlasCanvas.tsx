import React, { useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from 'react';
import { Cosmograph } from '@cosmograph/cosmograph';
import { AtlasNode, AtlasEdge } from '../types/atlas';

export interface AtlasCanvasHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  flyToNode: (nodeId: string) => void;
}

interface AtlasCanvasProps {
  nodes: AtlasNode[];
  edges: AtlasEdge[];
  nodeIndexMap: Map<string, number>;
  continentIndicesMap: Map<number, number[]>;
  neighborMap: Map<string, string[]>;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  selectedContinentId: number | null;
}

// In-memory avatar image cache for standard no-cors HTML image loading.
// Decoupled from WebGL memory: loads strictly for visible labels (30-80 images max),
// avoiding 403 Forbidden CDN issues and completely eliminating the 21,216px texture atlas crash.
const MAX_CACHED_AVATARS = 500;
const avatarCache = new Map<string, HTMLImageElement>();
const failedAvatars = new Set<string>();

function getAvatarImage(rawUrl: string | undefined | null, onLoaded?: () => void): HTMLImageElement | null {
  if (!rawUrl || rawUrl.includes('d41d8cd98f00b204e9800998ecf8427e')) return null;
  const url = rawUrl.trim();
  if (failedAvatars.has(url)) return null;

  const cached = avatarCache.get(url);
  if (cached) {
    avatarCache.delete(url);
    avatarCache.set(url, cached);
    return cached.complete && cached.naturalWidth > 0 ? cached : null;
  }

  const img = new Image();
  img.onload = () => {
    if (onLoaded) onLoaded();
  };
  img.onerror = () => {
    failedAvatars.add(url);
    avatarCache.delete(url);
  };
  img.src = url;

  if (avatarCache.size >= MAX_CACHED_AVATARS) {
    const oldestKey = avatarCache.keys().next().value;
    if (oldestKey) avatarCache.delete(oldestKey);
  }

  avatarCache.set(url, img);
  return null;
}

export const AtlasCanvas = forwardRef<AtlasCanvasHandle, AtlasCanvasProps>(({
  nodes,
  edges,
  nodeIndexMap,
  continentIndicesMap,
  neighborMap,
  selectedNodeId,
  onSelectNode,
  selectedContinentId
}, ref) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const avatarCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cosmographRef = useRef<Cosmograph | null>(null);
  const onSelectNodeRef = useRef(onSelectNode);
  onSelectNodeRef.current = onSelectNode;

  const selectedNodeIdRef = useRef<string | null>(selectedNodeId);
  selectedNodeIdRef.current = selectedNodeId;
  const hoveredPointIndexRef = useRef<number | null>(null);
  const lastClickedNodeIdRef = useRef<string | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // Authentically restore Sigma's proportional sizing:
  // node.size from atlas-graph.json ranges from 1.1 (underground <= 1k subs) to 14.5 (Drake 24M subs).
  // Linear scaling preserves the authentic dynamic range:
  // - Underground: 1.1 * 3.6 = 3.96px -> clamped to min 4.0px diameter (crisp glowing starry dot)
  // - Metro Boomin (754k subs): 5.6 * 3.6 = 20.2px diameter
  // - Future (4M subs): 9.1 * 3.6 = 32.8px diameter
  // - Drake (24M subs): 14.5 * 3.6 = 52.2px diameter (2.6x Metro Boomin diameter, 6.7x area!)
  // Sized safely under 64px to prevent hardware gl_PointSize GPU clamping on any device.
  const cosmographPoints = React.useMemo(() => {
    return nodes.map((node) => {
      const raw = node.size ?? 1.1;
      const diameter = Math.max(4.0, raw * 3.6);
      return {
        id: node.id,
        label: node.label,
        x: node.x,
        y: node.y,
        size: diameter,
        shape: 0, // 0 = Circle
        color: node.color,
        continentId: node.continentId,
        primaryGenre: node.primaryGenre,
        subscribers: node.subscribers
      };
    });
  }, [nodes]);

  const cosmographLinks = React.useMemo(() => {
    return edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      sourceIndex: edge.sourceIndex ?? nodeIndexMap.get(edge.source) ?? 0,
      targetIndex: edge.targetIndex ?? nodeIndexMap.get(edge.target) ?? 0,
      weight: edge.weight,
      size: edge.size
    }));
  }, [edges, nodeIndexMap]);

  // High-performance 2D avatar renderer strictly synced to visible labels.
  // Draws circular avatars clipped inside the node discs for only visible artists.
  const drawAvatars = useCallback(() => {
    const canvas = avatarCanvasRef.current;
    const cosmo = cosmographRef.current as any;
    if (!canvas || !cosmo) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const expectedWidth = Math.round(width * dpr);
    const expectedHeight = Math.round(height * dpr);
    if (canvas.width !== expectedWidth || canvas.height !== expectedHeight) {
      canvas.width = expectedWidth;
      canvas.height = expectedHeight;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    // Collect IDs of nodes that should display circular avatars:
    // 1. Visible dynamic labels from Cosmograph's CSS label collision renderer
    const visibleNodeIds = new Set<string>();
    const cssLabels = cosmo._labels?._cssLabelsRenderer?._cssLabels;
    if (cssLabels) {
      for (const [id, cssLabel] of cssLabels.entries()) {
        if (typeof cssLabel.getVisibility === 'function' && cssLabel.getVisibility()) {
          visibleNodeIds.add(id);
        }
      }
    }

    // 2. Selected artist and all direct neighbors
    const currentSelectedId = selectedNodeIdRef.current;
    if (currentSelectedId) {
      visibleNodeIds.add(currentSelectedId);
      const neighbors = neighborMap.get(currentSelectedId);
      if (neighbors) {
        for (const nId of neighbors) {
          visibleNodeIds.add(nId);
        }
      }
    }

    // 3. Hovered artist
    const hoveredIdx = hoveredPointIndexRef.current;
    if (hoveredIdx !== null && hoveredIdx !== undefined) {
      const hoveredNode = nodes[hoveredIdx];
      if (hoveredNode) {
        visibleNodeIds.add(hoveredNode.id);
      }
    }

    // Draw circular avatars inside node discs for all visible labels
    for (const id of visibleNodeIds) {
      const idx = nodeIndexMap.get(id);
      if (idx === undefined) continue;
      const node = nodes[idx];
      if (!node || !node.image) continue;

      const screenPos = cosmo.spaceToScreenPosition([node.x, node.y]);
      if (!screenPos) continue;
      const [sx, sy] = screenPos;

      // Cull offscreen points
      if (sx < -100 || sx > width + 100 || sy < -100 || sy > height + 100) continue;

      const diameter = Math.max(4.0, (node.size ?? 1.1) * 3.6);
      const radius = diameter / 2;
      const avatarRadius = Math.max(2.0, radius - 1.2);

      const img = getAvatarImage(node.image, scheduleDrawAvatars);
      if (img) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(sx, sy, avatarRadius, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(img, sx - avatarRadius, sy - avatarRadius, avatarRadius * 2, avatarRadius * 2);
        ctx.restore();
      }

      // Selected artist outer halo ring
      if (id === currentSelectedId) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(sx, sy, radius + 4.0, 0, Math.PI * 2);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.restore();
      }
    }

    ctx.restore();
  }, [nodeIndexMap, neighborMap, nodes]);

  const scheduleDrawAvatars = useCallback(() => {
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      drawAvatars();
    });
  }, [drawAvatars]);

  const runAnimationLoop = useCallback((durationMs: number = 750) => {
    const startTime = performance.now();
    const tick = () => {
      drawAvatars();
      if (performance.now() - startTime < durationMs) {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  }, [drawAvatars]);

  // Atomic selection state applier: eliminates the white flash by computing incident links synchronously
  // and updating link opacities in the EXACT SAME GPU call as the highlighted link indices
  const applySelectionState = useCallback((targetNodeId: string | null, targetContinentId: number | null = null) => {
    const cosmo = cosmographRef.current as any;
    if (!cosmo) return;
    const cosmos = cosmo._cosmos;
    if (!cosmos || !cosmos.graph) return;

    if (targetNodeId) {
      const pointIndex = nodeIndexMap.get(targetNodeId);
      if (pointIndex !== undefined) {
        // 1. Synchronously get all incident links
        const incidentLinks = cosmo._computeIncidentLinks([pointIndex]) ?? [];

        // 2. Synchronously get all neighbor points
        const neighbors = cosmos.graph.getNeighboringPointIndices(pointIndex) ?? [];
        const highlightedPoints = [pointIndex, ...neighbors];

        // 3. Atomically pass both the highlighted indices AND opacity settings together!
        // Because highlightedLinkIndices is applied simultaneously with linkOpacity: 1.0,
        // unhighlighted background links are immediately dimmed to 0.02 with ZERO flash!
        cosmos.setConfigPartial({
          highlightedPointIndices: highlightedPoints,
          highlightedLinkIndices: incidentLinks,
          linkOpacity: 1.0,
          linkGreyoutOpacity: 0.02,
          linkVisibilityMinTransparency: 1.0,
          linkDefaultWidth: 1.4,
        });

        if (cosmo._crossfilter) {
          cosmo._crossfilter._userSelectedPointIndices = new Set(highlightedPoints);
          cosmo._crossfilter._userSelectedLinkIndices = new Set(incidentLinks);
          cosmo._crossfilter._highlightedPointIndices = new Set(highlightedPoints);
          cosmo._crossfilter._highlightedLinkIndices = new Set(incidentLinks);
          cosmo._crossfilter._pointsHighlightActive = true;
          cosmo._crossfilter._linksHighlightActive = true;
          cosmo._crossfilter._pointsUserActive = true;
          cosmo._crossfilter._linksUserActive = true;
        }
      }
    } else if (targetContinentId !== null) {
      const continentIndices = continentIndicesMap.get(targetContinentId) || [];
      cosmos.setConfigPartial({
        highlightedPointIndices: continentIndices,
        highlightedLinkIndices: void 0,
        linkOpacity: 0.28,
        linkGreyoutOpacity: 0.02,
        linkVisibilityMinTransparency: 0.50,
        linkDefaultWidth: 0.9,
      });
      if (cosmo._crossfilter) {
        cosmo._crossfilter._userSelectedPointIndices = new Set(continentIndices);
        cosmo._crossfilter._userSelectedLinkIndices.clear();
        cosmo._crossfilter._highlightedPointIndices = new Set(continentIndices);
        cosmo._crossfilter._highlightedLinkIndices.clear();
        cosmo._crossfilter._pointsHighlightActive = true;
        cosmo._crossfilter._linksHighlightActive = false;
        cosmo._crossfilter._pointsUserActive = true;
        cosmo._crossfilter._linksUserActive = false;
      }
    } else {
      // Unselected state: restore default filament translucency
      cosmos.setConfigPartial({
        highlightedPointIndices: void 0,
        highlightedLinkIndices: void 0,
        linkOpacity: 0.28,
        linkGreyoutOpacity: 0.02,
        linkVisibilityMinTransparency: 0.50,
        linkDefaultWidth: 0.9,
      });
      if (cosmo._crossfilter) {
        cosmo._crossfilter._userSelectedPointIndices.clear();
        cosmo._crossfilter._userSelectedLinkIndices.clear();
        cosmo._crossfilter._highlightedPointIndices.clear();
        cosmo._crossfilter._highlightedLinkIndices.clear();
        cosmo._crossfilter._pointsHighlightActive = false;
        cosmo._crossfilter._linksHighlightActive = false;
        cosmo._crossfilter._pointsUserActive = false;
        cosmo._crossfilter._linksUserActive = false;
      }
    }

    scheduleDrawAvatars();
  }, [nodeIndexMap, continentIndicesMap, scheduleDrawAvatars]);

  // Initialize Cosmograph WebGL2 graph engine
  useEffect(() => {
    if (!containerRef.current || !cosmographPoints.length) return;

    let isCancelled = false;

    // Clean DOM to prevent canvas duplication
    containerRef.current.replaceChildren();

    const cosmograph = new Cosmograph(containerRef.current, {
      points: cosmographPoints,
      links: cosmographLinks,
      pointIdBy: 'id',
      pointXBy: 'x',
      pointYBy: 'y',
      pointColorBy: 'color',
      pointColorStrategy: 'direct', // Preserves exact continent hex colors
      pointSizeBy: 'size',
      pointSizeStrategy: 'direct',
      pointSizeByFn: (val: number) => val,
      pointDefaultSize: 4.0,
      pointShapeBy: 'shape',
      scalePointsOnZoom: false, // SCREEN-SPACE SIZING: Nodes stay consistent screen size, separating on zoom without overlapping
      showLabels: true,
      showDynamicLabels: true,
      showDynamicLabelsLimit: 80,
      pointLabelBy: 'label',
      pointLabelWeightBy: 'size', // Superstars get top priority for labels and avatars
      pointLabelFontSize: 12,
      pointLabelColor: '#ffffff',
      // Interactive on-hover functionality
      renderHoveredPointRing: true,
      hoveredPointRingColor: 'rgba(255, 255, 255, 0.95)',
      showHoveredPointLabel: true,
      hoveredPointCursor: 'pointer',
      hoveredPointLabelClassName: 'cosmograph-hover-label',
      onPointMouseOver: (index: number) => {
        hoveredPointIndexRef.current = index;
        scheduleDrawAvatars();
      },
      onPointMouseOut: () => {
        hoveredPointIndexRef.current = null;
        scheduleDrawAvatars();
      },
      // Hairline crossover edges with screen-space stability
      linkSourceBy: 'source',
      linkTargetBy: 'target',
      linkSourceIndexBy: 'sourceIndex', // Pre-indexed: bypasses 10-second DuckDB WASM INNER JOIN
      linkTargetIndexBy: 'targetIndex', // Pre-indexed: bypasses 10-second DuckDB WASM INNER JOIN
      linkColorInterpolateFromEndpoints: true, // Colors edges using smooth endpoint gradients
      linkDefaultColor: '#94a3b8',
      linkOpacity: 0.28, // Translucent 28% opacity filaments
      linkDefaultWidth: 0.9, // Crisp hairline edges
      scaleLinksOnZoom: false, // Prevents lines from becoming overly thick on zoom
      linkVisibilityDistanceRange: [150, 1500], // Soft distance fade for long cross-screen lines
      linkVisibilityMinTransparency: 0.50, // Guaranteed 50% transparency minimum even across screen
      linkGreyoutOpacity: 0.02, // Clean background dimming when an artist is selected
      curvedLinks: false,
      enableSimulation: false, // Freezes precomputed ForceAtlas2 layout
      selectPointOnClick: false, // Managed atomically via applySelectionState to eliminate edge flash
      selectPointOnLabelClick: false, // Managed atomically via applySelectionState to eliminate edge flash
      backgroundColor: '#07090e',
      onZoom: () => {
        scheduleDrawAvatars();
      },
      onZoomEnd: () => {
        scheduleDrawAvatars();
      },
      onDrag: () => {
        scheduleDrawAvatars();
      },
      onClick: (index: number | undefined) => {
        if (index !== undefined) {
          const node = nodes[index];
          if (node) {
            applySelectionState(node.id);
            lastClickedNodeIdRef.current = node.id;
            onSelectNodeRef.current(node.id);
          }
        } else {
          applySelectionState(null);
          lastClickedNodeIdRef.current = null;
          onSelectNodeRef.current(null);
        }
      },
      onLabelClick: (index: number, id: string) => {
        const node = nodes[index] || (id ? nodes.find((n) => n.id === id) : undefined);
        if (node) {
          applySelectionState(node.id);
          lastClickedNodeIdRef.current = node.id;
          onSelectNodeRef.current(node.id);
        }
      }
    });

    // Hook Cosmograph's internal _labels._renderLabels to keep avatars in sync
    const hookLabels = (l: any) => {
      if (!l || l.__origRenderLabels) return;
      const origRender = l._renderLabels.bind(l);
      l.__origRenderLabels = origRender;
      l._renderLabels = () => {
        origRender();
        scheduleDrawAvatars();
      };
    };

    let currentLabels = (cosmograph as any)._labels;
    if (currentLabels) hookLabels(currentLabels);

    Object.defineProperty(cosmograph, '_labels', {
      configurable: true,
      enumerable: true,
      get() {
        return currentLabels;
      },
      set(val) {
        currentLabels = val;
        hookLabels(val);
      }
    });

    if (!isCancelled) {
      cosmographRef.current = cosmograph;
    }

    // Initial avatar draw
    scheduleDrawAvatars();

    return () => {
      isCancelled = true;
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (cosmographRef.current === cosmograph) {
        cosmographRef.current = null;
      }
      cosmograph.destroy().catch((err: any) => {
        console.warn('Cosmograph cleanup warning:', err);
      });
    };
  }, [cosmographPoints, cosmographLinks, applySelectionState, scheduleDrawAvatars, nodes]);

  // Imperative camera navigation handle
  useImperativeHandle(ref, () => ({
    zoomIn: () => {
      const cosmo = cosmographRef.current;
      if (!cosmo) return;
      const current = cosmo.getZoomLevel() ?? 1;
      cosmo.setZoomLevel(current * 1.4, 300);
      runAnimationLoop(350);
    },
    zoomOut: () => {
      const cosmo = cosmographRef.current;
      if (!cosmo) return;
      const current = cosmo.getZoomLevel() ?? 1;
      cosmo.setZoomLevel(current / 1.4, 300);
      runAnimationLoop(350);
    },
    resetView: () => {
      cosmographRef.current?.fitView(600, 0.1);
      runAnimationLoop(650);
    },
    flyToNode: (nodeId: string) => {
      const cosmo = cosmographRef.current;
      if (!cosmo) return;
      const index = nodeIndexMap.get(nodeId);
      if (index === undefined) return;
      cosmo.zoomToPoint(index, 750);
      runAnimationLoop(800);
    }
  }));

  // Synchronize React selection state with Cosmograph GPU shader selection
  useEffect(() => {
    if (lastClickedNodeIdRef.current !== selectedNodeId) {
      applySelectionState(selectedNodeId, selectedContinentId);
    }
    lastClickedNodeIdRef.current = null;
  }, [selectedNodeId, selectedContinentId, applySelectionState]);

  // Listen to window resizes to update avatar canvas dimensions
  useEffect(() => {
    const handleResize = () => scheduleDrawAvatars();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [scheduleDrawAvatars]);

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: '100vh',
        overflow: 'hidden'
      }}
    >
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%' }}
        className="cursor-grab active:cursor-grabbing outline-none"
      />
      <canvas
        ref={avatarCanvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none'
        }}
      />
    </div>
  );
});
