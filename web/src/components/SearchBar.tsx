import React, { useEffect, useMemo } from 'react';
import { Search, X, Tags } from 'lucide-react';
import { IndexedNode, IndexedGenre, searchArtists, searchGenres } from '../utils/searchEngine';
import { useSearchDropdown } from '../hooks/useSearchDropdown';
import { ArtistResultRow } from './search/ArtistResultRow';

interface SearchBarProps {
  searchIndex: IndexedNode[];
  genreIndex: IndexedGenre[];
  onSelectArtist: (artistId: string) => void;
  onSelectGenre: (genre: string) => void;
  selectedArtistId: string | null;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  searchIndex,
  genreIndex,
  onSelectArtist,
  onSelectGenre,
  selectedArtistId
}) => {
  const {
    query,
    setQuery,
    deferredQuery,
    isOpen,
    setIsOpen,
    activeIndex,
    setActiveIndex,
    containerRef,
    inputRef,
    close,
    handleKeyDown
  } = useSearchDropdown();

  const genreResults = useMemo(() => searchGenres(genreIndex, deferredQuery), [genreIndex, deferredQuery]);
  const artistResults = useMemo(() => searchArtists(searchIndex, deferredQuery), [searchIndex, deferredQuery]);
  const resultCount = genreResults.length + artistResults.length;

  // Genres are listed first, so row indices below genreResults.length are genres
  const pick = (index: number) => {
    if (index < genreResults.length) onSelectGenre(genreResults[index].name);
    else onSelectArtist(artistResults[index - genreResults.length].id);
    close();
    inputRef.current?.blur();
  };

  // Global shortcut to focus search: Ctrl+K or '/'
  useEffect(() => {
    const handleShortcut = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if ((e.ctrlKey && e.key === 'k') || (e.key === '/' && !isTyping)) {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [inputRef, setIsOpen]);

  return (
    <div className="relative w-full" ref={containerRef}>
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
          onKeyDown={(e) => handleKeyDown(e, resultCount, pick)}
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
      {isOpen && resultCount > 0 && (
        <div className="absolute left-0 right-0 top-full mt-2 glass-panel p-1.5 shadow-2xl z-50 max-h-96 overflow-y-auto border border-white/20">
          {genreResults.map((genre, idx) => (
            <button
              key={`genre-${genre.name}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActiveIndex(idx)}
              onClick={() => pick(idx)}
              className={`w-full flex items-center gap-3 p-2 rounded-lg cursor-pointer text-left ${
                activeIndex === idx ? 'bg-white/15 text-white' : 'hover:bg-white/10 text-slate-200'
              }`}
            >
              <div className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center bg-emerald-500/10 border-2 border-emerald-500/40">
                <Tags className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0 flex flex-col justify-center">
                <span className="text-sm font-semibold text-white truncate leading-tight">{genre.name}</span>
                <span className="text-xs text-slate-400 truncate mt-0.5 leading-tight">
                  Genre · {genre.artistCount.toLocaleString()} artists
                </span>
              </div>
            </button>
          ))}

          {artistResults.map((artist, idx) => {
            const rowIndex = genreResults.length + idx;
            return (
              <ArtistResultRow
                key={artist.id}
                artist={artist}
                isActive={activeIndex === rowIndex || selectedArtistId === artist.id}
                onHover={() => setActiveIndex(rowIndex)}
                onPick={() => pick(rowIndex)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};
