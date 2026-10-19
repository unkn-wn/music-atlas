// A–Z artist index (/artists/, paginated letter pages) and a page per artist with enough playlist data
import { filterValidSubgenres, formatSubscriberCount } from '../../src/utils/artistUtils';
import { resolveArtistImageUrl } from '../../src/utils/imageUtils';
import { SITE, HOME_CRUMB, esc, fmt, nameHtml, possessive, mapHref, page, paginate, paginationNav, pageSuffix } from './layout.mjs';
import { PAGE_SIZE, pagePath } from './context.mjs';

const ARTISTS_CRUMB = { name: 'Artists', path: '/artists/' };

const letterNav = (letters, active) =>
  `<nav class="letters" aria-label="Artists by letter">${letters
    .map(({ letter, basePath }) => `<a href="${basePath}"${letter === active ? ' class="active" aria-current="page"' : ''}>${letter}</a>`)
    .join('')}</nav>`;

const buildLetterPages = (ctx, html) => {
  const paths = [];
  for (const { letter, basePath, artists } of ctx.letters) {
    const pages = paginate(artists, PAGE_SIZE);
    const pagePaths = pages.map((_, i) => pagePath(basePath, i));
    const heading = letter === '#' ? 'Artists: 0–9 & other scripts' : `Artists starting with ${letter}`;

    pages.forEach((list, i) => {
      const path = pagePaths[i];
      const suffix = pageSuffix(i, pages.length);
      html(
        path,
        page({
          path,
          title: `${heading}${suffix} | Music Atlas`,
          description: `Browse ${fmt(artists.length)} artists ${letter === '#' ? 'whose names start with a number or non-Latin script' : `starting with ${letter}`} on Music Atlas${suffix}: ${list[0].label} to ${list.at(-1).label}. Select any artist to see their genre neighborhood.`,
          crumbs: [HOME_CRUMB, ARTISTS_CRUMB, { name: `${letter}${suffix}`, path }],
          body: `<h1>${esc(heading)}${esc(suffix)}</h1>
<p class="lede">${fmt(artists.length)} artists. Select one to see who they share playlists with, or search for a name above.</p>
${letterNav(ctx.letters, letter)}
${paginationNav(pagePaths, i)}
<ul class="artists">${list
            .map((a) => `<li>${ctx.artistLink(a)}${a.primaryGenre ? `<span>${esc(a.primaryGenre)}</span>` : ''}</li>`)
            .join('')}</ul>
${paginationNav(pagePaths, i)}`,
        }),
      );
      paths.push(path);
    });
  }
  return paths;
};

// The most common primary genre among an artist's connections, if it covers at least two of them
const dominantNeighborGenre = (neighbors) => {
  const counts = new Map();
  for (const { node } of neighbors) if (node.primaryGenre) counts.set(node.primaryGenre, (counts.get(node.primaryGenre) ?? 0) + 1);
  const [genre, count] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [];
  return count >= 2 ? { genre, count } : null;
};

const artistPage = (ctx, node, path) => {
  const detail = ctx.details.get(node.id);
  const name = node.label;
  const neighbors = detail.topCrossovers.flatMap((c) => (ctx.nodeById.has(c.neighborId) ? [{ ...c, node: ctx.nodeById.get(c.neighborId) }] : []));
  const genres = filterValidSubgenres(node.topSubgenres);
  const continent = ctx.continents.get(node.continentId);
  const listeners = formatSubscriberCount(node.subscribers);
  const crumbLetter = ctx.indexPageOf.get(node.id);
  const top3 = neighbors.slice(0, 3).map((n) => n.node.label);
  const closest = neighbors[0];
  const dominant = dominantNeighborGenre(neighbors);

  const genreChips = genres.length
    ? `<h2>Genres</h2>
<ul class="chips">${genres
        .map((g) => (ctx.genrePaths.has(g) ? `<li><a href="${ctx.genrePaths.get(g)}">${esc(g)}</a></li>` : `<li><span>${esc(g)}</span></li>`))
        .join('')}</ul>`
    : '';

  const summary = closest
    ? `<p class="lede">${possessive(name)} closest match is ${ctx.artistLink(closest.node)}: they appear together in ${fmt(closest.sharedPlaylists)} playlists.${dominant ? ` ${dominant.count} of ${possessive(name)} ${neighbors.length} closest connections are ${esc(dominant.genre)} artists.` : ''}</p>`
    : '';

  const similar = neighbors.length
    ? `<h2 id="similar">Artists like ${esc(name)}</h2>
<ol class="rows">${neighbors
        .map(
          (n) => `<li>${ctx.artistLink(n.node)} <span class="meta">${n.node.primaryGenre ? `${esc(n.node.primaryGenre)} · ` : ''}${fmt(n.sharedPlaylists)} shared playlists · ${n.overlapPercent}% overlap</span><span class="note">${n.selfPercent}% of ${possessive(name)} playlists include ${nameHtml(n.node.label)}; ${n.neighborPercent}% of ${possessive(n.node.label)} include ${nameHtml(name)}.</span></li>`,
        )
        .join('')}</ol>`
    : '';

  const image = node.image ? resolveArtistImageUrl(node.image) : '';
  const profile = `<div class="profile">${image ? `<img src="${esc(image)}" alt="${esc(name)}" width="120" height="120" referrerpolicy="no-referrer" />` : ''}<div>
<h1>${esc(name)}</h1>
<p class="lede">${[node.primaryGenre && esc(node.primaryGenre), `${listeners} listeners`, `in ${fmt(detail.totalPlaylists)} user-made playlists`].filter(Boolean).join(' · ')}${continent ? `<br />Part of the ${esc(continent.name)} community on the map.` : ''}</p>
</div></div>`;

  const actions = `<div class="actions"><a class="cta inline" href="${esc(mapHref({ artist: node.id }))}" rel="nofollow">Open ${esc(name)} on the map →</a><a class="cta ghost" href="${esc(mapHref({ from: node.id }))}" rel="nofollow">Trace a path from ${esc(name)}</a>${detail.deezerUrl ? `<a class="cta ghost" href="${esc(detail.deezerUrl)}" target="_blank" rel="noopener">Listen on Deezer</a>` : ''}</div>`;

  return page({
    path,
    title: `Artists Like ${name}: ${neighbors.length} Similar Artists | Music Atlas`,
    description: `${neighbors.length} artists similar to ${name}${top3.length ? `, including ${top3.join(', ')}` : ''}, based on ${fmt(detail.totalPlaylists)} real user-made playlists.${genres.length ? ` Genres: ${genres.join(', ')}.` : ''}`,
    crumbs: [HOME_CRUMB, ARTISTS_CRUMB, { name: crumbLetter.letter, path: crumbLetter.path }, { name, path }],
    ogImage: node.image ? { url: node.image, width: 1000, height: 1000, card: 'summary' } : undefined,
    jsonLd: [
      {
        '@type': 'MusicGroup',
        '@id': `${SITE}${path}#artist`,
        name,
        url: `${SITE}${path}`,
        ...(node.image && { image: node.image }),
        ...(genres.length && { genre: genres }),
        ...(detail.deezerUrl && { sameAs: [detail.deezerUrl] }),
      },
    ],
    body: `${profile}
${actions}
${summary}
${genreChips}
${similar}`,
  });
};

/** Adds the A–Z index and the artist pages to `html(path, body)`; returns the sitemap paths of each */
export const buildArtistPages = (ctx, html) => {
  html(
    '/artists/',
    page({
      path: '/artists/',
      title: `All ${fmt(ctx.nodes.length)} Artists A–Z | Music Atlas`,
      description: `Browse all ${fmt(ctx.nodes.length)} artists on Music Atlas, mapped by genre and real community playlists. Pick any artist to see who they share playlists with.`,
      crumbs: [HOME_CRUMB, ARTISTS_CRUMB],
      body: `<h1>Every artist on the map</h1>
<p class="lede">${fmt(ctx.nodes.length)} artists who appear across at least four real, user-made playlists. Pick a letter, then select any artist to see who they share playlists with.</p>
<ul class="grid">${ctx.letters
        .map(({ letter, basePath, artists }) => `<li><a href="${basePath}"><strong>${letter}</strong><span>${fmt(artists.length)} artists${letter === '#' ? ' · 0–9 &amp; other scripts' : ''}</span></a></li>`)
        .join('')}</ul>`,
    }),
  );
  const indexPaths = ['/artists/', ...buildLetterPages(ctx, html)];

  const artistPaths = [];
  for (const [id, path] of ctx.artistPaths) {
    html(path, artistPage(ctx, ctx.nodeById.get(id), path));
    artistPaths.push(path);
  }
  return { indexPaths, artistPaths };
};
