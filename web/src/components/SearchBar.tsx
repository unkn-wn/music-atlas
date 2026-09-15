import React, { useState, useRef, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { AtlasNode } from '../types/atlas';

interface SearchBarProps {
  nodes: AtlasNode[];
  onSelectArtist: (artistId: string) => void;
  selectedArtistId: string | null;
}

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

  // Normalize diacritics, lowercase, and trim for robust global search
  const normalizeSearchText = (str: string): string => {
    if (!str) return '';
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  };

  // Compute hierarchical match score prioritizing artist names over genres
  const getSearchScore = (node: AtlasNode, qNorm: string, qTokens: string[]): number => {
    const labelNorm = normalizeSearchText(node.label || '');
    if (!labelNorm) return 0;

    // 1. Exact artist name match
    if (labelNorm === qNorm) return 10000;

    const labelTokens = labelNorm.split(/[\s\-_–—,.'"/]+/).filter(Boolean);

    // 2. Artist name starts with query as an exact whole word (e.g. "Taylor" -> "Taylor Swift")
    if (labelTokens[0] === qNorm) return 9000;

    // 3. Any word in artist name exactly equals query (e.g. "bach" -> "Johann Sebastian Bach")
    if (labelTokens.includes(qNorm)) return 8500;

    // 4. Artist name starts with query (e.g. "Bachman" -> "Bachman-Turner Overdrive")
    if (labelNorm.startsWith(qNorm)) return 7500;

    // 5. All query tokens appear in artist name (e.g. "sebastian bach" in "Johann Sebastian Bach")
    if (qTokens.length > 1 && qTokens.every((t) => labelNorm.includes(t))) return 7000;

    // 6. Any word in artist name starts with query
    if (labelTokens.some((w) => w.startsWith(qNorm))) return 5000;

    // 7. Substring match inside artist name
    if (labelNorm.includes(qNorm)) return 4000;

    // Next: Genre / Subgenre matches
    const rawPrimary = normalizeSearchText(node.primaryGenre || '');
    const primary = !['other', 'artist', 'unknown', 'eclectic'].includes(rawPrimary) ? rawPrimary : '';
    const subgenres = (node.topSubgenres || []).map((g) => normalizeSearchText(g || '')).filter(Boolean);

    // 8. Exact Primary Genre or Subgenre match (e.g. "classical")
    if (primary === qNorm || subgenres.includes(qNorm)) return 2000;

    // 9. Primary Genre or Subgenre starts with query (e.g. "bachata")
    if (primary.startsWith(qNorm) || subgenres.some((g) => g.startsWith(qNorm))) return 1500;

    // 10. Primary Genre or Subgenre contains query
    if (primary.includes(qNorm) || subgenres.some((g) => g.includes(qNorm))) return 1000;

    // 11. Continent name matches
    const continent = normalizeSearchText(node.continentName || '');
    if (continent.includes(qNorm)) return 500;

    return 0;
  };

  // Rank matching artists prioritizing exact name matches, then whole words, then genres
  const filteredArtists = React.useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const qNorm = normalizeSearchText(trimmed);
    const qTokens = qNorm.split(/\s+/).filter(Boolean);

    const scored: { node: AtlasNode; score: number }[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const score = getSearchScore(node, qNorm, qTokens);
      if (score > 0) {
        scored.push({ node, score });
      }
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const subsA = a.node.subscribers || 0;
      const subsB = b.node.subscribers || 0;
      if (subsB !== subsA) return subsB - subsA;
      return (a.node.label || '').length - (b.node.label || '').length;
    });

    return scored.slice(0, 10).map((s) => s.node);
  }, [nodes, query]);

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
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (id: string) => {
    onSelectArtist(id);
    setIsOpen(false);
    setQuery('');
  };

  return (
    <div className="relative w-full max-w-md" ref={dropdownRef}>
      <div className="glass-panel h-10 flex items-center px-3.5 shadow-xl transition-all focus-within:border-emerald-500/60 focus-within:ring-2 focus-within:ring-emerald-500/20">
        <Search className="w-4 h-4 text-slate-400 mr-2.5 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder="Search artist, genre, or subgenre... (Ctrl+K)"
          className="w-full bg-transparent border-none outline-none text-sm text-slate-100 placeholder-slate-500"
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
        <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono text-slate-400 bg-white/5 border border-white/10 rounded ml-2">
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
