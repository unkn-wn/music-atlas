import React, { useEffect, useRef, useImperativeHandle, forwardRef, useState, useMemo } from 'react';
import Sigma from 'sigma';
import Graph from 'graphology';
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
  hoveredContinentId?: number | null;
}

function optimizeAvatarUrl(rawUrl: string): string {
  let url = rawUrl.trim();
  if (url.startsWith('//')) {
    url = 'https:' + url;
  }
  if (url.includes('dzcdn.net')) {
    return url.replace(/\d+x\d+-/, '64x64-');
  }
  if (url.includes('i.scdn.co/image/ab6761610000e5eb')) {
    return url.replace('ab6761610000e5eb', 'ab6761610000f178');
  }
  return url;
}

const MAX_CACHED_AVATARS = 500;
const avatarCache = new Map<string, HTMLImageElement>();
const failedAvatars = new Set<string>();

function getAvatarImage(rawUrl: string | undefined | null, onLoaded?: () => void): HTMLImageElement | null {
  if (!rawUrl || rawUrl.includes('d41d8cd98f00b204e9800998ecf8427e')) return null;
  const url = optimizeAvatarUrl(rawUrl);
  if (failedAvatars.has(url)) return null;

  const cached = avatarCache.get(url);
  if (cached) {
    // Refresh LRU order: re-insert so it becomes the most recently used
    avatarCache.delete(url);
    avatarCache.set(url, cached);
    return cached.complete && cached.naturalWidth > 0 ? cached : null;
  }

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    if (onLoaded) onLoaded();
  };
  img.onerror = () => {
    failedAvatars.add(url);
    avatarCache.delete(url);
  };
  img.src = url;

  // Evict least-recently-used (oldest) entry if exceeding capacity
  if (avatarCache.size >= MAX_CACHED_AVATARS) {
    const oldestKey = avatarCache.keys().next().value;
    if (oldestKey) avatarCache.delete(oldestKey);
  }

  avatarCache.set(url, img);
  return null;
}

const rgbaCache = new Map<string, string>();

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

  // WebGL premultiplied alpha
  const pr = Math.round(r * clampedAlpha);
  const pg = Math.round(g * clampedAlpha);
  const pb = Math.round(b * clampedAlpha);
  const result = `rgba(${pr}, ${pg}, ${pb}, ${clampedAlpha})`;
  rgbaCache.set(key, result);
  return result;
}


interface LabelBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

class ScreenLabelCollisionGrid {
  private cellSize = 75;
  private grid = new Map<string, LabelBox[]>();

  clear() {
    this.grid.clear();
  }

  private getKeys(box: LabelBox): string[] {
    const minC = Math.floor(box.minX / this.cellSize);
    const maxC = Math.floor(box.maxX / this.cellSize);
    const minR = Math.floor(box.minY / this.cellSize);
    const maxR = Math.floor(box.maxY / this.cellSize);
    const keys: string[] = [];
    for (let c = minC; c <= maxC; c++) {
      for (let r = minR; r <= maxR; r++) {
        keys.push(`${c},${r}`);
      }
    }
    return keys;
  }

  collides(box: LabelBox): boolean {
    const keys = this.getKeys(box);
    for (const k of keys) {
      const cell = this.grid.get(k);
      if (cell) {
        for (const existing of cell) {
          if (
            box.minX < existing.maxX &&
            box.maxX > existing.minX &&
            box.minY < existing.maxY &&
            box.maxY > existing.minY
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }

  insert(box: LabelBox) {
    const keys = this.getKeys(box);
    for (const k of keys) {
      let cell = this.grid.get(k);
      if (!cell) {
        cell = [];
        this.grid.set(k, cell);
      }
      cell.push(box);
    }
  }
}

export const AtlasCanvas = forwardRef<AtlasCanvasHandle, AtlasCanvasProps>(({
  graph,
  selectedNodeId,
  onSelectNode,
  selectedContinentId,
  hoveredContinentId = null
}, ref) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const collisionGridRef = useRef(new ScreenLabelCollisionGrid());
  const renderedLabelCountRef = useRef(0);

  // Stale closure prevention: store latest onSelectNode in ref
  const onSelectNodeRef = useRef(onSelectNode);
  onSelectNodeRef.current = onSelectNode;

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
      labelDensity: 0.35,
      labelGridCellSize: 90,
      labelRenderedSizeThreshold: 8.5,
      minCameraRatio: 0.008,
      maxCameraRatio: 2.2,
      doubleClickZoomingRatio: 1,
      enableEdgeEvents: false,
      allowInvalidContainer: true,
      stagePadding: 80,
      defaultEdgeColor: 'rgba(148, 163, 184, 0.14)',
      defaultNodeColor: '#94a3b8',
      defaultEdgeType: 'line',
      defaultNodeType: 'circle',
      nodeProgramClasses: {
        circle: NodeCircleProgram
      },
      edgeProgramClasses: {
        line: EdgeLineProgram
      },
      defaultDrawNodeLabel: (context: CanvasRenderingContext2D, data: any, settings: any) => {
        const radius = data.size;
        const x = data.x;
        const y = data.y;
        const strokeColor = data.originalColor || data.color || '#38bdf8';

        // Selected artist outer halo ring
        if (data.isSelected) {
          context.beginPath();
          context.arc(x, y, radius + 4.0, 0, Math.PI * 2);
          context.strokeStyle = strokeColor;
          context.lineWidth = 2.5;
          context.stroke();
        }

        // Reserve circular node footprint in the collision grid so text never covers nearby discs
        collisionGridRef.current.insert({
          minX: x - radius - 3,
          maxX: x + radius + 3,
          minY: y - radius - 3,
          maxY: y + radius + 3
        });

        // Artist name label text beneath node with strict Screen-Space Collision Detection
        if (data.label) {
          // Label budget: Selected node and direct neighbors are ALWAYS rendered!
          // For general background stars, cap at maximum 100 visible labels per frame
          // to eliminate 2D canvas text layout stuttering during zoom and pan.
          if (!data.isSelected && !data.isNeighbor && renderedLabelCountRef.current >= 100) {
            return;
          }

          const size = settings.labelSize || 12;
          const font = settings.labelFont || 'Plus Jakarta Sans, sans-serif';
          const weight = settings.labelWeight || '700';
          context.font = `${weight} ${size}px ${font}`;

          const textWidth = context.measureText(data.label).width;
          const yOffset = y + radius + 8;
          const padX = 8;
          const padY = 4;

          const labelBox: LabelBox = {
            minX: x - textWidth / 2 - padX,
            maxX: x + textWidth / 2 + padX,
            minY: yOffset - padY,
            maxY: yOffset + size + padY
          };

          // Selected node and direct connections ALWAYS render their labels!
          if (!data.isSelected && !data.isNeighbor && collisionGridRef.current.collides(labelBox)) {
            return; // Cleanly suppress colliding background label text
          }

          collisionGridRef.current.insert(labelBox);
          renderedLabelCountRef.current += 1;

          // 1:1 Avatar Rendering: Render avatar strictly when its label is rendered!
          const rawImageUrl = data.originalImage || data.image;
          const img = getAvatarImage(rawImageUrl, () => {
            sigmaRef.current?.scheduleRender();
          });

          if (img) {
            context.save();
            context.beginPath();
            context.arc(x, y, radius, 0, Math.PI * 2);
            context.closePath();
            context.clip();

            // Center-crop (object-fit: cover)
            const nw = img.naturalWidth;
            const nh = img.naturalHeight;
            const minDim = Math.min(nw, nh);
            const sx = (nw - minDim) / 2;
            const sy = (nh - minDim) / 2;
            context.drawImage(img, sx, sy, minDim, minDim, x - radius, y - radius, radius * 2, radius * 2);
            context.restore();

            // Crisp border ring around the avatar matching artist/continent color
            context.beginPath();
            context.arc(x, y, radius, 0, Math.PI * 2);
            context.strokeStyle = strokeColor;
            context.lineWidth = Math.max(1.2, radius * 0.08);
            context.stroke();
          }

          context.textAlign = 'center';
          context.textBaseline = 'top';

          // Halo outline for high contrast
          context.lineWidth = 3.5;
          context.strokeStyle = 'rgba(7, 9, 14, 0.95)';
          context.strokeText(data.label, x, yOffset);

          // Text fill
          context.fillStyle = '#ffffff';
          context.fillText(data.label, x, yOffset);
        }
      },
      defaultDrawNodeHover: (context: CanvasRenderingContext2D, data: any, settings: any) => {
        const strokeColor = data.originalColor || data.color || '#38bdf8';
        const radius = data.size;
        const x = data.x;
        const y = data.y;

        // 1. Draw Artist Picture (Avatar) - strictly at natural node radius (no enlargement)
        const rawImageUrl = data.originalImage || data.image;
        const img = getAvatarImage(rawImageUrl, () => {
          sigmaRef.current?.scheduleRender();
        });

        if (img) {
          context.save();
          context.beginPath();
          context.arc(x, y, radius, 0, Math.PI * 2);
          context.closePath();
          context.clip();

          // Center-crop (object-fit: cover)
          const nw = img.naturalWidth;
          const nh = img.naturalHeight;
          const minDim = Math.min(nw, nh);
          const sx = (nw - minDim) / 2;
          const sy = (nh - minDim) / 2;
          context.drawImage(img, sx, sy, minDim, minDim, x - radius, y - radius, radius * 2, radius * 2);
          context.restore();

          // Crisp border ring around avatar matching artist/continent color
          context.beginPath();
          context.arc(x, y, radius, 0, Math.PI * 2);
          context.strokeStyle = strokeColor;
          context.lineWidth = Math.max(1.2, radius * 0.08);
          context.stroke();
        }

        // 2. Proportional outer hover ring
        const ringRadius = radius + Math.max(3.0, radius * 0.18);
        context.beginPath();
        context.arc(x, y, ringRadius, 0, Math.PI * 2);
        context.strokeStyle = strokeColor;
        context.lineWidth = Math.max(2.0, radius * 0.08);
        context.stroke();

        // 3. Artist name label text beneath hovered node
        const labelText = data.originalLabel || data.label || '';
        if (labelText) {
          const size = settings.labelSize || 12;
          const font = settings.labelFont || 'Plus Jakarta Sans, sans-serif';
          const weight = settings.labelWeight || '700';
          context.font = `${weight} ${size}px ${font}`;

          const yOffset = y + radius + 8;

          context.textAlign = 'center';
          context.textBaseline = 'top';

          // Strong halo outline for high contrast
          context.lineWidth = 3.5;
          context.strokeStyle = 'rgba(7, 9, 14, 0.95)';
          context.strokeText(labelText, x, yOffset);

          // Crisp white text
          context.fillStyle = '#ffffff';
          context.fillText(labelText, x, yOffset);
        }
      }
    });

    sigma.on('beforeRender', () => {
      collisionGridRef.current.clear();
      renderedLabelCountRef.current = 0;
    });

    const camera = sigma.getCamera();
    camera.setState({ x: 0.5, y: 0.5, ratio: 1.0 });

    const hoverNodes = containerRef.current.querySelector('.sigma-hoverNodes');
    const labels = containerRef.current.querySelector('.sigma-labels');
    if (labels && hoverNodes) labels.before(hoverNodes);

    sigmaRef.current = sigma;

    // Events using onSelectNodeRef to prevent stale closures
    sigma.on('enterNode', () => {
      if (containerRef.current) containerRef.current.style.cursor = 'pointer';
    });

    sigma.on('leaveNode', () => {
      if (containerRef.current) containerRef.current.style.cursor = 'grab';
    });

    sigma.on('clickNode', (e) => {
      onSelectNodeRef.current(e.node);
    });

    sigma.on('clickStage', () => {
      onSelectNodeRef.current(null);
    });

    // Natively suppress Sigma default double-click and double-tap zoom
    sigma.getMouseCaptor().on('doubleClick', (e) => {
      e.preventSigmaDefault();
    });

    sigma.getTouchCaptor().on('doubletap', (e) => {
      e.preventSigmaDefault();
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
      camera.animate({ x: 0.5, y: 0.5, ratio: 1.0 }, { duration: 600 });
    },
    flyToNode: (nodeId: string) => {
      if (!sigmaRef.current || !graph || !graph.hasNode(nodeId)) return;
      const sigma = sigmaRef.current;
      const nodeDisplayData = sigma.getNodeDisplayData(nodeId);
      if (!nodeDisplayData) return;

      // Extract focal node and its active graph neighbors
      const targetIds = [nodeId, ...graph.neighbors(nodeId)];
      const targetDisplayData = targetIds
        .map((id) => sigma.getNodeDisplayData(id))
        .filter(Boolean);

      let minX = nodeDisplayData.x;
      let maxX = nodeDisplayData.x;
      let minY = nodeDisplayData.y;
      let maxY = nodeDisplayData.y;

      for (const d of targetDisplayData) {
        if (!d) continue;
        if (d.x < minX) minX = d.x;
        if (d.x > maxX) maxX = d.x;
        if (d.y < minY) minY = d.y;
        if (d.y > maxY) maxY = d.y;
      }

      const spanX = maxX - minX;
      const spanY = maxY - minY;
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;

      const container = containerRef.current;
      const width = container?.clientWidth || window.innerWidth;
      const height = container?.clientHeight || window.innerHeight;
      const isDesktop = width >= 768;
      const drawerWidth = isDesktop ? 408 : 0;
      const availWidth = Math.max(300, width - drawerWidth);

      let targetRatio: number;
      if (spanX < 0.001 && spanY < 0.001) {
        targetRatio = 0.035;
      } else {
        const ratioForX = (spanX * 1.35) * (height / availWidth);
        const ratioForY = spanY * 1.35;
        targetRatio = Math.max(0.015, Math.min(1.0, Math.max(ratioForX, ratioForY)));
      }

      // Shift camera center dynamically so relative connections are centered in visible stage to the left of the drawer
      const shiftX = (drawerWidth / (2 * height)) * targetRatio;
      const adjustedCenterX = centerX + shiftX;

      const camera = sigma.getCamera();
      camera.animate(
        {
          x: adjustedCenterX,
          y: centerY,
          ratio: targetRatio
        },
        { duration: 750 }
      );
    }
  }));

  // Build fast edge lookup map with constant styling (zero-allocation per frame, zero zoom thresholds)
  const edgeLookupRef = useRef<Map<string, {
    src: string;
    dst: string;
    srcCont: number;
    dstCont: number;
    size: number;
    weight: number;
    isBridge: boolean;
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
      weight: number;
      isBridge: boolean;
      color: string;
    }>();

    graph.forEachEdge((edge, attrs, source, target) => {
      const srcColor = (graph.getNodeAttribute(source, 'color') as string) || (attrs.color as string) || '#94a3b8';
      const weight = (attrs.weight as number) || 0.5;

      map.set(edge, {
        src: source,
        dst: target,
        srcCont: (graph.getNodeAttribute(source, 'continentId') as number) || 0,
        dstCont: (graph.getNodeAttribute(target, 'continentId') as number) || 0,
        size: (attrs.size as number) || 1,
        weight,
        isBridge: Boolean(attrs.isBridge),
        color: hexToRgba(srcColor, 0.12)
      });
    });
    edgeLookupRef.current = map;
  }, [graph]);

  // Update Dynamic Reducers (Edge thresholding, adaptive crossover focus mode, and continent filtering)
  useEffect(() => {
    if (!sigmaRef.current || !graph) return;

    const sigma = sigmaRef.current;
    const edgeMap = edgeLookupRef.current;

    // Resolve all active neighbor IDs from graph edges
    const neighborIds = new Set<string>();
    let selectedArtistColor = '#38bdf8';
    if (selectedNodeId && graph.hasNode(selectedNodeId)) {
      const nodeAttrs = graph.getNodeAttributes(selectedNodeId);
      selectedArtistColor = (nodeAttrs.color as string) || '#38bdf8';
      graph.forEachNeighbor(selectedNodeId, (nbr) => {
        neighborIds.add(nbr);
      });
    }

    // Dynamic Edge Reducer (constant, zero zoom thresholds)
    sigma.setSetting('edgeReducer', (edge, data) => {
      const cached = edgeMap.get(edge);
      const src = cached ? cached.src : graph.source(edge);
      const dst = cached ? cached.dst : graph.target(edge);

      // 1. When an artist is selected: illuminate only incident edges, hide all background edges to eliminate lag and white glare
      if (selectedNodeId) {
        const isIncidentToSelected = src === selectedNodeId || dst === selectedNodeId;

        if (isIncidentToSelected) {
          const isCrossContinent = Boolean(cached && cached.srcCont !== cached.dstCont);
          const isBridge = cached ? cached.isBridge : Boolean(data.isBridge);
          const isDistantCrossover = isBridge || isCrossContinent;

          data.hidden = false;
          data.color = isDistantCrossover ? hexToRgba(selectedArtistColor, 0.5) : selectedArtistColor;
          data.size = isDistantCrossover ? 0.5 : Math.max(0.7, (cached ? cached.size : 1) * 0.9);
          data.zIndex = isDistantCrossover ? 6 : 10;
          return data;
        }

        data.hidden = true;
        return data;
      }

      // 2. Filter by Continent if one is selected
      if (selectedContinentId !== null && cached) {
        if (cached.srcCont !== selectedContinentId && cached.dstCont !== selectedContinentId) {
          data.hidden = true;
          return data;
        }
      }

      // 3. Always-visible translucent filaments with constant styling (no zoom thresholds)
      const edgeColor = cached ? cached.color : 'rgba(148, 163, 184, 0.10)';

      data.hidden = false;
      data.color = edgeColor;
      data.size = Math.max(0.12, (cached ? cached.size : 1) * 0.12);
      return data;
    });

    // Dynamic Node Reducer (constant, zero zoom thresholds, zero buffer thrashing)
    sigma.setSetting('nodeReducer', (node, data) => {
      const continentId = data.continentId as number;
      const originalColor = data.originalColor || data.color;
      const originalLabel = (data.originalLabel || data.label || '') as string;
      const size = (data.originalSize as number) || (data.size as number) || 1.1;

      // Inverted z-index: smaller artists get higher z-index so they remain hoverable/clickable over larger artists
      const invertedZ = Math.max(1, Math.round(100 - (size || 1.1)));
      const originalImage = (data.originalImage || data.image || '') as string;

      data.type = 'circle';
      data.originalImage = originalImage;
      data.image = originalImage;

      // 1. When an artist is selected: focal artist and connected peers display image and label
      if (selectedNodeId) {
        if (node === selectedNodeId) {
          data.size = size;
          data.color = originalColor;
          data.forceLabel = true;
          data.label = originalLabel;
          data.isSelected = true;
          data.isNeighbor = false;
          data.zIndex = 200;
          return data;
        }

        if (neighborIds.has(node)) {
          data.size = size;
          data.color = originalColor;
          data.forceLabel = true;
          data.label = originalLabel;
          data.isSelected = false;
          data.isNeighbor = true;
          data.zIndex = 100 + invertedZ;
          return data;
        }

        // Unselected background nodes
        data.size = size;
        data.color = hexToRgba(originalColor, 0.20);
        data.label = null;
        data.forceLabel = false;
        data.isSelected = false;
        data.isNeighbor = false;
        data.zIndex = 0;
        return data;
      }

      // 2. Continent Filtering (Global View)
      if (selectedContinentId !== null && continentId !== selectedContinentId) {
        data.size = size;
        data.color = hexToRgba('#324155', 0.08);
        data.label = null;
        data.forceLabel = false;
        data.isSelected = false;
        data.isNeighbor = false;
        data.zIndex = 0;
        return data;
      }

      // 3. Global Default View
      data.size = size;
      data.color = originalColor;
      data.label = originalLabel;
      data.forceLabel = false;
      data.isSelected = false;
      data.isNeighbor = false;
      data.zIndex = invertedZ;
      return data;
    });

    sigma.refresh();
  }, [graph, selectedNodeId, selectedContinentId]);

  // Continent centroids for zero-overhead HTML pseudo-glow on hover (no WebGL redraws)
  const continentCenters = useMemo(() => {
    if (!graph) return new Map<number, { x: number; y: number; color: string }>();
    const sums = new Map<number, { sumX: number; sumY: number; count: number; color: string }>();
    graph.forEachNode((_node, attrs) => {
      const cId = attrs.continentId as number;
      if (!cId) return;
      const entry = sums.get(cId) || { sumX: 0, sumY: 0, count: 0, color: (attrs.color as string) || '#10b981' };
      entry.sumX += (attrs.x as number) || 0;
      entry.sumY += (attrs.y as number) || 0;
      entry.count += 1;
      sums.set(cId, entry);
    });
    const centers = new Map<number, { x: number; y: number; color: string }>();
    sums.forEach((val, cId) => {
      if (val.count > 0) {
        centers.set(cId, { x: val.sumX / val.count, y: val.sumY / val.count, color: val.color });
      }
    });
    return centers;
  }, [graph]);

  const [glowPos, setGlowPos] = useState<{ x: number; y: number; color: string } | null>(null);

  useEffect(() => {
    if (hoveredContinentId === null || !hoveredContinentId || !sigmaRef.current) {
      setGlowPos(null);
      return;
    }
    const center = continentCenters.get(hoveredContinentId);
    if (!center) {
      setGlowPos(null);
      return;
    }
    const vp = sigmaRef.current.graphToViewport({ x: center.x, y: center.y });
    setGlowPos({ x: vp.x, y: vp.y, color: center.color });
  }, [hoveredContinentId, continentCenters]);

  return (
    <div
      ref={containerRef}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100vw', height: '100vh', overflow: 'hidden' }}
      className="cursor-grab active:cursor-grabbing outline-none"
    >
      {/* Zero-overhead ambient CSS pseudo-glow highlighting continent location on hover */}
      {glowPos && (
        <div
          style={{
            position: 'absolute',
            left: `${glowPos.x}px`,
            top: `${glowPos.y}px`,
            transform: 'translate(-50%, -50%)',
            width: '280px',
            height: '280px',
            borderRadius: '50%',
            background: `radial-gradient(circle, ${glowPos.color}44 0%, ${glowPos.color}15 45%, transparent 70%)`,
            pointerEvents: 'none',
            zIndex: 15,
            transition: 'all 0.15s ease-out'
          }}
        />
      )}
    </div>
  );
});
