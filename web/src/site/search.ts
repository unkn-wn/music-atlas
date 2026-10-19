// Header search on the static pages: every artist and genre, using the app's own search ranking.
// The index (/search-index.json, written by scripts/site/) is fetched on first focus.
import { AtlasNode } from '../types/atlas';
import { buildSearchIndex, buildGenreSearchIndex, searchArtists, searchGenres, IndexedNode, IndexedGenre } from '../utils/searchEngine';
import { MAP_LINK_SVG } from './icons';

/** Artists most popular first: [name, Deezer node id, page path or 0, primary genre]; genres: [name, page path, artist count] */
interface SearchIndexFile {
  artists: [string, string, string | 0, string][];
  genres: [string, string, number][];
}

interface LoadedIndex {
  artists: IndexedNode[];
  genres: IndexedGenre[];
  pathOf: Map<string, string>;
  genrePaths: Map<string, string>;
}

const ARTIST_RESULTS = 10;
const GENRE_RESULTS = 4;

const input = document.getElementById('site-search') as HTMLInputElement | null;
const results = document.getElementById('site-search-results');

let indexPromise: Promise<LoadedIndex> | null = null;

const loadIndex = () =>
  (indexPromise ??= fetch('/search-index.json')
    .then((res) => {
      if (!res.ok) throw new Error(`Status ${res.status}`);
      return res.json() as Promise<SearchIndexFile>;
    })
    .then((file) => {
      const pathOf = new Map<string, string>();
      // Only the fields the search reads; the file is already in popularity order
      const nodes = file.artists.map(([label, id, path, primaryGenre]) => {
        if (path) pathOf.set(id, path);
        return { id, label, primaryGenre, topSubgenres: [], subscribers: 0 } as unknown as AtlasNode;
      });
      return {
        artists: buildSearchIndex(nodes),
        genres: buildGenreSearchIndex(file.genres.map(([name, , count]) => [name, count])),
        pathOf,
        genrePaths: new Map(file.genres.map(([name, path]) => [name, path])),
      };
    })
    .catch((err) => {
      indexPromise = null;
      throw err;
    }));

const el = (tag: string, className: string, text?: string) => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const row = (name: string, detail: string, href: string | null, mapHref?: string) => {
  const item = el('li', 'result');
  const main = href ? Object.assign(el('a', 'result-name'), { href }) : el('strong', 'result-name plain');
  main.append(name);
  if (detail) main.append(el('small', '', detail));
  item.append(main);
  if (mapHref) {
    const pin = Object.assign(el('a', 'maplink'), { href: mapHref, rel: 'nofollow', title: 'View on the map' });
    pin.setAttribute('aria-label', `View ${name} on the map`);
    pin.innerHTML = MAP_LINK_SVG;
    item.append(pin);
  }
  return item;
};

const render = (index: LoadedIndex, query: string) => {
  if (!results) return;
  results.replaceChildren();
  if (!query.trim()) {
    results.hidden = true;
    return;
  }
  const list = el('ul', 'result-list');
  for (const genre of searchGenres(index.genres, query, GENRE_RESULTS)) {
    list.append(row(genre.name, `Genre · ${genre.artistCount.toLocaleString('en-US')} artists`, index.genrePaths.get(genre.name) ?? null));
  }
  for (const artist of searchArtists(index.artists, query, ARTIST_RESULTS)) {
    const path = index.pathOf.get(artist.id) ?? null;
    list.append(row(artist.label, artist.primaryGenre, path, path ? undefined : `/?artist=${encodeURIComponent(artist.id)}`));
  }
  results.append(list.childElementCount ? list : el('p', 'result-empty', 'No artists or genres match.'));
  results.hidden = false;
};

if (input && results) {
  const update = () =>
    loadIndex()
      .then((index) => render(index, input.value))
      .catch(() => {
        results.replaceChildren(el('p', 'result-empty', 'Search is unavailable right now.'));
        results.hidden = false;
      });

  // Warm the index on focus; a returning visitor's query shows its results again
  input.addEventListener('focus', () => (input.value ? update() : void loadIndex().catch(() => {})));
  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      results.hidden = true;
    } else if (e.key === 'Enter' && !results.hidden) {
      // The first result that is a page (an artist with only a map arrow has no page to open)
      const first = results.querySelector<HTMLAnchorElement>('a.result-name');
      if (first) window.location.href = first.href;
    }
  });
  document.addEventListener('click', (e) => {
    if (!(e.target instanceof Node) || !input.parentElement?.contains(e.target)) results.hidden = true;
  });
}
