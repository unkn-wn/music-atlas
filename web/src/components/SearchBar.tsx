import React, { useState, useRef, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { AtlasNode } from '../types/atlas';

interface SearchBarProps {
  nodes: AtlasNode[];
  onSelectArtist: (artistId: string) => void;
  selectedArtistId: string | null;
}

interface IndexedNode {
  node: AtlasNode;
  normLabel: string;
  firstWord: string;
  words: string[];
  normPrimary: string;
  normSubgenres: string[];
  normContinent: string;
  subscribers: number;
}

// Normalize diacritics, lowercase, and trim for robust global search
const normalizeSearchText = (str: string): string => {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
};

export const SearchBar: React.FC<SearchBarProps> = ({
  nodes,
  onSelectArtist,
  selectedArtistId
}) => {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Defer query updates so typing remains buttery smooth at 120 FPS without input lag
  const deferredQuery = React.useDeferredValue(query);

  // Pre-indexed search metadata pre-sorted by popularity (subscribers desc)
  // Built only once when graph data loads — completely eliminates per-keystroke string allocations
  const indexedNodes = React.useMemo<IndexedNode[]>(() => {
    if (!nodes || nodes.length === 0) return [];
    const len = nodes.length;
    const list: IndexedNode[] = new Array(len);

    for (let i = 0; i < len; i++) {
      const n = nodes[i];
      const normLabel = normalizeSearchText(n.label || '');
      const words = normLabel ? normLabel.split(/[\s\-_–—,.'"/]+/).filter(Boolean) : [];
      const rawPrimary = normalizeSearchText(n.primaryGenre || '');
      const normPrimary = !['other', 'artist', 'unknown', 'eclectic'].includes(rawPrimary) ? rawPrimary : '';
      const normSubgenres = (n.topSubgenres || []).map((g) => normalizeSearchText(g || '')).filter(Boolean);
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
  }, [nodes]);

  // Ultra-fast tiered matching over pre-indexed nodes
  const filteredArtists = React.useMemo(() => {
    const trimmed = deferredQuery.trim();
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

    // Collect top 10 unique results in strict priority order
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
          if (results.length >= 10) return results;
        }
      }
    }

    return results;
  }, [indexedNodes, deferredQuery]);

  // Reset active keyboard index when search results change
  useEffect(() => {
    setActiveIndex(0);
  }, [filteredArtists]);

  // Global keyboard shortcuts and dropdown navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey && e.key === 'k') || (e.key === '/' && document.activeElement !== inputRef.current)) {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
        return;
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
        inputRef.current?.blur();
        return;
      }

      if (isOpen && filteredArtists.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActiveIndex((prev) => (prev + 1) % filteredArtists.length);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActiveIndex((prev) => (prev - 1 + filteredArtists.length) % filteredArtists.length);
        } else if (e.key === 'Enter') {
          if (activeIndex >= 0 && activeIndex < filteredArtists.length) {
            e.preventDefault();
            handleSelect(filteredArtists[activeIndex].id);
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredArtists, activeIndex]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: PointerEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, []);

  const handleSelect = (id: string) => {
    onSelectArtist(id);
    setIsOpen(false);
    setQuery('');
  };

  return (
    <div className="relative w-full" ref={dropdownRef}>
      <div className="glass-panel h-10 flex items-center px-3 sm:px-3.5 shadow-xl transition-all focus-within:border-emerald-500/60 focus-within:ring-2 focus-within:ring-emerald-500/20">
        <Search className="w-4 h-4 text-slate-400 mr-2 sm:mr-2.5 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder="Search artist or genre..."
          className="w-full bg-transparent border-none outline-none text-base sm:text-sm text-slate-100 placeholder-slate-500 min-w-0"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            className="p-0.5 hover:text-white text-slate-400 flex items-center justify-center shrink-0 bg-transparent border-none outline-none cursor-pointer leading-none ml-1.5"
            title="Clear search"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] text-slate-400 bg-white/5 border border-white/10 rounded ml-2">
          /
        </kbd>
      </div>

      {/* Autocomplete Dropdown */}
      {isOpen && filteredArtists.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-2 glass-panel p-1.5 shadow-2xl z-50 max-h-96 overflow-y-auto border border-white/20">
          {filteredArtists.map((artist, idx) => {
            const cleanSubgenres = (artist.topSubgenres || []).filter(
              (g) => g && !['other', 'artist', 'unknown', 'eclectic'].includes(g.trim().toLowerCase())
            );
            const firstSubgenre = cleanSubgenres[0] || '';
            const rawPrimary = artist.primaryGenre ? artist.primaryGenre.trim() : '';
            const hasPrimary = Boolean(
              rawPrimary &&
              !['other', 'artist', 'unknown', 'eclectic'].includes(rawPrimary.toLowerCase()) &&
              (!firstSubgenre || rawPrimary.toLowerCase() !== firstSubgenre.toLowerCase())
            );

            let genreDisplay = '';
            if (hasPrimary && firstSubgenre) {
              genreDisplay = `${rawPrimary} • ${firstSubgenre}`;
            } else if (hasPrimary) {
              genreDisplay = rawPrimary;
            } else if (firstSubgenre) {
              genreDisplay = firstSubgenre;
            }

            const isActive = activeIndex === idx;

            return (
              <button
                key={artist.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                }}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => handleSelect(artist.id)}
                className={`w-full flex items-center gap-3 p-2 rounded-lg cursor-pointer text-left ${
                  isActive || selectedArtistId === artist.id ? 'bg-white/15 text-white' : 'hover:bg-white/10 text-slate-200'
                }`}
              >
                {/* Artist Icon with background border of that artist's color */}
                <div
                  className="w-9 h-9 rounded-full shrink-0 overflow-hidden flex items-center justify-center bg-white/5 border-2"
                  style={{ borderColor: artist.color }}
                >
                  <img
                    src={artist.image}
                    alt={artist.label}
                    referrerPolicy="no-referrer"
                    crossOrigin="anonymous"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                </div>

                {/* Vertically aligned Name and Genre */}
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <span className="text-sm font-semibold text-white truncate leading-tight">
                    {artist.label}
                  </span>
                  {genreDisplay ? (
                    <span className="text-xs text-slate-400 truncate mt-0.5 leading-tight">
                      {genreDisplay}
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
