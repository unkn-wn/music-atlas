import React, { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import Sigma from 'sigma';
import Graph from 'graphology';
import EdgeCurveProgram from '@sigma/edge-curve';
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
  selectedContinentId: number | null;
}

const rgbaCache = new Map<string, string>();
const imageCache = new Map<string, HTMLImageElement>();

function getCachedImage(url: string, onLoaded?: () => void): HTMLImageElement | null {
  if (!url) return null;
  let img = imageCache.get(url);
  if (!img) {
    img = new Image();
    // Do not set crossOrigin to avoid CORS preflight failures across CDNs (Apple Music / Deezer)
    img.onload = () => {
      if (onLoaded) onLoaded();
    };
    img.onerror = () => {
      // Failed image will retain naturalWidth === 0 and fall back to colored circle
    };
    img.src = url;
    imageCache.set(url, img);
  }
  return (img.complete && img.naturalWidth > 0) ? img : null;
}

function drawAvatarImage(
  context: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  x: number,
  y: number,
  radius: number,
  fallbackColor: string
) {
  context.save();
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.closePath();
  context.clip();

  if (img) {
    // 1:1 square crop (object-fit: cover) to prevent aspect ratio distortion
    let sX = 0, sY = 0, sW = img.naturalWidth, sH = img.naturalHeight;
    if (img.naturalWidth > img.naturalHeight) {
      sW = img.naturalHeight;
      sX = (img.naturalWidth - sW) / 2;
    } else if (img.naturalHeight > img.naturalWidth) {
      sH = img.naturalWidth;
      sY = (img.naturalHeight - sH) / 2;
    }
    context.drawImage(img, sX, sY, sW, sH, x - radius, y - radius, radius * 2, radius * 2);
  } else {
    context.fillStyle = fallbackColor;
    context.fill();
  }
  context.restore();
}

function hexToRgba(hex: string, alpha: number): string {
  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  const key = `${hex}_${clampedAlpha.toFixed(2)}`;
  const cached = rgbaCache.get(key);
  if (cached) return cached;

  let r = 148, g = 163, b = 184;
  if (hex && hex.charAt(0) === '#') {
    let clean = hex.slice(1);
    if (clean.length === 3) {
      clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
    }
    if (clean.length >= 6) {
      const parseHexChannel = (s: string, fallback: number) => {
        const v = parseInt(s, 16);
        return Number.isNaN(v) ? fallback : v;
      };
      r = parseHexChannel(clean.substring(0, 2), 148);
      g = parseHexChannel(clean.substring(2, 4), 163);
      b = parseHexChannel(clean.substring(4, 6), 184);
    }
  }

  // WebGL in Sigma uses gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA) (premultiplied alpha).
  // Premultiply RGB channels by alpha so colors render as intended without blowing out additive brightness!
  const pr = Math.round(r * clampedAlpha);
  const pg = Math.round(g * clampedAlpha);
  const pb = Math.round(b * clampedAlpha);
  const result = `rgba(${pr}, ${pg}, ${pb}, ${clampedAlpha})`;
  rgbaCache.set(key, result);
  return result;
}

type ZoomTier = 'FAR' | 'MACRO' | 'MESO' | 'MICRO';

export const AtlasCanvas = forwardRef<AtlasCanvasHandle, AtlasCanvasProps>(({
  graph,
  selectedNodeId,
  onSelectNode,
  selectedContinentId
}, ref) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const zoomTierRef = useRef<ZoomTier>('MACRO');

  // Initialize Sigma v3 with curved edges and circle node programs
  useEffect(() => {
    if (!containerRef.current || !graph) return;

    const sigma = new Sigma(graph, containerRef.current, {
      zIndex: true,
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
      defaultEdgeColor: 'rgba(148, 163, 184, 0.18)',
      defaultNodeColor: '#94a3b8',
      defaultEdgeType: 'curve',
      defaultNodeType: 'circle',
      nodeProgramClasses: {
        circle: NodeCircleProgram
      },
      edgeProgramClasses: {
        curve: EdgeCurveProgram,
        line: EdgeLineProgram
      },
      defaultDrawNodeLabel: (context: CanvasRenderingContext2D, data: any, settings: any) => {
        if (!data.label) return;

        const radius = data.size;
        const x = data.x;
        const y = data.y;
        const strokeColor = data.originalColor || data.color || '#38bdf8';

        // 1. Draw circular avatar image if available
        const hasImage = Boolean(data.image && !data.image.includes('d41d8cd98f00b204e9800998ecf8427e'));
        if (hasImage) {
          const img = getCachedImage(data.image, () => {
            if (sigmaRef.current) {
              sigmaRef.current.scheduleRender();
            }
          });
          drawAvatarImage(context, img, x, y, radius, strokeColor);

          // Inner border ring matching artist's genre color
          context.beginPath();
          context.arc(x, y, radius, 0, Math.PI * 2);
          context.strokeStyle = strokeColor;
          context.lineWidth = Math.max(1.5, radius * 0.12);
          context.stroke();
        }

        // 2. If node is the selected artist, draw prominent outer genre halo ring
        if (data.isSelected) {
          context.beginPath();
          context.arc(x, y, radius + 4.0, 0, Math.PI * 2);
          context.strokeStyle = strokeColor;
          context.lineWidth = 2.5;
          context.stroke();
        }

        // 3. Draw artist name label text beneath avatar with adequate breathing room
        const size = settings.labelSize || 12;
        const font = settings.labelFont || 'Plus Jakarta Sans, sans-serif';
        const weight = settings.labelWeight || '700';
        context.font = `${weight} ${size}px ${font}`;
        context.textAlign = 'center';
        context.textBaseline = 'top';

        const yOffset = y + radius + 8;

        // Deep halo outline for high contrast against dark cosmos
        context.lineWidth = 3.5;
        context.strokeStyle = 'rgba(7, 9, 14, 0.95)';
        context.strokeText(data.label, x, yOffset);

        // Crisp white text fill
        context.fillStyle = '#ffffff';
        context.fillText(data.label, x, yOffset);
      },
      defaultDrawNodeHover: (context: CanvasRenderingContext2D, data: any, settings: any) => {
        const strokeColor = data.originalColor || data.color || '#38bdf8';
        const radius = data.size;
        const x = data.x;
        const y = data.y;

        // 1. Draw circular avatar image if available
        const hasImage = Boolean(data.image && !data.image.includes('d41d8cd98f00b204e9800998ecf8427e'));
        if (hasImage) {
          const img = getCachedImage(data.image, () => {
            if (sigmaRef.current) {
              sigmaRef.current.scheduleRender();
            }
          });
          drawAvatarImage(context, img, x, y, radius, strokeColor);

          // Inner border ring matching genre color
          context.beginPath();
          context.arc(x, y, radius, 0, Math.PI * 2);
          context.strokeStyle = strokeColor;
          context.lineWidth = Math.max(1.5, radius * 0.12);
          context.stroke();
        }

        // 2. Genre/community color halo around hovered node
        context.beginPath();
        context.arc(x, y, radius + 4.0, 0, Math.PI * 2);
        context.strokeStyle = strokeColor;
        context.lineWidth = 2.5;
        context.stroke();

        // 3. Label positioned beneath node with highlight color
        const labelText = data.label || data.originalLabel;
        if (!labelText) return;
        const size = settings.labelSize || 12;
        const font = settings.labelFont || 'Plus Jakarta Sans, sans-serif';
        context.font = `700 ${size}px ${font}`;
        context.textAlign = 'center';
        context.textBaseline = 'top';

        const yOffset = y + radius + 8;

        context.lineWidth = 3.5;
        context.strokeStyle = 'rgba(7, 9, 14, 0.95)';
        context.strokeText(labelText, x, yOffset);

        context.fillStyle = strokeColor;
        context.fillText(labelText, x, yOffset);
      }
    });

    const camera = sigma.getCamera();
    camera.setState({ x: 0.5, y: 0.5, ratio: 1.2 });

    // Ensure WebGL hoverNodes layer renders behind 2D labels and hovers canvases so color fill stays behind avatar images
    const hoverNodes = containerRef.current.querySelector('.sigma-hoverNodes');
    const labels = containerRef.current.querySelector('.sigma-labels');
    if (labels && hoverNodes) labels.before(hoverNodes);

    // Discrete Camera Zoom LOD: updates zoom tier matching label & image visibility
    camera.on('updated', () => {
      const ratio = camera.getState().ratio;
      let nextTier: ZoomTier = 'MACRO';
      if (ratio < 0.38) nextTier = 'MICRO';
      else if (ratio < 0.85) nextTier = 'MESO';
      else if (ratio <= 1.4) nextTier = 'MACRO';
      else nextTier = 'FAR';

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
      sigmaRef.current = null;
      sigma.kill();
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
          ratio: 0.58
        },
        { duration: 750 }
      );
    }
  }));

  // Build fast edge lookup map with pre-calculated community colors
  const edgeLookupRef = useRef<Map<string, {
    src: string;
    dst: string;
    srcCont: number;
    dstCont: number;
    size: number;
    color: string;
  }>>(new Map());

  useEffect(() => {
    if (!graph) return;
    const map = new Map<string, {
      src: string;
      dst: string;
      srcCont: number;
      dstCont: number;
      size: number;
      color: string;
    }>();

    graph.forEachEdge((edge, attrs, source, target) => {
      const srcColor = (graph.getNodeAttribute(source, 'color') as string) || (attrs.color as string) || '#94a3b8';
      map.set(edge, {
        src: source,
        dst: target,
        srcCont: (graph.getNodeAttribute(source, 'continentId') as number) || 0,
        dstCont: (graph.getNodeAttribute(target, 'continentId') as number) || 0,
        size: (attrs.size as number) || 1,
        color: srcColor
      });
    });
    edgeLookupRef.current = map;
  }, [graph]);

  // Update Dynamic Reducers (Edge thresholding, top-10 crossover focus mode, and continent filtering)
  useEffect(() => {
    if (!sigmaRef.current || !graph) return;

    const sigma = sigmaRef.current;
    const edgeMap = edgeLookupRef.current;

    // Resolve all incident neighbor IDs matching the sidebar relationships when an artist is selected
    const neighborIds = new Set<string>();
    let selectedArtistColor = '#38bdf8';
    if (selectedNodeId && graph.hasNode(selectedNodeId)) {
      const nodeAttrs = graph.getNodeAttributes(selectedNodeId);
      selectedArtistColor = (nodeAttrs.color as string) || '#38bdf8';
      const crossovers = (nodeAttrs.topCrossovers as Array<{ neighborId: string }>) || [];
      crossovers.slice(0, 10).forEach((c) => {
        neighborIds.add(c.neighborId);
      });
    }

    // Dynamic Edge Reducer with Zoom-Tier LOD (faint background filaments -> focused artist-colored relationships on selection)
    sigma.setSetting('edgeReducer', (edge, data) => {
      const cached = edgeMap.get(edge);
      const src = cached ? cached.src : graph.source(edge);
      const dst = cached ? cached.dst : graph.target(edge);
      const tier = zoomTierRef.current;

      // 1. When an artist is selected: illuminate ONLY lines connecting to the exact same relationships shown in the sidebar!
      if (selectedNodeId) {
        const isIncidentToSelected = (src === selectedNodeId && neighborIds.has(dst)) || (dst === selectedNodeId && neighborIds.has(src));

        if (isIncidentToSelected) {
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

      // 2. Filter by Continent if one is selected
      if (selectedContinentId !== null && cached) {
        if (cached.srcCont !== selectedContinentId && cached.dstCont !== selectedContinentId) {
          return { ...data, hidden: true };
        }
      }

      // 3. Subtle, luminous translucent filaments across all zoom levels
      // Slightly lower transparency (higher alpha) for clearer visibility and luminosity
      let alpha = 0.18;
      let sizeFactor = 0.20;

      if (tier === 'MICRO') {
        alpha = 0.30;
        sizeFactor = 0.28;
      } else if (tier === 'MESO') {
        alpha = 0.24;
        sizeFactor = 0.24;
      } else if (tier === 'FAR') {
        alpha = 0.12;
        sizeFactor = 0.16;
      }

      const baseColor = cached ? cached.color : '#94a3b8';
      const edgeColor = hexToRgba(baseColor, alpha);

      return {
        ...data,
        hidden: false,
        color: edgeColor,
        size: Math.max(0.18, (cached ? cached.size : 1) * sizeFactor)
      };
    });

    // Dynamic Node Reducer: All nodes render as fast WebGL circles, while canvas draws avatar and label together in lockstep
    sigma.setSetting('nodeReducer', (node, data) => {
      const continentId = data.continentId as number;
      const originalColor = data.originalColor || data.color;
      const originalLabel = (data.originalLabel || data.label || '') as string;
      const size = (data.originalSize as number) || (data.size as number) || 2.5;
      const tier = zoomTierRef.current;

      // 1. When an artist is selected: keep natural size (no scale-up), highlight focal artist and relationship peers
      // Selected artist and direct neighbors ALWAYS display their image portraits and names
      if (selectedNodeId) {
        if (node === selectedNodeId) {
          return {
            ...data,
            type: 'circle',
            size, // Preserve exact same size (no scale-up)
            color: originalColor,
            forceLabel: true,
            label: originalLabel,
            isSelected: true,
            zIndex: 20
          };
        }

        if (neighborIds.has(node)) {
          return {
            ...data,
            type: 'circle',
            size: Math.min(18.0, Math.max(8.0, size * 0.72)), // Balanced orbital relationship badge size
            color: originalColor,
            forceLabel: true,
            label: originalLabel,
            isSelected: false,
            zIndex: 10
          };
        }

        // Dim unrelated nodes into dark cosmos (label: null ensures Sigma's labelGrid excludes them)
        return {
          ...data,
          type: 'circle',
          size: Math.max(1.8, size * 0.6),
          color: hexToRgba('#324155', 0.12),
          label: null,
          forceLabel: false,
          isSelected: false,
          zIndex: 0
        };
      }

      // 2. Continent Filtering (Global View)
      if (selectedContinentId !== null && continentId !== selectedContinentId) {
        return {
          ...data,
          type: 'circle',
          size: Math.max(1.8, size * 0.5),
          color: hexToRgba('#324155', 0.08),
          label: null,
          forceLabel: false,
          isSelected: false,
          zIndex: 0
        };
      }

      // 3. Global Constellation View:
      // In FAR tier (zoomed all the way out), no labels or images (pure starry constellation)
      if (tier === 'FAR') {
        return {
          ...data,
          type: 'circle',
          size,
          color: originalColor,
          label: null,
          forceLabel: false,
          isSelected: false,
          zIndex: 1
        };
      }

      // Default Global View: Sigma's native labelGrid + labelRenderedSizeThreshold automatically
      // selects which artists are displayed based on continuous zoom ratio.
      // defaultDrawNodeLabel renders the avatar image and name together in lockstep!
      return {
        ...data,
        type: 'circle',
        size,
        color: originalColor,
        label: originalLabel,
        forceLabel: false,
        isSelected: false,
        zIndex: data.isHeadliner ? 10 : 1
      };
    });

    sigma.refresh();
  }, [graph, selectedNodeId, selectedContinentId]);

  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100vw', height: '100vh' }}
      className="cursor-grab active:cursor-grabbing outline-none"
    />
  );
});

