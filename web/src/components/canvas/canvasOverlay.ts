import { AtlasNode } from '../../types/atlas';
import { getAvatarImage } from '../../utils/avatarCache';
import { getArtistNodeDiameter, getZoomScale } from './canvasUtils';

export interface CanvasOverlayParams {
  canvas: HTMLCanvasElement;
  cosmo: any;
  nodes: AtlasNode[];
  nodeIndexMap: Map<string, number>;
  neighborMap: Map<string, string[]>;
  selectedNodeId: string | null;
  hoveredPointIndex: number | null;
  isNodeQualifying: (id: string, index?: number) => boolean;
  scheduleDrawAvatars: () => void;
}

interface LabelToDraw {
  text: string;
  sx: number;
  yOffset: number;
}

/**
 * High-performance 2D avatar renderer strictly synced to visible labels.
 * Draws circular avatars clipped inside the node discs for only visible artists.
 */
export function renderCanvasOverlay({
  canvas,
  cosmo,
  nodes,
  nodeIndexMap,
  neighborMap,
  selectedNodeId,
  hoveredPointIndex,
  isNodeQualifying,
  scheduleDrawAvatars
}: CanvasOverlayParams): void {
  if (!canvas || !cosmo) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0) return;

  const isMobile = width < 768;
  const dpr = Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2.0);
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
      cosmo._cosmos.requestRender();
    }
  }

  // Collect IDs of nodes that should display circular avatars:
  const visibleNodeIds = new Set<string>();
  const cssLabels = cosmo._labels?._cssLabelsRenderer?._cssLabels;

  if (selectedNodeId) {
    // 1. When an artist is selected: STRICTLY AND ONLY the focal artist and their direct qualifying neighbors!
    visibleNodeIds.add(selectedNodeId);
    const neighbors = neighborMap.get(selectedNodeId);
    if (neighbors) {
      for (const nId of neighbors) {
        visibleNodeIds.add(nId);
      }
    }
  } else {
    // 2. Global / Continent / Density View: show avatars only for visible qualifying labels
    if (cssLabels && cssLabels.size > 0) {
      for (const [id, cssLabel] of cssLabels.entries()) {
        if (typeof cssLabel.getVisibility === 'function' && cssLabel.getVisibility()) {
          if (isNodeQualifying(id)) {
            visibleNodeIds.add(id);
          }
        }
      }
    }
    // Immediate fallback: if CSS DOM elements are still resolving after deselect, pull directly from labelDataMap
    if (
      visibleNodeIds.size === 0 &&
      cosmo._labels?._labelDataMap &&
      cosmo._labels._labelDataMap.size > 0
    ) {
      for (const [id, labelData] of cosmo._labels._labelDataMap.entries()) {
        if (labelData && isNodeQualifying(id, labelData.index)) {
          visibleNodeIds.add(id);
        }
      }
    }
  }

  // 3. Hovered artist: always display avatar and label when hovering over any visible artist
  if (hoveredPointIndex !== null && hoveredPointIndex !== undefined) {
    const hoveredNode = nodes[hoveredPointIndex];
    if (hoveredNode) {
      visibleNodeIds.add(hoveredNode.id);
    }
  }

  // Sort visible nodes by size ascending, ensuring hovered artist is drawn last on top of all others
  const hoveredId =
    hoveredPointIndex !== null && hoveredPointIndex !== undefined
      ? nodes[hoveredPointIndex]?.id
      : null;
  const sortedVisibleIds = Array.from(visibleNodeIds).sort((a, b) => {
    if (a === hoveredId) return 1;
    if (b === hoveredId) return -1;
    return (nodeIndexMap.get(a) ?? 0) - (nodeIndexMap.get(b) ?? 0);
  });

  const labelsToDraw: LabelToDraw[] = [];
  const hasFinePointer =
    typeof window !== 'undefined' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const zoomScale = cosmo._cosmos?.config?.pointSizeScale ?? 1.0;

  // Pass 1: Draw avatars and proportional outer rings
  for (const id of sortedVisibleIds) {
    const idx = nodeIndexMap.get(id);
    if (idx === undefined) continue;
    const node = nodes[idx];
    if (!node) continue;

    const screenPos = cosmo.spaceToScreenPosition([node.x, node.y]);
    if (!screenPos) continue;
    const [sx, sy] = screenPos;

    // Cull offscreen points
    if (sx < -100 || sx > width + 100 || sy < -100 || sy > height + 100) continue;

    const diameter = getArtistNodeDiameter(node.size) * zoomScale;
    const radius = diameter / 2;
    const avatarRadius = Math.max(2.0, radius - 1.2);
    const isHovered =
      hasFinePointer &&
      hoveredPointIndex !== null &&
      hoveredPointIndex !== undefined &&
      nodes[hoveredPointIndex]?.id === id;

    // Draw base solid disc for hovered node so it instantly brightens from dimmed background state
    if (isHovered) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(sx, sy, avatarRadius, 0, Math.PI * 2);
      ctx.fillStyle = node.color || '#38bdf8';
      ctx.fill();
      ctx.restore();
    }

    if (node.image) {
      const img = getAvatarImage(node.image, () => scheduleDrawAvatars());
      if (img) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(sx, sy, avatarRadius, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(
          img,
          sx - avatarRadius,
          sy - avatarRadius,
          avatarRadius * 2,
          avatarRadius * 2
        );
        ctx.restore();

        // Crisp border ring around avatar matching artist/continent color (matching Sigma)
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
    if (isHovered || id === selectedNodeId) {
      const ringRadius = radius + Math.max(3.0, radius * 0.18);
      ctx.save();
      ctx.beginPath();
      ctx.arc(sx, sy, ringRadius, 0, Math.PI * 2);
      ctx.strokeStyle = node.color || '#38bdf8';
      ctx.lineWidth = Math.max(2.0, radius * 0.08);
      ctx.stroke();
      ctx.restore();
    }

    // Collect labels to draw in Pass 2 strictly on top above hover rings
    if (isHovered || id === selectedNodeId) {
      const hasCssLabel = cssLabels?.get(id)?.getVisibility() === true;
      const labelText = node.label || '';
      if (labelText && !hasCssLabel) {
        labelsToDraw.push({
          text: labelText,
          sx,
          yOffset: sy + radius + 8
        });
      }
    }
  }

  // Pass 2: Draw text labels strictly on top above all hover rings
  for (const l of labelsToDraw) {
    ctx.save();
    ctx.font = '700 12px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(7, 9, 14, 0.95)';
    ctx.strokeText(l.text, l.sx, l.yOffset);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(l.text, l.sx, l.yOffset);
    ctx.restore();
  }

  ctx.restore();
}
