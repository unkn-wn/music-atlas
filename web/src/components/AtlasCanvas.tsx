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
  selectedContinentId: number | null;
}

const NodeImageProgram = createNodeImageProgram({
  keepWithinCircle: true,
  drawingMode: 'background',
  objectFit: 'cover',
  imageAttribute: 'image',
  size: { mode: 'max', value: 128 },
  maxTextureSize: 2048,
  debounceTimeout: 150
});

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
  selectedContinentId
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
      labelDensity: 0.22,
      labelGridCellSize: 110,
      labelRenderedSizeThreshold: 8.5,
      minCameraRatio: 0.008,
      maxCameraRatio: 2.2,
      enableEdgeEvents: false,
      allowInvalidContainer: true,
      stagePadding: 80,
      defaultEdgeColor: 'rgba(148, 163, 184, 0.14)',
      defaultNodeColor: '#94a3b8',
      defaultEdgeType: 'curve',
      defaultNodeType: 'circle',
      nodeProgramClasses: {
        circle: NodeCircleProgram,
        image: NodeImageProgram
      },
      edgeProgramClasses: {
        curve: EdgeCurveProgram,
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
          // For general background stars, cap at maximum 35 visible labels per frame
          // to eliminate 2D canvas text layout stuttering during zoom and pan.
          if (!data.isSelected && !data.isNeighbor && renderedLabelCountRef.current >= 35) {
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

        // Proportional hover ring that maintains constant visual distance away from artist circle
        const ringRadius = radius + Math.max(6.0, radius * 0.22);
        context.beginPath();
        context.arc(x, y, ringRadius, 0, Math.PI * 2);
        context.strokeStyle = strokeColor;
        context.lineWidth = Math.max(2.0, radius * 0.08);
        context.stroke();

        // Only draw hover text if the node does not already have a visible label rendered
        if (data.label) return;

        const labelText = data.originalLabel || '';
        if (!labelText) return;
        const size = settings.labelSize || 12;
        const font = settings.labelFont || 'Plus Jakarta Sans, sans-serif';
        context.font = `700 ${size}px ${font}`;
        context.textAlign = 'center';
        context.textBaseline = 'top';

        // Offset label from outer ring edge to avoid visual overlap
        const yOffset = y + ringRadius + 6;

        context.lineWidth = 3.5;
        context.strokeStyle = 'rgba(7, 9, 14, 0.95)';
        context.strokeText(labelText, x, yOffset);

        context.fillStyle = strokeColor;
        context.fillText(labelText, x, yOffset);
      }
    });

    sigma.on('beforeRender', () => {
      collisionGridRef.current.clear();
      renderedLabelCountRef.current = 0;
    });

    // Wire up NodeImageProgram texture manager event so newly downloaded avatar images
    // immediately re-index and display without requiring camera movement or user interaction
    const onNewTexture = () => {
      sigma.refresh();
    };
    const tm = (NodeImageProgram as any).textureManager;
    if (tm && typeof tm.on === 'function') {
      tm.on('newTexture', onNewTexture);
    }

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

    return () => {
      if (tm && typeof tm.off === 'function') {
        tm.off('newTexture', onNewTexture);
      }
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

      // Extract strictly active relative connections (topCrossovers) matching the selection reducer
      const nodeAttrs = graph.getNodeAttributes(nodeId);
      const crossovers = (nodeAttrs.topCrossovers as Array<{ neighborId: string }>) || [];
      const targetIds = [nodeId, ...crossovers.map((c) => c.neighborId)].filter((id) => graph.hasNode(id));
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

    // Resolve all adaptive neighbor IDs (from topCrossovers AND graph edges)
    const neighborIds = new Set<string>();
    let selectedArtistColor = '#38bdf8';
    if (selectedNodeId && graph.hasNode(selectedNodeId)) {
      const nodeAttrs = graph.getNodeAttributes(selectedNodeId);
      selectedArtistColor = (nodeAttrs.color as string) || '#38bdf8';
      const crossovers = (nodeAttrs.topCrossovers as Array<{ neighborId: string }>) || [];
      crossovers.forEach((c) => {
        neighborIds.add(c.neighborId);
      });
      graph.forEachNeighbor(selectedNodeId, (nbr) => {
        neighborIds.add(nbr);
      });
    }

    // Dynamic Edge Reducer (constant, zero zoom thresholds)
    sigma.setSetting('edgeReducer', (edge, data) => {
      const cached = edgeMap.get(edge);
      const src = cached ? cached.src : graph.source(edge);
      const dst = cached ? cached.dst : graph.target(edge);

      // 1. When an artist is selected: illuminate filaments connecting to the adaptive connections
      if (selectedNodeId) {
        const isIncidentToSelected = (src === selectedNodeId && neighborIds.has(dst)) || (dst === selectedNodeId && neighborIds.has(src));

        if (isIncidentToSelected) {
          const isCrossContinent = Boolean(cached && cached.srcCont !== cached.dstCont);
          const isBridge = cached ? cached.isBridge : Boolean(data.isBridge);
          const isDistantCrossover = isBridge || isCrossContinent;

          return {
            ...data,
            hidden: false,
            color: isDistantCrossover ? hexToRgba(selectedArtistColor, 0.35) : selectedArtistColor,
            size: isDistantCrossover ? 0.35 : Math.max(0.6, (cached ? cached.size : 1) * 0.85),
            zIndex: isDistantCrossover ? 6 : 10
          };
        } else {
          return {
            ...data,
            hidden: true
          };
        }
      }

      // 2. Filter by Continent if one is selected
      if (selectedContinentId !== null && cached) {
        if (cached.srcCont !== selectedContinentId && cached.dstCont !== selectedContinentId) {
          return { ...data, hidden: true };
        }
      }

      // 3. Always-visible translucent filaments with constant styling (no zoom thresholds)
      const edgeColor = cached ? cached.color : 'rgba(148, 163, 184, 0.10)';

      return {
        ...data,
        hidden: false,
        color: edgeColor,
        size: Math.max(0.12, (cached ? cached.size : 1) * 0.12)
      };
    });

    // Dynamic Node Reducer (constant, zero zoom thresholds)
    sigma.setSetting('nodeReducer', (node, data) => {
      const continentId = data.continentId as number;
      const originalColor = data.originalColor || data.color;
      const originalLabel = (data.originalLabel || data.label || '') as string;
      const size = (data.originalSize as number) || (data.size as number) || 1.1;

      // Inverted z-index: smaller artists get higher z-index so they remain hoverable/clickable over larger artists
      const invertedZ = Math.max(1, Math.round(100 - (size || 1.1)));
      const hasImage = Boolean(data.image && !data.image.includes('d41d8cd98f00b204e9800998ecf8427e'));

      // 1. When an artist is selected: focal artist and ALL connected peers ALWAYS display image and label
      if (selectedNodeId) {
        if (node === selectedNodeId) {
          return {
            ...data,
            type: hasImage ? 'image' : 'circle',
            size,
            color: originalColor,
            forceLabel: true,
            label: originalLabel,
            isSelected: true,
            isNeighbor: false,
            zIndex: 200
          };
        }

        if (neighborIds.has(node)) {
          return {
            ...data,
            type: hasImage ? 'image' : 'circle',
            size,
            color: originalColor,
            forceLabel: true,
            label: originalLabel,
            isSelected: false,
            isNeighbor: true,
            zIndex: 100 + invertedZ
          };
        }

        // Dim unrelated nodes
        return {
          ...data,
          type: 'circle',
          size: Math.max(0.8, size * 0.6),
          color: hexToRgba('#324155', 0.12),
          label: null,
          forceLabel: false,
          isSelected: false,
          isNeighbor: false,
          zIndex: 0
        };
      }

      // 2. Continent Filtering (Global View)
      if (selectedContinentId !== null && continentId !== selectedContinentId) {
        return {
          ...data,
          type: 'circle',
          size: Math.max(0.8, size * 0.5),
          color: hexToRgba('#324155', 0.08),
          label: null,
          forceLabel: false,
          isSelected: false,
          isNeighbor: false,
          zIndex: 0
        };
      }

      // Only prominent artists render image textures in global view (constant, zero zoom thresholds)
      const isProminent = Boolean(data.isHeadliner || size >= 3.2);

      return {
        ...data,
        type: hasImage && isProminent ? 'image' : 'circle',
        size,
        color: originalColor,
        isSelected: false,
        isNeighbor: false,
        zIndex: invertedZ
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
