// Post-build: emits a crawlable A–Z artist index (dist/artists/) and dist/sitemap.xml
// from the exported atlas graph. Every entry deep-links into the atlas via /?artist=<id>.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = 'https://music-atlas.app';
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(WEB, 'dist');
const OUT = join(DIST, 'artists');

const graph = JSON.parse(gunzipSync(readFileSync(join(WEB, 'public/data/atlas-graph.json.gz'))).toString('utf8'));

const LETTERS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'];
const slugOf = (letter) => (letter === '#' ? 'other' : letter.toLowerCase());

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (n) => n.toLocaleString('en-US');

const letterOf = (name) => {
  const ch = name.trim().normalize('NFD').charAt(0).toUpperCase();
  return ch >= 'A' && ch <= 'Z' ? ch : '#';
};

const buckets = new Map(LETTERS.map((l) => [l, []]));
for (const node of graph.nodes) buckets.get(letterOf(node.label)).push(node);
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
for (const list of buckets.values()) list.sort((a, b) => collator.compare(a.label, b.label));

const total = graph.nodes.length;

const letterNav = (active) =>
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
`;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'style.css'), CSS);

const sitemapPaths = ['/', '/artists/'];

writeFileSync(
  join(OUT, 'index.html'),
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
  const slug = slugOf(letter);
  const path = `/artists/${slug}/`;
  const heading = letter === '#' ? 'Artists: 0–9 & other scripts' : `Artists starting with ${letter}`;
  mkdirSync(join(OUT, slug), { recursive: true });
  writeFileSync(
    join(OUT, slug, 'index.html'),
    page({
      path,
      title: `${heading} | Music Atlas`,
      description: `Browse ${fmt(artists.length)} artists ${letter === '#' ? 'whose names start with a number or non-Latin script' : `starting with ${letter}`} on Music Atlas. Select any artist to see their genre neighborhood on the map.`,
      body: `<h1>${esc(heading)}</h1>
<p class="lede">${fmt(artists.length)} artists. Select one to see where they sit on the map and who they share playlists with.</p>
${letterNav(letter)}
<ul class="artists">${artists
        .map((a) => `<li><a href="/?artist=${encodeURIComponent(a.id)}">${esc(a.label)}</a>${a.primaryGenre ? `<span>${esc(a.primaryGenre)}</span>` : ''}</li>`)
        .join('')}</ul>`,
    }),
  );
  sitemapPaths.push(path);
}

writeFileSync(
  join(DIST, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapPaths.map((p) => `  <url><loc>${SITE}${p}</loc></url>`).join('\n')}
</urlset>
`,
);

console.log(`artist index: ${fmt(total)} artists across ${sitemapPaths.length - 2} letter pages`);
