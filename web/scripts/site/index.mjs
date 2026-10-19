// Vite plugin: the crawlable static site around the atlas (A–Z artist index, artist and genre pages,
// sitemaps) plus index.html's artist count, all from the exported atlas
// (and pipeline stage 7's Wikidata genre-info.json). Served by the dev server and written to dist/ on build.
import { writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSS, SEARCH_SCRIPT_PLACEHOLDER, fmt } from './layout.mjs';
import { loadSiteContext } from './context.mjs';
import { buildArtistPages } from './artist-pages.mjs';
import { buildGenrePages } from './genre-pages.mjs';
import { BACKDROP_PATH, backdropSvg } from './footprint.mjs';
import { sitemapFiles } from './sitemap.mjs';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../public/data');
// The static pages' search script: a second Vite entry (see vite.config.ts), served from source in dev
export const SEARCH_ENTRY = 'siteSearch';
export const SEARCH_SOURCE = 'src/site/search.ts';
// Cloudflare Pages deploys at most 20,000 files; fail the build with room to spare instead of failing the deploy
const MAX_SITE_FILES = 19_000;

const HTML = 'text/html; charset=utf-8';

// Every generated file as URL path -> { type, body }
const buildSite = (ctx) => {
  const files = new Map();
  const html = (path, body) => files.set(path, { type: HTML, body });
  files.set('/artists/style.css', { type: 'text/css; charset=utf-8', body: CSS });

  const { indexPaths, artistPaths } = buildArtistPages(ctx, html);
  const { genreCount, paths: genrePaths, projection } = buildGenrePages(ctx, html);
  files.set(BACKDROP_PATH, { type: 'image/svg+xml', body: backdropSvg(ctx.nodes, projection) });

  // Read by src/site/search.ts: artists most popular first, as [name, id, page path or 0, primary genre]
  files.set('/search-index.json', {
    type: 'application/json; charset=utf-8',
    body: JSON.stringify({
      artists: ctx.byPopularity.map((n) => [n.label, n.id, ctx.artistPaths.get(n.id) ?? 0, n.primaryGenre ?? '']),
      genres: [...ctx.genrePaths].map(([name, path]) => [name, path, ctx.genres.get(name).length]),
    }),
  });

  const sitemaps = sitemapFiles({ pages: ['/', ...indexPaths], genres: genrePaths, artists: artistPaths }, ctx.generatedAt);
  for (const [path, body] of sitemaps) files.set(path, { type: 'application/xml; charset=utf-8', body });

  return { total: ctx.nodes.length, genreCount, artistPageCount: artistPaths.length, files };
};

// Rounded down to the thousand for page titles and descriptions ("74,000 artists")
const roundedCount = (total) => fmt(Math.floor(total / 1000) * 1000);

const countFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).reduce((n, entry) => n + (entry.isDirectory() ? countFiles(join(dir, entry.name)) : 1), 0);

export const sitePagesPlugin = () => {
  let ctx;
  let site;
  const loadContext = () => (ctx ??= loadSiteContext(DATA_DIR));
  // The pages are only built once one is requested (dev) or written (build)
  const load = () => (site ??= buildSite(loadContext()));
  let outDir;
  let isBuild;
  let searchScriptSrc = `/${SEARCH_SOURCE}`;
  const withSearchScript = (body) => body.replaceAll(SEARCH_SCRIPT_PLACEHOLDER, searchScriptSrc);
  return {
    name: 'site-pages',
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
      isBuild = config.command === 'build';
    },
    transformIndexHtml(htmlText) {
      return htmlText.replaceAll('%ARTIST_COUNT%', roundedCount(loadContext().nodes.length));
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        const file = load().files.get(path) ?? load().files.get(`${path}/`);
        if (!file) return next();
        res.setHeader('Content-Type', file.type);
        res.end(withSearchScript(file.body));
      });
    },
    generateBundle(_, bundle) {
      const entry = Object.values(bundle).find((chunk) => chunk.type === 'chunk' && chunk.isEntry && chunk.name === SEARCH_ENTRY);
      if (!entry) throw new Error(`The ${SEARCH_ENTRY} entry is missing from the build`);
      searchScriptSrc = `/${entry.fileName}`;
    },
    // Vite also calls this when the dev server closes, which must not overwrite dist/ with dev script paths
    closeBundle() {
      if (!isBuild) return;
      const { total, genreCount, artistPageCount, files } = load();
      for (const [path, { body }] of files) {
        const target = join(outDir, path.endsWith('/') ? `${path}index.html` : path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, withSearchScript(body));
      }
      const fileCount = countFiles(outDir);
      console.log(
        `site pages: ${fmt(artistPageCount)} artist pages (of ${fmt(total)} artists), ${fmt(genreCount)} genre pages, ${fmt(files.size)} generated files; ${fmt(fileCount)} files in ${outDir}`,
      );
      if (fileCount > MAX_SITE_FILES) {
        throw new Error(`${fmt(fileCount)} files in the build exceeds the ${fmt(MAX_SITE_FILES)} budget (Cloudflare Pages allows 20,000)`);
      }
    },
  };
};
