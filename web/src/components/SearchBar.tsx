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
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Global Ctrl+K / '/' shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey && e.key === 'k') || (e.key === '/' && document.activeElement !== inputRef.current)) {
        e.preventDefault();
        inputRef.current?.focus();
        setIsOpen(true);
      }
      if (e.key === 'Escape') {
        setIsOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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

  // Filter matching artists across name, primary genre, top subgenres, macro genre, and tags
  const filteredArtists = query.trim() === ''
    ? []
    : nodes.filter((node) => {
        const q = query.toLowerCase();
        const label = node.label || '';
        const macro = node.macroGenre || '';
        const primary = node.primaryGenre || '';
        const genres = node.genres || [];
        const topSubgenres = node.topSubgenres || [];

        return (
          label.toLowerCase().includes(q) ||
          primary.toLowerCase().includes(q) ||
          macro.toLowerCase().includes(q) ||
          genres.some((g) => g && g.toLowerCase().includes(q)) ||
          topSubgenres.some((g) => g && g.toLowerCase().includes(q))
        );
      }).slice(0, 8);

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
          {filteredArtists.map((artist) => {
            const primary = artist.primaryGenre || artist.continentName || '';
            const subgenre = artist.topSubgenres?.[0] || (artist.genres && artist.genres[0]) || '';
            const genreDisplay = [primary, subgenre]
              .filter((g) => g && g.toLowerCase() !== 'artist' && g.toLowerCase() !== 'other' && g.toLowerCase() !== 'eclectic')
              .filter((g, idx, arr) => arr.indexOf(g) === idx)
              .join(' • ') || primary || 'Artist';

            return (
              <button
                key={artist.id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                }}
                onClick={() => handleSelect(artist.id)}
                className={`w-full flex items-center gap-3 p-2 rounded-lg cursor-pointer text-left transition-colors ${
                  selectedArtistId === artist.id ? 'bg-white/15' : 'hover:bg-white/10'
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
                  <span className="text-xs text-slate-400 truncate mt-0.5 leading-tight">
                    {genreDisplay}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
