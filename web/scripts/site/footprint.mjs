// Inline SVG "footprint" of a genre: its artists as dots at their atlas positions, over one shared,
// cached backdrop of the whole atlas's density
import { esc } from './layout.mjs';

export const BACKDROP_PATH = '/genres/atlas-backdrop.svg';

const WIDTH = 1000;
const PADDING = 20;
const CELL = 6;
const DENSITY_LEVELS = 5;
const MAX_DOTS = 600;
// Node sizes (1.1–14.5) mapped onto dot radii
const MIN_RADIUS = 4;
const RADIUS_SCALE = 0.32;

const round = (n) => Math.round(n * 10) / 10;

/** Fits the atlas into a WIDTH-wide view box; the canvas's y axis points up, so it's flipped */
export const createProjection = (nodes) => {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const { x, y } of nodes) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const scale = (WIDTH - 2 * PADDING) / (maxX - minX);
  const height = Math.round((maxY - minY) * scale + 2 * PADDING);
  return { width: WIDTH, height, project: (x, y) => [PADDING + (x - minX) * scale, PADDING + (maxY - y) * scale] };
};

/** The whole atlas as density cells, a few opacity levels, one path per level */
export const backdropSvg = (nodes, { width, height, project }) => {
  const counts = new Map();
  for (const node of nodes) {
    const [px, py] = project(node.x, node.y);
    const key = `${Math.floor(px / CELL)},${Math.floor(py / CELL)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const maxLog = Math.log1p(Math.max(...counts.values()));
  const levels = Array.from({ length: DENSITY_LEVELS }, () => []);
  for (const [key, count] of counts) {
    const [cx, cy] = key.split(',').map(Number);
    const level = Math.min(DENSITY_LEVELS - 1, Math.floor((Math.log1p(count) / maxLog) * DENSITY_LEVELS));
    levels[level].push(`M${cx * CELL} ${cy * CELL}h${CELL}v${CELL}h-${CELL}z`);
  }
  const paths = levels
    .map((cells, i) => (cells.length ? `<path fill-opacity="${round(0.06 + (0.22 * i) / (DENSITY_LEVELS - 1))}" d="${cells.join('')}"/>` : ''))
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><g fill="#94a3b8">${paths}</g></svg>\n`;
};

/** `members` most popular first; the top MAX_DOTS are drawn, grouped by continent color */
export const footprintSvg = (genre, members, { width, height, project }) => {
  const byColor = new Map();
  // Smallest first so popular artists are drawn on top
  for (const node of members.slice(0, MAX_DOTS).reverse()) {
    const [px, py] = project(node.x, node.y);
    if (!byColor.has(node.color)) byColor.set(node.color, []);
    byColor.get(node.color).push(`<circle cx="${round(px)}" cy="${round(py)}" r="${round(MIN_RADIUS + node.size * RADIUS_SCALE)}"/>`);
  }
  const groups = [...byColor].map(([color, dots]) => `<g fill="${color}">${dots.join('')}</g>`).join('');
  const label = `Where ${genre} artists sit on the Music Atlas map`;
  return `<svg class="footprint" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}"><title>${esc(label)}</title><image href="${BACKDROP_PATH}" width="${width}" height="${height}"/><g fill-opacity=".9">${groups}</g></svg>`;
};
