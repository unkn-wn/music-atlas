// /genres/ index and a page per genre: who's in it, where it sits on the map, its strongest pairings and
// related genres, all computed from the atlas
import { slugify, findRelatedGenres, formatInception, groupByContinent } from '../../src/utils/genreUtils';
import { filterValidSubgenres, formatSubscriberCount } from '../../src/utils/artistUtils';
import { SITE, HOME_CRUMB, esc, fmt, pct, mapHref, page, paginate, paginationNav, pageSuffix } from './layout.mjs';
import { PAGE_SIZE, pagePath, letterOf, letterSlug } from './context.mjs';
import { createProjection, footprintSvg } from './footprint.mjs';

const GENRES_CRUMB = { name: 'Genres', path: '/genres/' };
const MAX_CONTINENTS_SHOWN = 6;
const MAX_PAIRINGS = 10;
const BRIDGE_ARTISTS = 3;
const MAX_ITEM_LIST = 100;

// Each genre's strongest member-member links, in one pass over the edges: an edge counts for every genre both ends share
const strongestPairings = (ctx) => {
  const pairings = new Map();
  for (const edge of ctx.edges) {
    const a = ctx.nodeById.get(edge.source);
    const b = ctx.nodeById.get(edge.target);
    if (!a || !b) continue;
    const bGenres = filterValidSubgenres(b.topSubgenres);
    for (const genre of filterValidSubgenres(a.topSubgenres)) {
      if (!bGenres.includes(genre) || !ctx.genrePaths.has(genre)) continue;
      if (!pairings.has(genre)) pairings.set(genre, []);
      pairings.get(genre).push({ a, b, playlists: edge.playlists ?? 0 });
    }
  }
  for (const [genre, list] of pairings) pairings.set(genre, list.sort((x, y) => y.playlists - x.playlists).slice(0, MAX_PAIRINGS));
  return pairings;
};

const genreLink = (ctx, name) => (ctx.genrePaths.has(name) ? `<a href="${ctx.genrePaths.get(name)}">${esc(name)}</a>` : esc(name));

const aboutSection = (info) => {
  const era = info?.since ? ` Emerged ${esc(formatInception(info.since))}.` : '';
  if (info?.desc) {
    return `<p class="lede">${esc(info.desc.charAt(0).toUpperCase() + info.desc.slice(1))}.${era}${info.wiki ? ` <a href="${esc(info.wiki)}">Wikipedia</a>` : ''}</p><p class="source">Description from Wikidata (CC0).</p>`;
  }
  return era ? `<p class="lede">${era.trim()}</p>` : '';
};

// Page 1 carries the analysis; later pages continue the artist list
const overviewSections = (ctx, genre, members, related, pairings, projection) => {
  const listeners = members.reduce((sum, n) => sum + (n.subscribers || 0), 0);
  const groups = groupByContinent(members, [...ctx.continents.values()], (n) => n.continentId);
  const home = groups[0];
  const summary = `<p class="lede">${fmt(members.length)} artists with ${formatSubscriberCount(listeners)} combined listeners.${home ? ` ${pct(home.members.length, members.length)} of them sit in the ${esc(home.continent.name)} community on the map.` : ''}${related[0] ? ` It shares the most artists with ${genreLink(ctx, related[0].name)}.` : ''}</p>`;

  const where = groups.length
    ? `<h2>Where ${esc(genre)} sits on the map</h2>
${footprintSvg(genre, members, projection)}
<ul class="rows">${groups
        .slice(0, MAX_CONTINENTS_SHOWN)
        .map(({ continent, members: list }) => `<li><span class="dot" style="background:${continent.color}"></span>${esc(continent.name)} <span class="meta">· ${fmt(list.length)} artists (${pct(list.length, members.length)})</span></li>`)
        .join('')}</ul>`
    : '';

  const pairs = pairings?.length
    ? `<h2>Strongest pairings in ${esc(genre)}</h2>
<p class="source">${esc(genre)} artists who most often share real, user-made playlists.</p>
<ol class="rows">${pairings
        .map(({ a, b, playlists }) => `<li>${ctx.artistLink(a)} &amp; ${ctx.artistLink(b)} <span class="meta">· ${fmt(playlists)} shared playlists</span></li>`)
        .join('')}</ol>`
    : '';

  const relatedList = related.length
    ? `<h2>Related genres</h2>
<p class="source">Genres that share the most artists with ${esc(genre)}, for their size.</p>
<ul class="rows">${related
        .map((r) => {
          const bridges = members.filter((n) => filterValidSubgenres(n.topSubgenres).includes(r.name)).slice(0, BRIDGE_ARTISTS);
          return `<li>${genreLink(ctx, r.name)} <span class="meta">· ${fmt(r.sharedArtists)} shared artists</span><span class="note">Both: ${bridges.map((n) => ctx.artistLink(n)).join(', ')}</span></li>`;
        })
        .join('')}</ul>`
    : '';

  return `${summary}${where}${pairs}${relatedList}`;
};

const genrePages = (ctx, genre, members, pairings, projection, html) => {
  const basePath = ctx.genrePaths.get(genre);
  const pages = paginate(members, PAGE_SIZE);
  const pagePaths = pages.map((_, i) => pagePath(basePath, i));
  const related = findRelatedGenres(
    genre,
    members,
    (node) => filterValidSubgenres(node.topSubgenres),
    (name) => ctx.genres.get(name)?.length ?? 1,
  );
  const info = Object.prototype.hasOwnProperty.call(ctx.genreInfo, genre) ? ctx.genreInfo[genre] : undefined;
  const top = members.slice(0, 3).map((a) => a.label).join(', ');

  pages.forEach((list, i) => {
    const path = pagePaths[i];
    const suffix = pageSuffix(i, pages.length);
    const firstRank = i * PAGE_SIZE + 1;
    const listed = list.filter((n) => ctx.artistPaths.has(n.id)).slice(0, MAX_ITEM_LIST);
    html(
      path,
      page({
        path,
        title: i === 0 ? `${genre} Artists & Related Genres | Music Atlas` : `${genre} Artists${suffix} | Music Atlas`,
        description: `${fmt(members.length)} ${genre} artists, including ${top}, mapped by real community playlists. See where ${genre} sits on the map, its strongest pairings and related genres.${suffix}`,
        crumbs: [HOME_CRUMB, GENRES_CRUMB, { name: `${genre}${suffix}`, path }],
        jsonLd: [
          {
            '@type': 'CollectionPage',
            name: `${genre} artists${suffix}`,
            url: `${SITE}${path}`,
            ...(listed.length && {
              mainEntity: {
                '@type': 'ItemList',
                itemListElement: listed.map((n, rank) => ({ '@type': 'ListItem', position: rank + 1, name: n.label, url: `${SITE}${ctx.artistPaths.get(n.id)}` })),
              },
            }),
          },
        ],
        body: `<h1>${esc(genre)}${esc(suffix)}</h1>
${i === 0 ? aboutSection(info) : ''}
<div class="actions"><a class="cta inline" href="${esc(mapHref({ genre: slugify(genre) }))}" rel="nofollow">Open ${esc(genre)} on the map →</a></div>
${i === 0 ? overviewSections(ctx, genre, members, related, pairings, projection) : ''}
<h2 id="artists">Artists${i === 0 ? '' : `, ${fmt(firstRank)}–${fmt(firstRank + list.length - 1)}`}</h2>
<p class="source">${fmt(members.length)} artists tagged ${esc(genre)}, ranked by listeners.</p>
${paginationNav(pagePaths, i)}
<ol class="artists" start="${firstRank}">${list
          .map((a) => `<li>${ctx.artistLink(a)}<span>${formatSubscriberCount(a.subscribers)} listeners${a.primaryGenre && a.primaryGenre !== genre ? ` · ${esc(a.primaryGenre)}` : ''}</span></li>`)
          .join('')}</ol>
${paginationNav(pagePaths, i)}`,
      }),
    );
  });
  return pagePaths;
};

/** Adds the genre index and genre pages to `html(path, body)`; returns their sitemap paths */
export const buildGenrePages = (ctx, html) => {
  const names = [...ctx.genrePaths.keys()].sort((a, b) => ctx.collator.compare(a, b));
  const byLetter = new Map();
  for (const name of names) {
    const letter = letterOf(name);
    if (!byLetter.has(letter)) byLetter.set(letter, []);
    byLetter.get(letter).push(name);
  }

  html(
    '/genres/',
    page({
      path: '/genres/',
      title: `All ${fmt(names.length)} Genres | Music Atlas`,
      description: `Browse ${fmt(names.length)} music genres on Music Atlas, each with its artists, related genres and where it sits on the map of real community playlists.`,
      crumbs: [HOME_CRUMB, GENRES_CRUMB],
      body: `<h1>Every genre on the map</h1>
<p class="lede">${fmt(names.length)} genres from EveryNoise with at least five artists, each holding the artists whose playlists tag them with it. Pick one to see its artists, where it sits on the map and its related genres.</p>
<nav class="letters" aria-label="Genres by letter">${[...byLetter.keys()].map((l) => `<a href="#${letterSlug(l)}">${l}</a>`).join('')}</nav>
${[...byLetter]
  .map(
    ([letter, list]) => `<h2 id="${letterSlug(letter)}">${letter === '#' ? '0–9 &amp; other' : letter}</h2>
<ul class="artists">${list.map((g) => `<li><a href="${ctx.genrePaths.get(g)}">${esc(g)}</a><span>${fmt(ctx.genres.get(g).length)} artists</span></li>`).join('')}</ul>`,
  )
  .join('\n')}`,
    }),
  );

  const pairings = strongestPairings(ctx);
  const projection = createProjection(ctx.nodes);
  const paths = ['/genres/'];
  for (const genre of names) paths.push(...genrePages(ctx, genre, ctx.genres.get(genre), pairings.get(genre), projection, html));
  return { genreCount: names.length, paths, projection };
};
