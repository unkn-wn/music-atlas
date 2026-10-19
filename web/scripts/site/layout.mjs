// Shared HTML shell, styles and formatting helpers for the static pages
import { MAP_LINK_SVG } from '../../src/site/icons';

export const SITE = 'https://music-atlas.app';
/** Replaced with the bundled search script's URL when pages are served or written */
export const SEARCH_SCRIPT_PLACEHOLDER = '%SITE_SEARCH_SRC%';
const PAGE_WINDOW = 2;
const DEFAULT_OG_IMAGE = { url: `${SITE}/og-image.jpg`, width: 1200, height: 630, card: 'summary_large_image' };

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const fmt = (n) => n.toLocaleString('en-US');
/** A name in running text, isolated so right-to-left names (Arabic, Hebrew) don't reorder the sentence around them */
export const nameHtml = (name) => `<bdi>${esc(name)}</bdi>`;
/** "Drake's", "The Chainsmokers'" as HTML */
export const possessive = (name) => `${nameHtml(name)}${/s$/i.test(name) ? "'" : "'s"}`;
export const pct = (part, whole) => `${Math.round((100 * part) / whole)}%`;

/** Opens an artist (or anything else) in the atlas; nofollow so crawlers don't queue every deep link to the homepage */
export const mapHref = (params) => `/?${new URLSearchParams(params)}`;
export const mapLink = (node) =>
  `<a class="maplink" href="${esc(mapHref({ artist: node.id }))}" rel="nofollow" title="View on the map" aria-label="View ${esc(node.label)} on the map">${MAP_LINK_SVG}</a>`;

// "<" escaped so a name can never close the script element
const jsonLdScript = (graph) =>
  `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c')}</script>`;

const breadcrumbList = (crumbs) => ({
  '@type': 'BreadcrumbList',
  itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: `${SITE}${c.path}` })),
});

const breadcrumbNav = (crumbs) =>
  `<nav class="crumbs" aria-label="Breadcrumb"><ol>${crumbs
    .map((c, i) => (i === crumbs.length - 1 ? `<li aria-current="page">${esc(c.name)}</li>` : `<li><a href="${c.path}">${esc(c.name)}</a></li>`))
    .join('')}</ol></nav>`;

/**
 * A full page. `crumbs` ([{ name, path }], Home first, this page last) renders the visible trail and its
 * BreadcrumbList; `jsonLd` adds more schema.org nodes; `ogImage` overrides the site's share image.
 */
export const page = ({ path, title, description, body, crumbs, jsonLd = [], ogImage = DEFAULT_OG_IMAGE }) => `<!doctype html>
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
<meta name="color-scheme" content="dark" />
<style>html{background:#090b10}</style>
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Music Atlas" />
<meta property="og:url" content="${SITE}${path}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:image" content="${esc(ogImage.url)}" />
<meta property="og:image:width" content="${ogImage.width}" />
<meta property="og:image:height" content="${ogImage.height}" />
<meta name="twitter:card" content="${ogImage.card}" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;800&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/artists/style.css" />
<script type="module" src="${SEARCH_SCRIPT_PLACEHOLDER}"></script>
${jsonLdScript([breadcrumbList(crumbs), ...jsonLd])}
</head>
<body>
<header>
<a class="brand" href="/"><img src="/favicon.svg" alt="" width="28" height="28" />Music Atlas</a>
<nav class="links"><a href="/artists/">Artists</a><a href="/genres/">Genres</a></nav>
<div class="search"><input id="site-search" type="search" placeholder="Search artists &amp; genres" autocomplete="off" aria-label="Search artists and genres" /><div id="site-search-results" class="results" hidden></div></div>
<a class="cta" href="/">Open the map →</a>
</header>
<main>
${breadcrumbNav(crumbs)}
${body}
</main>
</body>
</html>
`;

export const HOME_CRUMB = { name: 'Home', path: '/' };

/** Splits a list into pages of `size` */
export const paginate = (list, size) => {
  const pages = [];
  for (let i = 0; i < list.length; i += size) pages.push(list.slice(i, i + size));
  return pages;
};

/** Prev / 1 … 4 5 [6] 7 8 … 26 / Next: the first, last and nearby pages, with gaps elided */
export const paginationNav = (paths, current) => {
  if (paths.length < 2) return '';
  const shown = paths.map((_, i) => i).filter((i) => i === 0 || i === paths.length - 1 || Math.abs(i - current) <= PAGE_WINDOW);
  const numbered = shown
    .map((i, k) => {
      const gap = k > 0 && i - shown[k - 1] > 1 ? '<span class="gap">…</span>' : '';
      const link = i === current ? `<a href="${paths[i]}" class="active" aria-current="page">${i + 1}</a>` : `<a href="${paths[i]}">${i + 1}</a>`;
      return gap + link;
    })
    .join('');
  const prev = current > 0 ? `<a href="${paths[current - 1]}">← Prev</a>` : '';
  const next = current < paths.length - 1 ? `<a href="${paths[current + 1]}">Next →</a>` : '';
  return `<nav class="pages" aria-label="Pages">${prev}${numbered}${next}</nav>`;
};

/** " (page 2 of 5)" on every page but the first */
export const pageSuffix = (current, count) => (current > 0 ? ` (page ${current + 1} of ${count})` : '');

export const CSS = `*{box-sizing:border-box}
body{margin:0;background:#090b10;color:#e2e8f0;font-family:'Plus Jakarta Sans',system-ui,sans-serif;line-height:1.5}
a{color:inherit}
header{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;align-items:center;gap:12px 18px;padding:14px max(16px,calc((100% - 1100px)/2));background:rgba(9,11,16,.9);backdrop-filter:blur(12px);border-bottom:1px solid rgba(255,255,255,.08)}
.links{display:flex;gap:18px;font-size:14px;font-weight:600}
.search{position:relative;flex:1 1 220px;max-width:380px;margin-left:auto}
.search input{width:100%;padding:8px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#f1f5f9;font:inherit;font-size:14px;outline:none}
.search input:focus{border-color:#34d399}
.results{position:absolute;top:calc(100% + 8px);left:0;right:0;max-height:min(420px,70vh);overflow-y:auto;padding:6px;border-radius:14px;background:#0f131b;border:1px solid rgba(255,255,255,.12);box-shadow:0 16px 40px rgba(0,0,0,.5)}
.result-list{list-style:none;margin:0;padding:0}
.result{display:flex;align-items:center;gap:6px;padding:7px 10px;border-radius:10px}
.result:hover{background:rgba(255,255,255,.05)}
.result-name{flex:1;min-width:0;text-decoration:none;font-weight:600;font-size:14px;color:#f1f5f9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
a.result-name:hover{color:#34d399}
.result-name small{margin-left:8px;font-weight:400;font-size:12px;color:#64748b}
.result-empty{margin:0;padding:8px 10px;font-size:13px;color:#64748b}
.plain{font-weight:600;color:#94a3b8}
.pages .gap{align-self:center;color:#64748b;padding:0 2px}
.links a{text-decoration:none;color:#94a3b8}
.links a:hover{color:#34d399}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:.04em;text-decoration:none;text-transform:uppercase;font-size:14px}
.cta{font-weight:800;font-size:13px;color:#090b10;background:linear-gradient(90deg,#34d399,#22d3ee);padding:8px 16px;border-radius:999px;text-decoration:none;white-space:nowrap}
main{max-width:1100px;margin:0 auto;padding:24px 16px 80px}
h1{font-size:clamp(28px,5vw,44px);font-weight:800;letter-spacing:-.02em;margin:0 0 8px;color:#fff;overflow-wrap:anywhere}
.lede{color:#94a3b8;margin:0 0 28px;max-width:640px}
.crumbs ol{display:flex;flex-wrap:wrap;gap:6px;list-style:none;padding:0;margin:0 0 20px;font-size:13px;color:#64748b}
.crumbs li+li::before{content:'›';margin-right:6px}
.crumbs a{text-decoration:none;color:#94a3b8}
.crumbs a:hover{color:#34d399}
.letters,.pages{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:32px}
.letters a,.pages a{min-width:38px;padding:7px 10px;text-align:center;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);text-decoration:none;font-weight:600;font-size:14px}
.pages a{font-size:13px}
.letters a:hover,.pages a:hover{border-color:#34d399;color:#34d399}
.letters a.active,.pages a.active{background:#10b981;border-color:#10b981;color:#090b10}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;list-style:none;padding:0;margin:0}
.grid a{display:block;padding:16px;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);text-decoration:none}
.grid a:hover{border-color:#34d399}
.grid strong{display:block;font-size:24px;color:#fff}
.grid span{font-size:13px;color:#94a3b8}
.artists{columns:260px;column-gap:32px;list-style:none;padding:0;margin:0 0 24px}
.artists li{break-inside:avoid;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.artists a{font-weight:600;text-decoration:none;color:#f1f5f9}
.artists a:hover,.rows a:hover{color:#34d399}
.artists span{display:block;font-size:12px;color:#64748b}
.lede a,.source a{color:#34d399}
.cta.inline,.cta.ghost{display:inline-block;margin:0 8px 12px 0}
.cta.ghost{background:none;color:#e2e8f0;border:1px solid rgba(255,255,255,.2)}
.actions{margin:0 0 16px}
h2{font-size:18px;color:#fff;margin:32px 0 12px}
h2[id]{scroll-margin-top:72px}
.chips{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0;margin:0}
.chips a,.chips span{display:block;padding:6px 12px;border-radius:999px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);text-decoration:none;font-size:14px}
.chips a:hover{border-color:#34d399;color:#34d399}
.source{font-size:12px;color:#64748b;margin:0 0 8px}
.profile{display:flex;gap:20px;align-items:center;margin-bottom:20px}
.profile img{width:120px;height:120px;border-radius:50%;object-fit:cover;flex-shrink:0;background:rgba(255,255,255,.05)}
.profile .lede{margin:0}
.rows{list-style:none;padding:0;margin:0;max-width:760px}
.rows li{padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06)}
.rows a{font-weight:600;text-decoration:none;color:#f1f5f9}
.rows .meta{margin-left:8px;font-size:13px;color:#94a3b8}
.rows .note{display:block;font-size:12px;color:#64748b}
.footprint{display:block;width:100%;max-width:600px;height:auto;margin:0 0 24px;border-radius:16px;background:#0d1017;border:1px solid rgba(255,255,255,.06)}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:8px;vertical-align:baseline}
a.maplink{display:inline-flex;align-items:center;justify-content:center;padding:6px;margin:-6px -2px -6px 0;color:#475569;vertical-align:middle}
a.maplink:hover{color:#34d399}
@media (max-width:560px){.profile{flex-direction:column;align-items:flex-start}.profile img{width:96px;height:96px}header .cta{display:none}.search{flex-basis:100%;max-width:none;margin-left:0}}
`;
