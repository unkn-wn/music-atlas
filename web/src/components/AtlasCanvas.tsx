import React, { useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from 'react';
import { Cosmograph } from '@cosmograph/cosmograph';
import { AtlasNode, AtlasEdge } from '../types/atlas';
import {
  getArtistNodeDiameter,
  getZoomScale,
  applyZoomLimits,
  hookCosmographLabels
} from './canvas/canvasUtils';
import { applyCosmographSelection } from './canvas/canvasSelection';
import { renderCanvasOverlay } from './canvas/canvasOverlay';

export { getArtistNodeDiameter };

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
  sortedGlobalIndices: number[];
  sortedContinentIndices: Map<number, number[]>;
  neighborMap: Map<string, string[]>;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  selectedContinentId: number | null;
  densityRange: [number, number] | null;
  connectionPercentile?: number;
  onReady?: () => void;
}

export const AtlasCanvas = React.memo(
  forwardRef<AtlasCanvasHandle, AtlasCanvasProps>(
    (
      {
        nodes,
        edges,
        nodeIndexMap,
        continentIndicesMap,
        sortedGlobalIndices,
        sortedContinentIndices,
        neighborMap,
        selectedNodeId,
        onSelectNode,
        selectedContinentId,
        densityRange,
        connectionPercentile = 0,
        onReady
      },
      ref
    ) => {
      const containerRef = useRef<HTMLDivElement | null>(null);
      const avatarCanvasRef = useRef<HTMLCanvasElement | null>(null);
      const cosmographRef = useRef<Cosmograph | null>(null);

      const onSelectNodeRef = useRef(onSelectNode);
      onSelectNodeRef.current = onSelectNode;
      const onReadyRef = useRef(onReady);
      onReadyRef.current = onReady;

      const nodesRef = useRef(nodes);
      nodesRef.current = nodes;
      const edgesRef = useRef(edges);
      edgesRef.current = edges;
      const nodeIndexMapRef = useRef(nodeIndexMap);
      nodeIndexMapRef.current = nodeIndexMap;
      const continentIndicesMapRef = useRef(continentIndicesMap);
      continentIndicesMapRef.current = continentIndicesMap;
      const sortedGlobalIndicesRef = useRef(sortedGlobalIndices);
      sortedGlobalIndicesRef.current = sortedGlobalIndices;
      const sortedContinentIndicesRef = useRef(sortedContinentIndices);
      sortedContinentIndicesRef.current = sortedContinentIndices;
      const neighborMapRef = useRef(neighborMap);
      neighborMapRef.current = neighborMap;

      const selectedNodeIdRef = useRef<string | null>(selectedNodeId);
      selectedNodeIdRef.current = selectedNodeId;
      const selectedContinentIdRef = useRef<number | null>(selectedContinentId);
      selectedContinentIdRef.current = selectedContinentId;
      const densityRangeRef = useRef<[number, number] | null>(densityRange);
      densityRangeRef.current = densityRange;
      const connectionPercentileRef = useRef<number>(connectionPercentile);
      connectionPercentileRef.current = connectionPercentile;

      const activeFilterSetRef = useRef<Set<number> | null>(null);
      const initialZoomRef = useRef<number>(1.0);
      const hoveredPointIndexRef = useRef<number | null>(null);
      const lastAppliedRef = useRef<{
        nodeId: string | null;
        continentId: number | null;
        rangeKey: string | null;
        connectionPercentile: number;
      }>({
        nodeId: null,
        continentId: null,
        rangeKey: null,
        connectionPercentile: 0
      });

      // Pre-sort edge shared playlist counts ascending for instant O(1) percentile cutoff lookup
      const sortedEdgePlaylists = React.useMemo(() => {
        const list = new Uint16Array(edges.length);
        for (let i = 0; i < edges.length; i++) {
          list[i] = edges[i].playlists ?? 1;
        }
        list.sort();
        return list;
      }, [edges]);
      const sortedEdgePlaylistsRef = useRef(sortedEdgePlaylists);
      sortedEdgePlaylistsRef.current = sortedEdgePlaylists;

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
          size: edge.size,
          playlists: edge.playlists ?? 1
        }));
      }, [edges, nodeIndexMap]);

      // Pre-index links by continent so continent selection illuminates all lines inside and connected to that continent
      const continentLinksMap = React.useMemo(() => {
        const map = new Map<number, number[]>();
        const addEdge = (continentId: number, edgeIdx: number) => {
          let list = map.get(continentId);
          if (!list) {
            list = [];
            map.set(continentId, list);
          }
          list.push(edgeIdx);
        };

        for (let i = 0; i < edges.length; i++) {
          const edge = edges[i];
          const sIdx = edge.sourceIndex ?? nodeIndexMap.get(edge.source);
          const tIdx = edge.targetIndex ?? nodeIndexMap.get(edge.target);
          if (sIdx === undefined || tIdx === undefined) continue;
          const sNode = nodes[sIdx];
          const tNode = nodes[tIdx];
          if (!sNode || !tNode) continue;

          if (sNode.continentId) {
            addEdge(sNode.continentId, i);
          }
          if (tNode.continentId && tNode.continentId !== sNode.continentId) {
            addEdge(tNode.continentId, i);
          }
        }
        return map;
      }, [edges, nodes, nodeIndexMap]);
      const continentLinksMapRef = useRef(continentLinksMap);
      continentLinksMapRef.current = continentLinksMap;

      // Helper to determine if a node qualifies under the currently active filter or continent
      const isNodeQualifying = useCallback(
        (nodeId: string, nodeIndex?: number): boolean => {
          const idx =
            nodeIndex !== undefined && nodeIndex >= 0
              ? nodeIndex
              : nodeIndexMapRef.current.get(nodeId);
          if (idx === undefined) return false;

          const activeFilter = activeFilterSetRef.current;
          if (activeFilter && !activeFilter.has(idx)) return false;

          const currentContinent = selectedContinentIdRef.current;
          if (currentContinent !== null) {
            const node = nodesRef.current[idx];
            if (!node || node.continentId !== currentContinent) return false;
          }
          return true;
        },
        []
      );
      const isNodeQualifyingRef = useRef(isNodeQualifying);
      isNodeQualifyingRef.current = isNodeQualifying;

      // High-performance 2D avatar renderer strictly synced to visible labels
      const drawAvatars = useCallback(() => {
        const canvas = avatarCanvasRef.current;
        const cosmo = cosmographRef.current;
        if (!canvas || !cosmo) return;

        renderCanvasOverlay({
          canvas,
          cosmo,
          nodes: nodesRef.current,
          nodeIndexMap: nodeIndexMapRef.current,
          neighborMap: neighborMapRef.current,
          selectedNodeId: selectedNodeIdRef.current,
          hoveredPointIndex: hoveredPointIndexRef.current,
          isNodeQualifying: isNodeQualifyingRef.current,
          scheduleDrawAvatars: scheduleDrawAvatarsRef.current
        });
      }, []);

      const scheduleDrawAvatars = useCallback(() => {
        if (rafIdRef.current !== null) return;
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null;
          drawAvatars();
        });
      }, [drawAvatars]);
      scheduleDrawAvatarsRef.current = scheduleDrawAvatars;

      const runAnimationLoop = useCallback(
        (durationMs: number = 750) => {
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
        },
        [drawAvatars]
      );

      // Atomic selection state applier
      const applySelectionState = useCallback(
        (
          targetNodeId: string | null,
          targetContinentId: number | null = null,
          targetDensityRange: [number, number] | null = null,
          targetConnectionPercentile: number = 0
        ) => {
          selectedNodeIdRef.current = targetNodeId;
          selectedContinentIdRef.current = targetContinentId;
          densityRangeRef.current = targetDensityRange;
          connectionPercentileRef.current = targetConnectionPercentile;

          const targetRangeKey = targetDensityRange
            ? `${targetDensityRange[0]}-${targetDensityRange[1]}`
            : null;
          lastAppliedRef.current = {
            nodeId: targetNodeId,
            continentId: targetContinentId,
            rangeKey: targetRangeKey,
            connectionPercentile: targetConnectionPercentile
          };

          const result = applyCosmographSelection(
            cosmographRef.current,
            {
              targetNodeId,
              targetContinentId,
              targetDensityRange,
              targetConnectionPercentile,
              nodeIndexMap: nodeIndexMapRef.current,
              continentIndicesMap: continentIndicesMapRef.current,
              sortedGlobalIndices: sortedGlobalIndicesRef.current,
              sortedContinentIndices: sortedContinentIndicesRef.current,
              edges: edgesRef.current,
              nodes: nodesRef.current,
              sortedEdgePlaylists: sortedEdgePlaylistsRef.current,
              continentLinksMap: continentLinksMapRef.current
            },
            scheduleDrawAvatarsRef.current
          );

          activeFilterSetRef.current = result.activeFilterSet;
        },
        []
      );

      // Initialize Cosmograph WebGL2 graph engine
      useEffect(() => {
        if (!containerRef.current || !cosmographPoints.length) return;

        let isCancelled = false;

        // Clean DOM to prevent canvas duplication
        containerRef.current.replaceChildren();

        const isMobileView = typeof window !== 'undefined' && window.innerWidth < 768;
        const clampedPixelRatio = Math.min(window.devicePixelRatio || 1, isMobileView ? 1.5 : 2.0);

        const cosmograph = new Cosmograph(containerRef.current, {
          points: cosmographPoints,
          links: cosmographLinks,
          pixelRatio: clampedPixelRatio,
          pointIdBy: 'id',
          pointXBy: 'x',
          pointYBy: 'y',
          pointColorBy: 'color',
          pointColorStrategy: 'direct',
          pointSizeBy: 'size',
          pointSizeStrategy: 'direct',
          pointSizeByFn: (val: number) => val,
          pointDefaultSize: 7.0,
          pointShapeBy: 'shape',
          scalePointsOnZoom: false,
          fitViewOnInit: true,
          fitViewDelay: 0,
          fitViewDuration: 0,
          showLabels: true,
          showDynamicLabels: true,
          showDynamicLabelsLimit: isMobileView ? 35 : 80,
          showUnselectedPointLabels: false,
          pointLabelBy: 'label',
          pointLabelPosition: 'below',
          pointLabelWeightBy: 'size',
          pointLabelFontSize: 12,
          pointLabelColor: '#ffffff',
          renderHoveredPointRing: false,
          showHoveredPointLabel: false,
          hoveredPointCursor: 'pointer',
          onPointMouseOver: (index: number) => {
            if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
            hoveredPointIndexRef.current = index;
            scheduleDrawAvatars();
          },
          onPointMouseOut: () => {
            if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
            hoveredPointIndexRef.current = null;
            scheduleDrawAvatars();
          },
          linkSourceBy: 'source',
          linkTargetBy: 'target',
          linkSourceIndexBy: 'sourceIndex',
          linkTargetIndexBy: 'targetIndex',
          linkColorInterpolateFromEndpoints: true,
          linkDefaultColor: '#94a3b8',
          linkOpacity: 0.1,
          linkDefaultWidth: 0.8,
          scaleLinksOnZoom: false,
          linkVisibilityDistanceRange: [50000, 50000],
          linkVisibilityMinTransparency: 1.0,
          linkGreyoutOpacity: 0.0,
          curvedLinks: false,
          enableSimulation: false,
          selectPointOnClick: false,
          selectPointOnLabelClick: false,
          resetSelectionOnEmptyCanvasClick: false,
          backgroundColor: '#07090e',
          onZoom: () => {
            const cosmo = cosmographRef.current as any;
            if (cosmo?._cosmos) {
              applyZoomLimits(cosmo);
              const scale = getZoomScale(cosmo);
              cosmo._cosmos.setConfigPartial({ pointSizeScale: scale });
              cosmo._cosmos.requestRender();
            }
            scheduleDrawAvatars();
          },
          onZoomEnd: () => {
            const cosmo = cosmographRef.current as any;
            if (cosmo?._cosmos) {
              applyZoomLimits(cosmo);
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
              if (node && isNodeQualifyingRef.current(node.id, index)) {
                applySelectionState(
                  node.id,
                  selectedContinentIdRef.current,
                  densityRangeRef.current,
                  connectionPercentileRef.current
                );
                onSelectNodeRef.current(node.id);
                return;
              }
            }
            applySelectionState(
              null,
              selectedContinentIdRef.current,
              densityRangeRef.current,
              connectionPercentileRef.current
            );
            onSelectNodeRef.current(null);
          }
        });

        // Intercept Cosmograph labels with dynamic getter for live qualification state
        hookCosmographLabels(
          cosmograph,
          () => isNodeQualifyingRef.current,
          () => scheduleDrawAvatarsRef.current()
        );

        if (!isCancelled) {
          cosmographRef.current = cosmograph;
        }

        let fitAttempts = 0;
        let initialFitTimer: any = null;
        const checkFit = () => {
          if (isCancelled || !cosmographRef.current) return;
          const cosmo = cosmographRef.current as any;
          if (cosmo?._cosmos?.zoomInstance?.behavior) {
            initialZoomRef.current = 1.0;
            applyZoomLimits(cosmo, 1.0);

            const scale = getZoomScale(cosmo);
            cosmo._cosmos.setConfigPartial({ pointSizeScale: scale });
            cosmo._cosmos.requestRender();
            scheduleDrawAvatars();
            requestAnimationFrame(() => {
              onReadyRef.current?.();
            });
          } else if (fitAttempts < 25) {
            fitAttempts++;
            initialFitTimer = setTimeout(checkFit, 50);
          } else {
            onReadyRef.current?.();
          }
        };
        initialFitTimer = setTimeout(checkFit, 50);

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
      useImperativeHandle(
        ref,
        () => ({
          zoomIn: () => {
            const cosmo = cosmographRef.current as any;
            if (!cosmo) return;
            const current = cosmo.getZoomLevel() ?? 1;
            const extent = cosmo._cosmos?.zoomInstance?.behavior?.scaleExtent?.() ?? [0.005, 15];
            const next = Math.min(extent[1], current * 1.4);
            cosmo.setZoomLevel(next, 300);
            runAnimationLoop(350);
          },
          zoomOut: () => {
            const cosmo = cosmographRef.current as any;
            if (!cosmo) return;
            const current = cosmo.getZoomLevel() ?? 1;
            const extent = cosmo._cosmos?.zoomInstance?.behavior?.scaleExtent?.() ?? [0.005, 15];
            const next = Math.max(extent[0], current / 1.4);
            cosmo.setZoomLevel(next, 300);
            runAnimationLoop(350);
          },
          resetView: () => {
            cosmographRef.current?.fitView(600, 0.1);
            runAnimationLoop(650);
            setTimeout(() => {
              const c = cosmographRef.current as any;
              if (c?._cosmos) {
                initialZoomRef.current = 1.0;
                applyZoomLimits(c, 1.0);
                const scale = getZoomScale(c);
                c._cosmos.setConfigPartial({ pointSizeScale: scale });
                c._cosmos.requestRender();
                scheduleDrawAvatars();
              }
            }, 650);
          },
          flyToNode: (nodeId: string) => {
            const cosmo = cosmographRef.current as any;
            if (!cosmo) return;
            const index = nodeIndexMapRef.current.get(nodeId);
            if (index === undefined) return;
            const isMobile = window.innerWidth < 768;
            const cosmos = cosmo._cosmos;

            if (isMobile && cosmos?.zoomInstance?.behavior && cosmos?.canvasD3Selection) {
              const node = nodesRef.current[index];
              if (node) {
                const bottomSheetH = 180;
                const targetScale = Math.max(1.8, Math.min(3.5, (cosmo.getZoomLevel?.() ?? 1) * 2.2));
                const t = cosmos.zoomInstance.getTransform([node.x, node.y], targetScale);
                if (t && Number.isFinite(t.y)) {
                  t.y -= Math.round(bottomSheetH / 2);
                  cosmos.zoomInstance.shouldEnableSimulationDuringZoomOverride = false;
                  cosmos.canvasD3Selection
                    .transition()
                    .duration(750)
                    .call(cosmos.zoomInstance.behavior.transform, t);
                  runAnimationLoop(800);
                  return;
                }
              }
            }

            cosmo.zoomToPoint(index, 750);
            runAnimationLoop(800);
          }
        }),
        [runAnimationLoop]
      );

      // Synchronize React selection state with Cosmograph GPU shader selection
      const rangeKey = densityRange ? `${densityRange[0]}-${densityRange[1]}` : null;
      useEffect(() => {
        if (
          lastAppliedRef.current.nodeId !== selectedNodeId ||
          lastAppliedRef.current.continentId !== selectedContinentId ||
          lastAppliedRef.current.rangeKey !== rangeKey ||
          lastAppliedRef.current.connectionPercentile !== connectionPercentile
        ) {
          applySelectionState(selectedNodeId, selectedContinentId, densityRange, connectionPercentile);
        }
      }, [
        selectedNodeId,
        selectedContinentId,
        rangeKey,
        densityRange,
        connectionPercentile,
        applySelectionState
      ]);

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
            overflow: 'hidden',
            touchAction: 'none',
            zIndex: 0
          }}
        >
          <div
            ref={containerRef}
            style={{ width: '100%', height: '100%', touchAction: 'none' }}
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
              pointerEvents: 'none',
              zIndex: 10
            }}
          />
        </div>
      );
    }
  )
);

AtlasCanvas.displayName = 'AtlasCanvas';
