// Loads the exported atlas once and derives everything the page builders share: lookups, which artists and
// genres get a page, and every page's URL
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { slugify, hasGenrePage } from '../../src/utils/genreUtils';
import {
  filterValidSubgenres,
  parseContinentDetails,
  hasArtistPage,
  findDuplicateArtistSlugs,
  artistPagePath,
} from '../../src/utils/artistUtils';
import { continentColor } from '../../src/utils/color';
import { sanitizeAvatarUrl } from '../../src/utils/imageUtils';
import { nameHtml, mapLink } from './layout.mjs';

const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'];
export const PAGE_SIZE = 250;

export const letterSlug = (letter) => (letter === '#' ? 'other' : letter.toLowerCase());
export const pagePath = (basePath, pageIndex) => (pageIndex === 0 ? basePath : `${basePath}${pageIndex + 1}/`);

export const letterOf = (name) => {
  const ch = name.trim().normalize('NFD').charAt(0).toUpperCase();
  return ch >= 'A' && ch <= 'Z' ? ch : '#';
};

const readDetails = (dir) => {
  const details = new Map();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const chunk = parseContinentDetails(JSON.parse(readFileSync(join(dir, file), 'utf8')));
    for (const [id, detail] of Object.entries(chunk)) details.set(id, detail);
  }
  return details;
};

// Genre name -> member nodes (most subscribers first), from the same EveryNoise subgenres the app indexes
const groupGenres = (byPopularity) => {
  const genres = new Map();
  for (const node of byPopularity) {
    for (const genre of filterValidSubgenres(node.topSubgenres)) {
      if (!genres.has(genre)) genres.set(genre, []);
      genres.get(genre).push(node);
    }
  }
  return genres;
};

// A missing or duplicated URL would silently drop or overwrite a page, so it fails the build instead
const claimUnique = (owners, path, owner) => {
  if (owners.has(path)) throw new Error(`"${owners.get(path)}" and "${owner}" share the URL ${path}`);
  owners.set(path, owner);
};

export const loadSiteContext = (dataDir) => {
  const graph = JSON.parse(gunzipSync(readFileSync(join(dataDir, 'atlas-graph.json.gz'))).toString('utf8'));
  const genreInfoFile = join(dataDir, 'genre-info.json');
  const genreInfo = existsSync(genreInfoFile) ? JSON.parse(readFileSync(genreInfoFile, 'utf8')) : {};
  const details = readDetails(join(dataDir, 'details'));
  const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

  const { nodes, edges } = graph;
  const continents = new Map(graph.continents.map((c) => [c.id, { ...c, color: continentColor(c.id) }]));
  // Same image cleanup and community colors as the app
  for (const node of nodes) {
    node.image = sanitizeAvatarUrl(node.image) && node.image;
    node.color = continents.get(node.continentId)?.color ?? node.color;
  }
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const byPopularity = [...nodes].sort((a, b) => (b.subscribers || 0) - (a.subscribers || 0));

  // Genres with enough artists get a page at /genres/<slug>/
  const genres = groupGenres(byPopularity);
  const genrePaths = new Map();
  const genreOwners = new Map();
  for (const [genre, members] of genres) {
    if (!hasGenrePage(members.length)) continue;
    const slug = slugify(genre);
    if (!slug) throw new Error(`Genre "${genre}" has no URL slug`);
    claimUnique(genreOwners, slug, genre);
    genrePaths.set(genre, `/genres/${slug}/`);
  }

  // Artists in enough playlists get a page at /artist/<slug>/
  const duplicateSlugs = findDuplicateArtistSlugs(nodes);
  const artistPaths = new Map();
  const artistOwners = new Map();
  for (const node of nodes) {
    if (!hasArtistPage(details.get(node.id)?.totalPlaylists)) continue;
    const path = artistPagePath(node, duplicateSlugs);
    claimUnique(artistOwners, path, node.label);
    artistPaths.set(node.id, path);
  }

  // A–Z index: every artist sits on one page of their letter
  const letters = LETTERS.map((letter) => ({ letter, basePath: `/artists/${letterSlug(letter)}/`, artists: [] }));
  const letterByChar = new Map(letters.map((l) => [l.letter, l]));
  for (const node of nodes) letterByChar.get(letterOf(node.label)).artists.push(node);
  const indexPageOf = new Map();
  for (const l of letters) {
    l.artists.sort((a, b) => collator.compare(a.label, b.label));
    l.artists.forEach((a, i) => indexPageOf.set(a.id, { letter: l.letter, path: pagePath(l.basePath, Math.floor(i / PAGE_SIZE)) }));
  }

  return {
    nodes,
    byPopularity,
    edges,
    nodeById,
    continents,
    details,
    genres,
    genrePaths,
    genreInfo,
    artistPaths,
    letters: letters.filter((l) => l.artists.length),
    indexPageOf,
    collator,
    generatedAt: graph.metadata.generatedAt,
    /** The artist's name linking to their page; artists without one are plain text with a small arrow to the map */
    artistLink: (node) =>
      artistPaths.has(node.id)
        ? `<a href="${artistPaths.get(node.id)}">${nameHtml(node.label)}</a>`
        : `<strong class="plain">${nameHtml(node.label)}</strong>${mapLink(node)}`,
  };
};
