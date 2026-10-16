// Vite plugin: a crawlable A–Z artist index (/artists/), a page per genre (/genres/), /sitemap.xml and the
// artist count in index.html, all from the exported atlas graph (plus pipeline stage 7's genre-info.json).
// Served by the dev server and written to dist/ on build.
// Entries deep-link into the atlas via /?artist=<id> and /?genre=<slug>.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// Bundled by Vite's config loader, so the app's TypeScript helpers are shared rather than re-implemented
import { slugify, findRelatedGenres, formatInception } from '../src/utils/genreUtils';
import { filterValidSubgenres, formatSubscriberCount } from '../src/utils/artistUtils';

const SITE = 'https://music-atlas.app';
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const GRAPH_FILE = join(WEB, 'public/data/atlas-graph.json.gz');
const GENRE_INFO_FILE = join(WEB, 'public/data/genre-info.json');

const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'];
const slugOf = (letter) => (letter === '#' ? 'other' : letter.toLowerCase());

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (n) => n.toLocaleString('en-US');

const letterOf = (name) => {
  const ch = name.trim().normalize('NFD').charAt(0).toUpperCase();
  return ch >= 'A' && ch <= 'Z' ? ch : '#';
};

const letterNav = (buckets, active) =>
  `<nav class="letters" aria-label="Artists by letter">${LETTERS.map((l) => {
    const count = buckets.get(l).length;
    if (!count) return '';
    const cls = l === active ? ' class="active" aria-current="page"' : '';
    return `<a href="/artists/${slugOf(l)}/"${cls}>${l}</a>`;
  }).join('')}</nav>`;

const page = ({ path, title, description, body }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${SITE}${path}" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<meta name="theme-color" content="#090b10" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Music Atlas" />
<meta property="og:url" content="${SITE}${path}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:image" content="${SITE}/og-image.jpg" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;800&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/artists/style.css" />
</head>
<body>
<header>
<a class="brand" href="/"><img src="/favicon.svg" alt="" width="28" height="28" />Music Atlas</a>
<nav class="links"><a href="/artists/">Artists</a><a href="/genres/">Genres</a></nav>
<a class="cta" href="/">Open the map →</a>
</header>
<main>
${body}
</main>
</body>
</html>
`;

const CSS = `*{box-sizing:border-box}
body{margin:0;background:#090b10;color:#e2e8f0;font-family:'Plus Jakarta Sans',system-ui,sans-serif;line-height:1.5}
a{color:inherit}
header{position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px max(16px,calc((100% - 1100px)/2));background:rgba(9,11,16,.9);backdrop-filter:blur(12px);border-bottom:1px solid rgba(255,255,255,.08)}
.links{display:flex;gap:18px;margin-right:auto;font-size:14px;font-weight:600}
.links a{text-decoration:none;color:#94a3b8}
.links a:hover{color:#34d399}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:.04em;text-decoration:none;text-transform:uppercase;font-size:14px}
.cta{font-weight:800;font-size:13px;color:#090b10;background:linear-gradient(90deg,#34d399,#22d3ee);padding:8px 16px;border-radius:999px;text-decoration:none;white-space:nowrap}
main{max-width:1100px;margin:0 auto;padding:40px 16px 80px}
h1{font-size:clamp(28px,5vw,44px);font-weight:800;letter-spacing:-.02em;margin:0 0 8px;color:#fff}
.lede{color:#94a3b8;margin:0 0 28px;max-width:640px}
.letters{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:32px}
.letters a{min-width:38px;padding:7px 10px;text-align:center;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);text-decoration:none;font-weight:600;font-size:14px}
.letters a:hover{border-color:#34d399;color:#34d399}
.letters a.active{background:#10b981;border-color:#10b981;color:#090b10}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;list-style:none;padding:0;margin:0}
.grid a{display:block;padding:16px;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);text-decoration:none}
.grid a:hover{border-color:#34d399}
.grid strong{display:block;font-size:24px;color:#fff}
.grid span{font-size:13px;color:#94a3b8}
.artists{columns:260px;column-gap:32px;list-style:none;padding:0;margin:0}
.artists li{break-inside:avoid;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.artists a{font-weight:600;text-decoration:none;color:#f1f5f9}
.artists a:hover{color:#34d399}
.artists span{display:block;font-size:12px;color:#64748b}
.lede a,.source a{color:#34d399}
.cta.inline{display:inline-block;margin:0 0 28px}
h2{font-size:18px;color:#fff;margin:32px 0 12px}
.chips{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0;margin:0}
.chips a{display:block;padding:6px 12px;border-radius:999px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);text-decoration:none;font-size:14px}
.chips a:hover{border-color:#34d399;color:#34d399}
.sample{max-width:480px;margin:0 0 8px}
.sample audio{width:100%}
.source{font-size:12px;color:#64748b;margin:0 0 8px}
`;

// Genre name -> member nodes (most subscribers first), from the same EveryNoise subgenres the app indexes
const groupGenres = (nodes) => {
  const genres = new Map();
  const byPopularity = [...nodes].sort((a, b) => (b.subscribers || 0) - (a.subscribers || 0));
  for (const node of byPopularity) {
    for (const genre of filterValidSubgenres(node.topSubgenres)) {
      if (!genres.has(genre)) genres.set(genre, []);
      genres.get(genre).push(node);
    }
  }
  return genres;
};

// A missing or duplicated slug would silently drop a genre page, so it fails the build instead
const genreSlugs = (genres) => {
  const slugs = new Map();
  const owners = new Map();
  for (const genre of genres.keys()) {
    const slug = slugify(genre);
    if (!slug) throw new Error(`Genre "${genre}" has no URL slug`);
    if (owners.has(slug)) throw new Error(`Genres "${owners.get(slug)}" and "${genre}" share the slug "${slug}"`);
    owners.set(slug, genre);
    slugs.set(genre, slug);
  }
  return slugs;
};

const genrePageBody = (genre, members, slugs, related, info) => {
  const era = info?.since ? ` Emerged ${esc(formatInception(info.since))}.` : '';
  const about = info?.desc
    ? `<p class="lede">${esc(info.desc.charAt(0).toUpperCase() + info.desc.slice(1))}.${era}${info.wiki ? ` <a href="${esc(info.wiki)}">Wikipedia</a>` : ''}</p><p class="source">Description from Wikidata (CC0).</p>`
    : era ? `<p class="lede">${era.trim()}</p>` : '';
  const sample = info?.audio
    ? `<h2>Listen: ${esc(info.audio.title)}</h2>
<div class="sample"><audio controls preload="none" src="${esc(info.audio.src)}"></audio></div>
<p class="source">${info.audio.author ? `${esc(info.audio.author)} · ` : ''}<a href="${esc(info.audio.page)}">${esc(info.audio.license || 'Wikimedia Commons')}</a></p>`
    : '';
  const relatedList = related.length
    ? `<h2>Related genres</h2>
<ul class="chips">${related.map((r) => `<li><a href="/genres/${slugs.get(r.name)}/">${esc(r.name)}</a></li>`).join('')}</ul>`
    : '';
  return `<h1>${esc(genre)}</h1>
<p class="lede">${fmt(members.length)} artists on Music Atlas tagged ${esc(genre)}, ranked by listeners. Select one to see who they share playlists with.</p>
${about}
<a class="cta inline" href="/?genre=${slugs.get(genre)}">Open ${esc(genre)} on the map →</a>
${sample}
${relatedList}
<h2>Artists</h2>
<ul class="artists">${members
    .map((a) => `<li><a href="/?artist=${encodeURIComponent(a.id)}">${esc(a.label)}</a><span>${formatSubscriberCount(a.subscribers)} listeners</span></li>`)
    .join('')}</ul>`;
};

// Every generated file as URL path -> { type, body }
const buildSite = (graph, genreInfo) => {
  const buckets = new Map(LETTERS.map((l) => [l, []]));
  for (const node of graph.nodes) buckets.get(letterOf(node.label)).push(node);
  const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
  for (const list of buckets.values()) list.sort((a, b) => collator.compare(a.label, b.label));

  const total = graph.nodes.length;
  const files = new Map();
  const html = (path, body) => files.set(path, { type: 'text/html; charset=utf-8', body });
  files.set('/artists/style.css', { type: 'text/css; charset=utf-8', body: CSS });

  const sitemapPaths = ['/', '/artists/'];

  html(
    '/artists/',
    page({
      path: '/artists/',
      title: `All ${fmt(total)} Artists A–Z | Music Atlas`,
      description: `Browse all ${fmt(total)} artists on Music Atlas, mapped by genre and real community playlists. Pick any artist to jump to them on the map.`,
      body: `<h1>Every artist on the map</h1>
<p class="lede">${fmt(total)} artists who appear across at least four real, user-made playlists. Pick a letter, then select any artist to fly to them in the atlas.</p>
<ul class="grid">${LETTERS.filter((l) => buckets.get(l).length)
        .map((l) => `<li><a href="/artists/${slugOf(l)}/"><strong>${l}</strong><span>${fmt(buckets.get(l).length)} artists${l === '#' ? ' · 0–9 &amp; other scripts' : ''}</span></a></li>`)
        .join('')}</ul>`,
    }),
  );

  for (const letter of LETTERS) {
    const artists = buckets.get(letter);
    if (!artists.length) continue;
    const path = `/artists/${slugOf(letter)}/`;
    const heading = letter === '#' ? 'Artists: 0–9 & other scripts' : `Artists starting with ${letter}`;
    html(
      path,
      page({
        path,
        title: `${heading} | Music Atlas`,
        description: `Browse ${fmt(artists.length)} artists ${letter === '#' ? 'whose names start with a number or non-Latin script' : `starting with ${letter}`} on Music Atlas. Select any artist to see their genre neighborhood on the map.`,
        body: `<h1>${esc(heading)}</h1>
<p class="lede">${fmt(artists.length)} artists. Select one to see where they sit on the map and who they share playlists with.</p>
${letterNav(buckets, letter)}
<ul class="artists">${artists
          .map((a) => `<li><a href="/?artist=${encodeURIComponent(a.id)}">${esc(a.label)}</a>${a.primaryGenre ? `<span>${esc(a.primaryGenre)}</span>` : ''}</li>`)
          .join('')}</ul>`,
      }),
    );
    sitemapPaths.push(path);
  }

  const genres = groupGenres(graph.nodes);
  const slugs = genreSlugs(genres);
  const genreNames = [...genres.keys()].sort((a, b) => collator.compare(a, b));

  html(
    '/genres/',
    page({
      path: '/genres/',
      title: `All ${fmt(genres.size)} Genres | Music Atlas`,
      description: `Browse ${fmt(genres.size)} music genres on Music Atlas, each with its artists, related genres and where it sits on the map of real community playlists.`,
      body: `<h1>Every genre on the map</h1>
<p class="lede">${fmt(genres.size)} genres from EveryNoise, each holding the artists whose playlists tag them with it. Pick one to see its artists and related genres.</p>
<ul class="artists">${genreNames
        .map((g) => `<li><a href="/genres/${slugs.get(g)}/">${esc(g)}</a><span>${fmt(genres.get(g).length)} artists</span></li>`)
        .join('')}</ul>`,
    }),
  );
  sitemapPaths.push('/genres/');

  for (const genre of genreNames) {
    const members = genres.get(genre);
    const path = `/genres/${slugs.get(genre)}/`;
    const related = findRelatedGenres(
      genre,
      members,
      (node) => filterValidSubgenres(node.topSubgenres),
      (name) => genres.get(name)?.length ?? 1,
    );
    const top = members.slice(0, 3).map((a) => a.label).join(', ');
    html(
      path,
      page({
        path,
        title: `${genre} Artists & Related Genres | Music Atlas`,
        description: `${fmt(members.length)} ${genre} artists, including ${top}, mapped by real community playlists. See related genres and explore ${genre} on the map.`,
        body: genrePageBody(genre, members, slugs, related, Object.prototype.hasOwnProperty.call(genreInfo, genre) ? genreInfo[genre] : undefined),
      }),
    );
    sitemapPaths.push(path);
  }

  files.set('/sitemap.xml', {
    type: 'application/xml; charset=utf-8',
    body: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapPaths.map((p) => `  <url><loc>${SITE}${p}</loc></url>`).join('\n')}
</urlset>
`,
  });

  return { total, genreCount: genres.size, files };
};

// Rounded down to the thousand for page titles and descriptions ("74,000 artists")
const roundedCount = (total) => fmt(Math.floor(total / 1000) * 1000);

export const artistIndexPlugin = () => {
  let site;
  const load = () =>
    (site ??= buildSite(
      JSON.parse(gunzipSync(readFileSync(GRAPH_FILE)).toString('utf8')),
      existsSync(GENRE_INFO_FILE) ? JSON.parse(readFileSync(GENRE_INFO_FILE, 'utf8')) : {},
    ));
  let outDir;
  return {
    name: 'artist-index',
    configResolved(config) {
      outDir = join(config.root, config.build.outDir);
    },
    transformIndexHtml(htmlText) {
      return htmlText.replaceAll('%ARTIST_COUNT%', roundedCount(load().total));
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        const file = load().files.get(path) ?? load().files.get(`${path}/`);
        if (!file) return next();
        res.setHeader('Content-Type', file.type);
        res.end(file.body);
      });
    },
    closeBundle() {
      const { total, genreCount, files } = load();
      for (const [path, { body }] of files) {
        const target = join(outDir, path.endsWith('/') ? `${path}index.html` : path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, body);
      }
      console.log(`artist index: ${fmt(total)} artists and ${fmt(genreCount)} genre pages (${fmt(files.size)} files)`);
    },
  };
};
