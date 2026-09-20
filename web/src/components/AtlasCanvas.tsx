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
const avatarPendingCallbacks = new Map<string, Array<() => void>>();
const failedAvatars = new Set<string>();

function getAvatarImage(rawUrl: string | undefined | null, onLoaded?: () => void): HTMLImageElement | null {
  if (!rawUrl || rawUrl.includes('d41d8cd98f00b204e9800998ecf8427e')) return null;
  const url = rawUrl.trim();
  if (failedAvatars.has(url)) return null;

  const cached = avatarCache.get(url);
  if (cached) {
    avatarCache.delete(url);
    avatarCache.set(url, cached);
    if (cached.complete && cached.naturalWidth > 0) {
      return cached;
    }
    if (onLoaded) {
      if (!avatarPendingCallbacks.has(url)) {
        avatarPendingCallbacks.set(url, [onLoaded]);
      }
    }
    return null;
  }

  const img = new Image();
  if (onLoaded) {
    avatarPendingCallbacks.set(url, [onLoaded]);
  }

  img.onload = () => {
    img.onload = null;
    img.onerror = null;
    const callbacks = avatarPendingCallbacks.get(url);
    avatarPendingCallbacks.delete(url);
    if (callbacks) {
      callbacks.forEach((cb) => {
        try { cb(); } catch (_) {}
      });
    }
  };

  img.onerror = () => {
    img.onload = null;
    img.onerror = null;
    avatarPendingCallbacks.delete(url);
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

/**
 * Proportional node sizing algorithm calibrated to reference ground truth:
 * Maps the subscriber power curve from atlas-graph.json (raw 1.1 to 14.5)
 * into authentic screen diameters matching Sigma:
 *   delta = Math.max(0, raw - 1.1)
 *   diameter = 7.0 + delta * 5.0 + Math.pow(delta, 1.55) * 0.42
 *
 * Base / fully zoomed out:
 * - Underground (1k subs, raw 1.1): 7.0px (crisp, elegant starry dots)
 * - 30k subs (Beach Fossils, raw 1.9): 11.3px (clearly visible, not microscopic)
 * - 70k subs (cults, raw 2.5): 14.7px
 * - 300k subs (Beach House, raw 4.1): 24.3px
 * - 900k subs (Cigarettes After Sex, raw 5.9): 35.8px
 * - 3M subs (Gorillaz, raw 8.5): 53.3px
 * - 4M subs (Future, raw 9.1): 57.5px
 * - 24M subs (Drake, raw 14.5): 97.5px (~2x superstar anchor)
 *
 * When zoomed in (~1.7x, matching the Beach House selection screenshot):
 * - Beach Fossils: ~19px
 * - cults: ~25px
 * - Beach House: ~41px (disc) / ~50px (outer ring)
 * - Cigarettes After Sex: ~61px
 * - Gorillaz: ~91px (~2.2x Beach House, exactly matching screenshot)
 * - Drake: ~166px
 */
export function getArtistNodeDiameter(rawSize: number | undefined | null): number {
  const raw = rawSize ?? 1.1;
  const delta = Math.max(0, raw - 1.1);
  return 7.0 + delta * 5.0 + Math.pow(delta, 1.55) * 0.42;
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

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const nodeIndexMapRef = useRef(nodeIndexMap);
  nodeIndexMapRef.current = nodeIndexMap;
  const continentIndicesMapRef = useRef(continentIndicesMap);
  continentIndicesMapRef.current = continentIndicesMap;
  const neighborMapRef = useRef(neighborMap);
  neighborMapRef.current = neighborMap;

  const selectedNodeIdRef = useRef<string | null>(selectedNodeId);
  selectedNodeIdRef.current = selectedNodeId;
  const selectedContinentIdRef = useRef<number | null>(selectedContinentId);
  selectedContinentIdRef.current = selectedContinentId;
  const initialZoomRef = useRef<number | null>(null);
  const hoveredPointIndexRef = useRef<number | null>(null);
  const lastAppliedRef = useRef<{ nodeId: string | null; continentId: number | null }>({
    nodeId: null,
    continentId: null
  });
  const rafIdRef = useRef<number | null>(null);
  const animationRafIdRef = useRef<number | null>(null);
  const scheduleDrawAvatarsRef = useRef<() => void>(() => {});


  const cosmographPoints = React.useMemo(() => {
    return nodes.map((node) => {
      const diameter = getArtistNodeDiameter(node.size);
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

  // Dynamic zoom scale calculator: smoothly scales points up on zoom-in and down on zoom-out
  const getZoomScale = useCallback((cosmo: any) => {
    const currentZoom = cosmo?.getZoomLevel?.();
    if (!currentZoom || !Number.isFinite(currentZoom)) return 1.0;
    if (!initialZoomRef.current || initialZoomRef.current <= 0) {
      initialZoomRef.current = currentZoom;
    }
    const baseZoom = initialZoomRef.current || currentZoom || 0.35;
    const relativeZoom = currentZoom / baseZoom;
    return Math.min(3.5, Math.max(0.6, Math.pow(Math.max(0.2, relativeZoom), 0.45)));
  }, []);

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

    // Keep pointSizeScale in sync on every draw frame
    if (cosmo?._cosmos) {
      const scale = getZoomScale(cosmo);
      if (Math.abs((cosmo._cosmos.config.pointSizeScale ?? 1) - scale) > 0.005) {
        cosmo._cosmos.setConfigPartial({ pointSizeScale: scale });
      }
    }

    const nodes = nodesRef.current;
    const nodeIndexMap = nodeIndexMapRef.current;
    const neighborMap = neighborMapRef.current;

    // Collect IDs of nodes that should display circular avatars:
    const visibleNodeIds = new Set<string>();
    const currentSelectedId = selectedNodeIdRef.current;
    const currentContinent = selectedContinentIdRef.current;
    const cssLabels = cosmo._labels?._cssLabelsRenderer?._cssLabels;

    if (currentSelectedId) {
      // 1. When an artist is selected: STRICTLY AND ONLY the focal artist and their direct qualifying neighbors!
      // All other unconnected artists across all continents are excluded so they remain greyed out background dots.
      visibleNodeIds.add(currentSelectedId);
      const neighbors = neighborMap.get(currentSelectedId);
      if (neighbors) {
        for (const nId of neighbors) {
          visibleNodeIds.add(nId);
        }
      }
    } else {
      // 2. Global / Continent View: show avatars only for visible dynamic labels
      if (cssLabels && cssLabels.size > 0) {
        for (const [id, cssLabel] of cssLabels.entries()) {
          if (typeof cssLabel.getVisibility === 'function' && cssLabel.getVisibility()) {
            if (currentContinent !== null) {
              const idx = nodeIndexMap.get(id);
              if (idx !== undefined && nodes[idx]?.continentId === currentContinent) {
                visibleNodeIds.add(id);
              }
            } else {
              visibleNodeIds.add(id);
            }
          }
        }
      }
      // Immediate fallback: if CSS DOM elements are still resolving after deselect, pull directly from labelDataMap
      if (visibleNodeIds.size === 0 && cosmo._labels?._labelDataMap && cosmo._labels._labelDataMap.size > 0) {
        for (const [id, labelData] of cosmo._labels._labelDataMap.entries()) {
          if (labelData && labelData.index >= 0) {
            const node = nodes[labelData.index];
            if (node) {
              if (currentContinent !== null) {
                if (node.continentId === currentContinent) visibleNodeIds.add(node.id);
              } else {
                visibleNodeIds.add(node.id);
              }
            }
          }
        }
      }
    }

    // 3. Hovered artist (always included so user gets instant hover feedback)
    const hoveredIdx = hoveredPointIndexRef.current;
    if (hoveredIdx !== null && hoveredIdx !== undefined) {
      const hoveredNode = nodes[hoveredIdx];
      if (hoveredNode) {
        visibleNodeIds.add(hoveredNode.id);
      }
    }

    // Draw circular avatars inside node discs for all visible artists
    for (const id of visibleNodeIds) {
      const idx = nodeIndexMap.get(id);
      if (idx === undefined) continue;
      const node = nodes[idx];
      if (!node) continue;

      const screenPos = cosmo.spaceToScreenPosition([node.x, node.y]);
      if (!screenPos) continue;
      const [sx, sy] = screenPos;

      // Cull offscreen points
      if (sx < -100 || sx > width + 100 || sy < -100 || sy > height + 100) continue;

      const cosmoConfig = cosmo._cosmos?.config;
      const zoomScale = cosmoConfig?.pointSizeScale ?? 1.0;
      const diameter = getArtistNodeDiameter(node.size) * zoomScale;
      const radius = diameter / 2;
      const avatarRadius = Math.max(2.0, radius - 1.2);
      const isHovered = hoveredIdx !== null && hoveredIdx !== undefined && nodes[hoveredIdx]?.id === id;

      if (node.image) {
        const img = getAvatarImage(node.image, () => scheduleDrawAvatarsRef.current());
        if (img) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(sx, sy, avatarRadius, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(img, sx - avatarRadius, sy - avatarRadius, avatarRadius * 2, avatarRadius * 2);
          ctx.restore();

          // Crisp border ring around avatar matching artist/continent color (exactly like Sigma)
          ctx.save();
          ctx.beginPath();
          ctx.arc(sx, sy, avatarRadius, 0, Math.PI * 2);
          ctx.strokeStyle = node.color || '#38bdf8';
          ctx.lineWidth = Math.max(1.2, radius * 0.08);
          ctx.stroke();
          ctx.restore();
        }
      }

      // Proportional outer ring for hover and selection in authentic artist continent color
      if (isHovered || id === currentSelectedId) {
        const ringRadius = radius + Math.max(3.0, radius * 0.18);
        ctx.save();
        ctx.beginPath();
        ctx.arc(sx, sy, ringRadius, 0, Math.PI * 2);
        ctx.strokeStyle = node.color || '#38bdf8';
        ctx.lineWidth = Math.max(2.0, radius * 0.08);
        ctx.stroke();
        ctx.restore();
      }

      // Artist name label text beneath hovered or selected node with strong halo outline (only if not already shown by Cosmograph)
      if (isHovered || id === currentSelectedId) {
        const hasCssLabel = cssLabels?.get(id)?.getVisibility() === true;
        const labelText = node.label || '';
        if (labelText && !hasCssLabel) {
          const yOffset = sy + radius + 8;
          ctx.save();
          ctx.font = '700 12px "Plus Jakarta Sans", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.lineWidth = 3.5;
          ctx.strokeStyle = 'rgba(7, 9, 14, 0.95)';
          ctx.strokeText(labelText, sx, yOffset);
          ctx.fillStyle = '#ffffff';
          ctx.fillText(labelText, sx, yOffset);
          ctx.restore();
        }
      }
    }

    ctx.restore();
  }, []);

  const scheduleDrawAvatars = useCallback(() => {
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      drawAvatars();
    });
  }, [drawAvatars]);
  scheduleDrawAvatarsRef.current = scheduleDrawAvatars;

  const runAnimationLoop = useCallback((durationMs: number = 750) => {
    if (animationRafIdRef.current !== null) {
      cancelAnimationFrame(animationRafIdRef.current);
      animationRafIdRef.current = null;
    }
    const startTime = performance.now();
    const tick = () => {
      drawAvatars();
      if (performance.now() - startTime < durationMs) {
        animationRafIdRef.current = requestAnimationFrame(tick);
      } else {
        animationRafIdRef.current = null;
      }
    };
    animationRafIdRef.current = requestAnimationFrame(tick);
  }, [drawAvatars]);

  // Atomic selection state applier: eliminates the white flash by computing incident links synchronously
  // and updating link opacities in the EXACT SAME GPU call as the highlighted link indices
  const applySelectionState = useCallback((targetNodeId: string | null, targetContinentId: number | null = null) => {
    selectedNodeIdRef.current = targetNodeId;
    selectedContinentIdRef.current = targetContinentId;
    const cosmo = cosmographRef.current as any;
    if (!cosmo) return;
    const cosmos = cosmo._cosmos;
    if (!cosmos || !cosmos.graph) return;
    lastAppliedRef.current = { nodeId: targetNodeId, continentId: targetContinentId };

    const nodeIndexMap = nodeIndexMapRef.current;
    const continentIndicesMap = continentIndicesMapRef.current;

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
          linkOpacity: 0.90,
          linkGreyoutOpacity: 0.0,
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
        linkOpacity: 0.18,
        linkGreyoutOpacity: 0.0,
        linkVisibilityMinTransparency: 1.0,
        linkDefaultWidth: 0.8,
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
      // Unselected state: restore delicate translucent filaments (18% opacity, hairline 0.8px, no distance cut)
      cosmos.setConfigPartial({
        highlightedPointIndices: void 0,
        highlightedLinkIndices: void 0,
        linkOpacity: 0.18,
        linkGreyoutOpacity: 0.0,
        linkVisibilityMinTransparency: 1.0,
        linkDefaultWidth: 0.8,
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
        if (cosmo._crossfilter._pointsSelection?.clauses) {
          cosmo._crossfilter._pointsSelection.clauses.length = 0;
        }
        if (cosmo._crossfilter._linksSelection?.clauses) {
          cosmo._crossfilter._linksSelection.clauses.length = 0;
        }
      }
    }

    // Immediately clear stale relation labels from previous selection and re-render for new selection
    if (cosmo._labels) {
      try {
        cosmo._labels._selectedLabelsMap?.clear();
        cosmo._labels._dynamicLabelsMap?.clear();
        cosmo._labels._lastSelectedLabelsKey = -1;
        cosmo._labels._lastDynamicLabelsKey = '';
        cosmo._labels._cssLabelsRenderer?.setLabels([]);
        cosmo._labels._cssLabelsRenderer?.draw();
        void cosmo._labels.render()?.then?.(() => {
          scheduleDrawAvatars();
        }).catch?.(() => {});
      } catch {
        // Safe fallback
      }
    }

    scheduleDrawAvatars();
    setTimeout(scheduleDrawAvatars, 80);
    setTimeout(scheduleDrawAvatars, 250);
  }, [scheduleDrawAvatars]);

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
      pointDefaultSize: 7.0,
      pointShapeBy: 'shape',
      scalePointsOnZoom: false, // Managed via pointSizeScale on zoom for smooth, controlled growth
      fitViewOnInit: true,
      fitViewDelay: 0,
      fitViewDuration: 0,
      showLabels: true,
      showDynamicLabels: true,
      showDynamicLabelsLimit: 80,
      showUnselectedPointLabels: false, // Hides unselected labels during artist selection so visual focus is 100% on focal artist & connections
      pointLabelBy: 'label',
      pointLabelPosition: 'below', // All dynamic labels positioned below artists (zero labels above)
      pointLabelWeightBy: 'size', // Superstars get top priority for labels and avatars
      pointLabelFontSize: 12,
      pointLabelColor: '#ffffff',
      // Interactive on-hover functionality (rendered authentically on 2D canvas matching Sigma)
      renderHoveredPointRing: false,
      showHoveredPointLabel: false,
      hoveredPointCursor: 'pointer',
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
      linkOpacity: 0.18, // Visible, delicate translucent filaments across galaxy
      linkDefaultWidth: 0.8, // Elegant hairline
      scaleLinksOnZoom: false, // Prevents lines from becoming overly thick on zoom
      linkVisibilityDistanceRange: [50000, 50000], // Disables artificial distance culling
      linkVisibilityMinTransparency: 1.0, // Ensures links never fade below linkOpacity
      linkGreyoutOpacity: 0.0, // Clean background dimming when an artist is selected (matches Sigma)
      curvedLinks: false,
      enableSimulation: false, // Freezes precomputed ForceAtlas2 layout
      selectPointOnClick: false, // Managed atomically via applySelectionState to eliminate edge flash
      selectPointOnLabelClick: false, // Managed atomically via applySelectionState to eliminate edge flash
      backgroundColor: '#07090e',
      onZoom: () => {
        const cosmo = cosmographRef.current as any;
        if (cosmo?._cosmos) {
          const scale = getZoomScale(cosmo);
          cosmo._cosmos.setConfigPartial({ pointSizeScale: scale });
          cosmo._cosmos.requestRender();
        }
        scheduleDrawAvatars();
      },
      onZoomEnd: () => {
        const cosmo = cosmographRef.current as any;
        if (cosmo?._cosmos) {
          const scale = getZoomScale(cosmo);
          cosmo._cosmos.setConfigPartial({ pointSizeScale: scale });
          cosmo._cosmos.requestRender();
        }
        scheduleDrawAvatars();
      },
      onDrag: () => {
        scheduleDrawAvatars();
      },
      onClick: (index: number | undefined) => {
        if (index !== undefined) {
          const node = nodesRef.current[index];
          if (node) {
            applySelectionState(node.id);
            onSelectNodeRef.current(node.id);
          }
        } else {
          applySelectionState(null);
          onSelectNodeRef.current(null);
        }
      },
      onLabelClick: (index: number, id: string) => {
        const nMap = nodeIndexMapRef.current;
        const allNodes = nodesRef.current;
        const idx = index !== undefined ? index : (id ? nMap.get(id) : undefined);
        const node = idx !== undefined ? allNodes[idx] : undefined;
        if (node) {
          applySelectionState(node.id);
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

    // Capture initial zoom after Cosmograph's fitViewOnInit completes
    const initialFitTimer = setTimeout(() => {
      if (!isCancelled && cosmographRef.current) {
        const zoom = cosmographRef.current.getZoomLevel();
        if (zoom && zoom > 0) {
          initialZoomRef.current = zoom;
        }
        const cosmo = cosmographRef.current as any;
        if (cosmo?._cosmos) {
          cosmo._cosmos.setConfigPartial({ pointSizeScale: 1.0 });
          cosmo._cosmos.requestRender();
        }
        scheduleDrawAvatars();
      }
    }, 50);

    // Initial avatar draw
    scheduleDrawAvatars();

    return () => {
      isCancelled = true;
      clearTimeout(initialFitTimer);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (animationRafIdRef.current !== null) {
        cancelAnimationFrame(animationRafIdRef.current);
        animationRafIdRef.current = null;
      }
      if (cosmographRef.current === cosmograph) {
        cosmographRef.current = null;
      }
      cosmograph.destroy().catch((err: any) => {
        console.warn('Cosmograph cleanup warning:', err);
      });
    };
  }, [cosmographPoints, cosmographLinks, applySelectionState, scheduleDrawAvatars]);

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
      const cosmo = cosmographRef.current as any;
      if (cosmo?._cosmos) {
        cosmo._cosmos.setConfigPartial({ pointSizeScale: 1.0 });
        cosmo._cosmos.requestRender();
      }
      cosmographRef.current?.fitView(600, 0.1);
      runAnimationLoop(650);
      setTimeout(() => {
        const c = cosmographRef.current;
        if (c) initialZoomRef.current = c.getZoomLevel() || 0.35;
      }, 650);
    },
    flyToNode: (nodeId: string) => {
      const cosmo = cosmographRef.current;
      if (!cosmo) return;
      const index = nodeIndexMapRef.current.get(nodeId);
      if (index === undefined) return;
      cosmo.zoomToPoint(index, 750);
      runAnimationLoop(800);
    }
  }));

  // Synchronize React selection state with Cosmograph GPU shader selection
  useEffect(() => {
    if (
      lastAppliedRef.current.nodeId !== selectedNodeId ||
      lastAppliedRef.current.continentId !== selectedContinentId
    ) {
      applySelectionState(selectedNodeId, selectedContinentId);
    }
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
