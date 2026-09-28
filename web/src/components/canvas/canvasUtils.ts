/**
 * Proportional node sizing algorithm calibrated to reference ground truth:
 * Maps the subscriber power curve from atlas-graph.json (raw 1.1 to 14.5)
 * into authentic screen diameters matching Sigma:
 *
 * Base / fully zoomed out:
 * - Underground (1k subs, raw 1.1): 3.5px
 * - 30k subs (Beach Fossils, raw 1.9): 9.4px
 * - 70k subs (cults, raw 2.5): 13.9px
 * - 300k subs (Beach House, raw 4.1): 24.3px
 * - 900k subs (Cigarettes After Sex, raw 5.9): 35.8px
 * - 3M subs (Gorillaz, raw 8.5): 53.3px
 * - 4M subs (Future, raw 9.1): 57.5px
 * - 24M subs (Drake, raw 14.5): 97.5px
 */
export function getArtistNodeDiameter(rawSize: number | undefined | null): number {
  const raw = rawSize ?? 1.1;
  const delta = Math.max(0, raw - 1.1);
  return 7.0 + delta * 5.0 + Math.pow(delta, 1.55) * 0.42;
}

/**
 * Dynamic zoom scale calculator:
 * - Deep galaxy view scales down to clean, uncrowded ~0.15x density
 * - Close-up zooms smoothly scale up to 3.5x for rich artist and avatar detail
 */
export function getZoomScale(cosmo: any): number {
  const currentZoom = cosmo?.getZoomLevel?.();
  if (!currentZoom || !Number.isFinite(currentZoom)) return 1.0;
  const baseZoom = 1.0;
  const relativeZoom = currentZoom / baseZoom;

  const zoomPivot = 2.2;
  const normalizedRatio = relativeZoom / zoomPivot;

  if (normalizedRatio >= 1.0) {
    return Math.min(3.5, Math.pow(normalizedRatio, 0.45));
  }

  return Math.max(0.15, Math.pow(normalizedRatio, 0.75));
}

/**
 * Strict zoom limits configurator: allows zooming out deep into space, and caps max zoom in.
 */
export function applyZoomLimits(cosmo: any, baseZoom?: number): void {
  const behavior = cosmo?._cosmos?.zoomInstance?.behavior;
  if (!behavior) return;
  const current = baseZoom || 1.0;
  const minZoom = Math.max(0.01, current * 0.1);
  const maxZoom = Math.max(15.0, current * 45);
  behavior.scaleExtent([minZoom, maxZoom]);
}

/**
 * Hooks Cosmograph's internal _labels and _cssLabelsRenderer:
 * - Strips hidden and disqualified labels
 * - Intercepts render calls to schedule synchronized 2D avatar redraws
 *
 * NOTE: getIsNodeQualifying is a dynamic getter function to prevent stale closures over filter state.
 */
export function hookCosmographLabels(
  cosmograph: any,
  getIsNodeQualifying: () => (id: string, index?: number) => boolean,
  scheduleDrawAvatars: () => void
): void {
  const hookLabels = (l: any) => {
    if (!l) return;

    const hookRenderer = (renderer: any) => {
      if (!renderer || renderer.__origSetLabels) return;
      const origSet = renderer.setLabels.bind(renderer);
      renderer.__origSetLabels = origSet;
      renderer.setLabels = (labels: any[]) => {
        if (!Array.isArray(labels)) return origSet(labels);
        const isNodeQualifying = getIsNodeQualifying();
        const filtered = labels.filter((lbl: any) => {
          if (!lbl || !lbl.id) return false;
          if (typeof lbl.id === 'string' && lbl.id.startsWith('cluster-')) return true;
          const isHidden =
            typeof lbl.className === 'string' &&
            (lbl.className.includes('cosmographLabelHidden') ||
              lbl.className.includes('LabelHidden'));
          if (isHidden) return false;
          return isNodeQualifying(lbl.id);
        });
        return origSet(filtered);
      };
    };

    if (l._cssLabelsRenderer) hookRenderer(l._cssLabelsRenderer);
    let currentRenderer = l._cssLabelsRenderer;
    Object.defineProperty(l, '_cssLabelsRenderer', {
      configurable: true,
      enumerable: true,
      get() {
        return currentRenderer;
      },
      set(val) {
        currentRenderer = val;
        if (val) hookRenderer(val);
      }
    });

    if (!l.__origRenderLabels) {
      const origRender = l._renderLabels.bind(l);
      l.__origRenderLabels = origRender;
      l._renderLabels = () => {
        origRender();
        scheduleDrawAvatars();
      };
    }
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
}
