import { AtlasNode, AtlasEdge } from '../../types/atlas';

export interface SelectionStateParams {
  targetNodeId: string | null;
  targetContinentId: number | null;
  targetDensityRange: [number, number] | null;
  targetConnectionPercentile: number;
  nodeIndexMap: Map<string, number>;
  continentIndicesMap: Map<number, number[]>;
  sortedGlobalIndices: number[];
  sortedContinentIndices: Map<number, number[]>;
  edges: AtlasEdge[];
  nodes: AtlasNode[];
  sortedEdgePlaylists: Uint16Array;
  continentLinksMap: Map<number, number[]>;
}

export interface SelectionApplyResult {
  activeFilterSet: Set<number> | null;
}

/**
 * Atomic selection state applier: eliminates the white flash by computing incident links
 * synchronously and updating link opacities in the EXACT SAME GPU call as highlighted link indices.
 */
export function applyCosmographSelection(
  cosmo: any,
  params: SelectionStateParams,
  scheduleDrawAvatars: () => void
): SelectionApplyResult {
  if (!cosmo) return { activeFilterSet: null };
  const cosmos = cosmo._cosmos;
  if (!cosmos || !cosmos.graph) return { activeFilterSet: null };

  const {
    targetNodeId,
    targetContinentId,
    targetDensityRange,
    targetConnectionPercentile,
    nodeIndexMap,
    continentIndicesMap,
    sortedGlobalIndices: sortedGlobal,
    sortedContinentIndices: sortedContinent,
    edges,
    nodes,
    sortedEdgePlaylists,
    continentLinksMap
  } = params;

  // Precomputed cutoff playlists from connection percentile (0-99)
  let cutoffPlaylists = 0;
  // Linear scaling: 0.10 at 0% (All Connections) -> 0.40 at 99% (Top 1%)
  const t = targetConnectionPercentile / 100;
  const dynamicLinkOpacity = 0.1 + t * 0.3;
  const linkDefaultWidth = 0.8; // Constant width: brighter, but not bolder

  if (targetConnectionPercentile > 0) {
    const len = sortedEdgePlaylists.length;
    if (len > 0) {
      const cutoffIdx = Math.min(len - 1, Math.floor((targetConnectionPercentile / 100) * len));
      cutoffPlaylists = sortedEdgePlaylists[cutoffIdx];
    }
  }

  let activeFilterSet: Set<number> | null = null;

  if (targetNodeId) {
    activeFilterSet = null;
    const pointIndex = nodeIndexMap.get(targetNodeId);
    if (pointIndex !== undefined) {
      // 1. Synchronously get all incident links
      const incidentLinks = cosmo._computeIncidentLinks([pointIndex]) ?? [];

      // 2. Synchronously get all neighbor points
      const neighbors = cosmos.graph.getNeighboringPointIndices(pointIndex) ?? [];
      const highlightedPoints = [pointIndex, ...neighbors];

      // 3. Atomically pass both the highlighted indices AND opacity settings together!
      cosmos.setConfigPartial({
        highlightedPointIndices: highlightedPoints,
        highlightedLinkIndices: incidentLinks,
        linkOpacity: 0.9,
        linkGreyoutOpacity: 0.0,
        linkVisibilityMinTransparency: 1.0,
        linkDefaultWidth: 1.4,
        pointGreyoutOpacity: 0.15
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
  } else if (targetDensityRange !== null) {
    // Popularity percentage slice filter active (either global or within selected continent)
    const list =
      targetContinentId !== null ? sortedContinent.get(targetContinentId) || [] : sortedGlobal;
    const totalInScope = list.length;
    const [minPct, maxPct] = targetDensityRange;
    const startIdx = Math.round((minPct / 100) * totalInScope);
    const endIdx = Math.min(
      totalInScope,
      Math.max(startIdx + 1, Math.round((maxPct / 100) * totalInScope))
    );
    const basePoints = list.slice(startIdx, endIdx);

    const inMask = new Uint8Array(nodes.length);
    for (let i = 0; i < basePoints.length; i++) {
      inMask[basePoints[i]] = 1;
    }

    const qualifyingLinks: number[] = [];
    const connectedPointMask = targetConnectionPercentile > 0 ? new Uint8Array(nodes.length) : null;

    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      if (cutoffPlaylists > 0 && (edge.playlists ?? 1) < cutoffPlaylists) continue;
      const s = edge.sourceIndex ?? nodeIndexMap.get(edge.source) ?? 0;
      const t = edge.targetIndex ?? nodeIndexMap.get(edge.target) ?? 0;
      if (inMask[s] === 1 && inMask[t] === 1) {
        qualifyingLinks.push(i);
        if (connectedPointMask) {
          connectedPointMask[s] = 1;
          connectedPointMask[t] = 1;
        }
      }
    }

    // If connection strength filter is active, only show artists with surviving connections
    const qualifyingPoints = connectedPointMask
      ? basePoints.filter((idx) => connectedPointMask[idx] === 1)
      : basePoints;

    activeFilterSet = new Set(qualifyingPoints);

    cosmos.setConfigPartial({
      highlightedPointIndices: qualifyingPoints,
      highlightedLinkIndices: qualifyingLinks,
      linkOpacity: targetConnectionPercentile > 0 ? dynamicLinkOpacity : 0.1,
      linkGreyoutOpacity: 0.0,
      linkVisibilityMinTransparency: 1.0,
      linkDefaultWidth: linkDefaultWidth,
      pointGreyoutOpacity: 0.0
    });

    if (cosmo._crossfilter) {
      cosmo._crossfilter._userSelectedPointIndices = new Set(qualifyingPoints);
      cosmo._crossfilter._userSelectedLinkIndices = new Set(qualifyingLinks);
      cosmo._crossfilter._highlightedPointIndices = new Set(qualifyingPoints);
      cosmo._crossfilter._highlightedLinkIndices = new Set(qualifyingLinks);
      cosmo._crossfilter._pointsHighlightActive = true;
      cosmo._crossfilter._linksHighlightActive = true;
      cosmo._crossfilter._pointsUserActive = true;
      cosmo._crossfilter._linksUserActive = true;
    }
  } else if (targetContinentId !== null) {
    const continentIndices = continentIndicesMap.get(targetContinentId) || [];
    const continentLinks = continentLinksMap.get(targetContinentId) || [];

    let qualifyingLinks: number[];
    let qualifyingPoints: number[];

    if (targetConnectionPercentile > 0) {
      qualifyingLinks = continentLinks.filter((i) => (edges[i].playlists ?? 1) >= cutoffPlaylists);
      const connectedPointMask = new Uint8Array(nodes.length);
      for (let i = 0; i < qualifyingLinks.length; i++) {
        const edge = edges[qualifyingLinks[i]];
        const s = edge.sourceIndex ?? nodeIndexMap.get(edge.source) ?? 0;
        const t = edge.targetIndex ?? nodeIndexMap.get(edge.target) ?? 0;
        connectedPointMask[s] = 1;
        connectedPointMask[t] = 1;
      }
      qualifyingPoints = continentIndices.filter((idx) => connectedPointMask[idx] === 1);
      activeFilterSet = new Set(qualifyingPoints);
    } else {
      qualifyingLinks = continentLinks;
      qualifyingPoints = continentIndices;
      activeFilterSet = null;
    }

    cosmos.setConfigPartial({
      highlightedPointIndices: qualifyingPoints,
      highlightedLinkIndices: qualifyingLinks,
      linkOpacity: targetConnectionPercentile > 0 ? dynamicLinkOpacity : 0.15,
      linkGreyoutOpacity: 0.0,
      linkVisibilityMinTransparency: 1.0,
      linkDefaultWidth: linkDefaultWidth,
      pointGreyoutOpacity: targetConnectionPercentile > 0 ? 0.0 : 0.04
    });
    if (cosmo._crossfilter) {
      cosmo._crossfilter._userSelectedPointIndices = new Set(qualifyingPoints);
      cosmo._crossfilter._userSelectedLinkIndices = new Set(qualifyingLinks);
      cosmo._crossfilter._highlightedPointIndices = new Set(qualifyingPoints);
      cosmo._crossfilter._highlightedLinkIndices = new Set(qualifyingLinks);
      cosmo._crossfilter._pointsHighlightActive = true;
      cosmo._crossfilter._linksHighlightActive = true;
      cosmo._crossfilter._pointsUserActive = true;
      cosmo._crossfilter._linksUserActive = true;
    }
  } else if (targetConnectionPercentile > 0) {
    // Global view with connection strength filter: ONLY show artists with the strongest connections
    const qualifyingLinks: number[] = [];
    const connectedPointMask = new Uint8Array(nodes.length);

    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      if ((edge.playlists ?? 1) >= cutoffPlaylists) {
        qualifyingLinks.push(i);
        const s = edge.sourceIndex ?? nodeIndexMap.get(edge.source) ?? 0;
        const t = edge.targetIndex ?? nodeIndexMap.get(edge.target) ?? 0;
        connectedPointMask[s] = 1;
        connectedPointMask[t] = 1;
      }
    }

    const qualifyingPoints: number[] = [];
    for (let i = 0; i < nodes.length; i++) {
      if (connectedPointMask[i] === 1) {
        qualifyingPoints.push(i);
      }
    }

    activeFilterSet = new Set(qualifyingPoints);

    cosmos.setConfigPartial({
      highlightedPointIndices: qualifyingPoints,
      highlightedLinkIndices: qualifyingLinks,
      linkOpacity: dynamicLinkOpacity,
      linkGreyoutOpacity: 0.0,
      linkVisibilityMinTransparency: 1.0,
      linkDefaultWidth: linkDefaultWidth,
      pointGreyoutOpacity: 0.0
    });

    if (cosmo._crossfilter) {
      cosmo._crossfilter._userSelectedPointIndices = new Set(qualifyingPoints);
      cosmo._crossfilter._userSelectedLinkIndices = new Set(qualifyingLinks);
      cosmo._crossfilter._highlightedPointIndices = new Set(qualifyingPoints);
      cosmo._crossfilter._highlightedLinkIndices = new Set(qualifyingLinks);
      cosmo._crossfilter._pointsHighlightActive = true;
      cosmo._crossfilter._linksHighlightActive = true;
      cosmo._crossfilter._pointsUserActive = true;
      cosmo._crossfilter._linksUserActive = true;
      if (cosmo._crossfilter._pointsSelection?.clauses) {
        cosmo._crossfilter._pointsSelection.clauses.length = 0;
      }
      if (cosmo._crossfilter._linksSelection?.clauses) {
        cosmo._crossfilter._linksSelection.clauses.length = 0;
      }
    }
  } else {
    activeFilterSet = null;
    // Unselected state: restore delicate translucent filaments (18% opacity, hairline 0.8px, no distance cut)
    cosmos.setConfigPartial({
      highlightedPointIndices: void 0,
      highlightedLinkIndices: void 0,
      linkOpacity: 0.1,
      linkGreyoutOpacity: 0.0,
      linkVisibilityMinTransparency: 1.0,
      linkDefaultWidth: 0.8,
      pointGreyoutOpacity: 1.0
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

  cosmos.requestRender();

  // Immediately clear stale relation labels from previous selection and re-render for new selection
  if (cosmo._labels) {
    try {
      cosmo._labels._selectedLabelsMap?.clear();
      cosmo._labels._dynamicLabelsMap?.clear();
      cosmo._labels._lastSelectedLabelsKey = -1;
      cosmo._labels._lastDynamicLabelsKey = '';
      cosmo._labels._cssLabelsRenderer?.setLabels([]);
      cosmo._labels._cssLabelsRenderer?.draw();
      void cosmo._labels
        .render()
        ?.then?.(() => {
          scheduleDrawAvatars();
        })
        .catch?.(() => {});
    } catch {
      // Safe fallback
    }
  }

  scheduleDrawAvatars();
  if (targetNodeId || targetDensityRange !== null || targetContinentId !== null) {
    setTimeout(scheduleDrawAvatars, 80);
    setTimeout(scheduleDrawAvatars, 250);
  }

  return { activeFilterSet };
}
