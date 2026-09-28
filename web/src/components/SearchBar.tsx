import React, { useState, useRef, useEffect, useMemo, useDeferredValue } from 'react';
import { Search, X } from 'lucide-react';
import { AtlasNode } from '../types/atlas';
import { buildSearchIndex, searchArtists } from '../utils/searchEngine';
import { filterValidSubgenres } from '../utils/artistUtils';

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

  // Defer query updates so typing remains smooth at 120 FPS
  const deferredQuery = useDeferredValue(query);

  // Pre-indexed search metadata pre-sorted by popularity (subscribers desc)
  const indexedNodes = useMemo(() => {
    return buildSearchIndex(nodes);
  }, [nodes]);

  // Ultra-fast tiered matching over pre-indexed nodes
  const filteredArtists = useMemo(() => {
    return searchArtists(indexedNodes, deferredQuery);
  }, [indexedNodes, deferredQuery]);

  // Reset active keyboard index when search results change
  useEffect(() => {
    setActiveIndex(0);
  }, [filteredArtists]);

  const handleSelect = (id: string) => {
    onSelectArtist(id);
    setIsOpen(false);
    setQuery('');
  };

  // Global keyboard shortcuts and dropdown navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.ctrlKey && e.key === 'k') ||
        (e.key === '/' && document.activeElement !== inputRef.current)
      ) {
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
            const cleanSubgenres = filterValidSubgenres(artist.topSubgenres);
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
                  isActive || selectedArtistId === artist.id
                    ? 'bg-white/15 text-white'
                    : 'hover:bg-white/10 text-slate-200'
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
