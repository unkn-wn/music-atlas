import { AtlasNode } from '../types/atlas';

export interface IndexedNode {
  node: AtlasNode;
  normLabel: string;
  firstWord: string;
  words: string[];
  normPrimary: string;
  normSubgenres: string[];
  normContinent: string;
  subscribers: number;
}

/**
 * Normalizes diacritics, lowercase, and trims whitespace for robust global search.
 */
export function normalizeSearchText(str: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Pre-indexes search metadata pre-sorted by popularity (subscribers descending).
 * Should be built once on graph load to eliminate per-keystroke string allocations.
 */
export function buildSearchIndex(nodes: AtlasNode[]): IndexedNode[] {
  if (!nodes || nodes.length === 0) return [];
  const len = nodes.length;
  const list: IndexedNode[] = new Array(len);

  for (let i = 0; i < len; i++) {
    const n = nodes[i];
    const normLabel = normalizeSearchText(n.label || '');
    const words = normLabel ? normLabel.split(/[\s\-_–—,.'"/]+/).filter(Boolean) : [];
    const rawPrimary = normalizeSearchText(n.primaryGenre || '');
    const normPrimary = !['other', 'artist', 'unknown', 'eclectic'].includes(rawPrimary)
      ? rawPrimary
      : '';
    const normSubgenres = (n.topSubgenres || [])
      .map((g) => normalizeSearchText(g || ''))
      .filter(Boolean);
    const normContinent = normalizeSearchText(n.continentName || '');

    list[i] = {
      node: n,
      normLabel,
      firstWord: words[0] || '',
      words,
      normPrimary,
      normSubgenres,
      normContinent,
      subscribers: n.subscribers || 0
    };
  }

  // Pre-sort by subscribers descending so all priority buckets are automatically popularity-ranked
  list.sort((a, b) => b.subscribers - a.subscribers);
  return list;
}

/**
 * Executes tiered search matching over the pre-indexed nodes.
 * Priority buckets: exact -> startsWith -> wordStartsWith -> allTokensMatch -> contains -> genre/continent.
 */
export function searchArtists(
  indexedNodes: IndexedNode[],
  query: string,
  limit: number = 10
): AtlasNode[] {
  const trimmed = query.trim();
  if (!trimmed || indexedNodes.length === 0) return [];

  const qNorm = normalizeSearchText(trimmed);
  if (!qNorm) return [];

  const qTokens = qNorm.split(/\s+/).filter(Boolean);
  const isSingleWord = qTokens.length <= 1;

  // Priority buckets (items within each bucket are already popularity-sorted)
  const exact: AtlasNode[] = [];
  const starts: AtlasNode[] = [];
  const wordStarts: AtlasNode[] = [];
  const allTokensMatch: AtlasNode[] = [];
  const contains: AtlasNode[] = [];
  const genreMatches: AtlasNode[] = [];

  const maxEarlyBreak = 25;

  for (let i = 0; i < indexedNodes.length; i++) {
    const item = indexedNodes[i];
    const { normLabel, firstWord, words, normPrimary, normSubgenres, normContinent } = item;

    // Fast-reject check: if the label contains the query, test artist name match tiers
    const hasSubstring = normLabel.includes(qNorm);

    if (hasSubstring) {
      if (normLabel === qNorm) {
        exact.push(item.node);
      } else if (firstWord === qNorm || normLabel.startsWith(qNorm)) {
        starts.push(item.node);
      } else {
        let wordMatched = false;
        for (let j = 0; j < words.length; j++) {
          if (words[j].startsWith(qNorm)) {
            wordStarts.push(item.node);
            wordMatched = true;
            break;
          }
        }
        if (!wordMatched && qNorm.length > 1) {
          contains.push(item.node);
        }
      }
    } else if (!isSingleWord) {
      // Multi-word search (e.g. "taylor swift" or "daft punk")
      let allTokensInLabel = true;
      for (let t = 0; t < qTokens.length; t++) {
        if (!normLabel.includes(qTokens[t])) {
          allTokensInLabel = false;
          break;
        }
      }
      if (allTokensInLabel) {
        allTokensMatch.push(item.node);
      }
    }

    // Secondary: Genre or Continent matches (only when query length > 2)
    if (qNorm.length > 2) {
      if (normPrimary.includes(qNorm) || normContinent.includes(qNorm)) {
        genreMatches.push(item.node);
      } else {
        for (let g = 0; g < normSubgenres.length; g++) {
          if (normSubgenres[g].includes(qNorm)) {
            genreMatches.push(item.node);
            break;
          }
        }
      }
    }

    // Early break if we already have plenty of top name matches
    if (exact.length + starts.length + wordStarts.length >= maxEarlyBreak) {
      break;
    }
  }

  // Collect top results in strict priority order
  const results: AtlasNode[] = [];
  const seen = new Set<string>();
  const buckets = [exact, starts, wordStarts, allTokensMatch, contains, genreMatches];

  for (let b = 0; b < buckets.length; b++) {
    const bucket = buckets[b];
    for (let i = 0; i < bucket.length; i++) {
      const node = bucket[i];
      if (!seen.has(node.id)) {
        seen.add(node.id);
        results.push(node);
        if (results.length >= limit) return results;
      }
    }
  }

  return results;
}
