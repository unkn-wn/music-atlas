import React, { useMemo } from 'react';
import { X } from 'lucide-react';
import { AtlasNode } from '../../types/atlas';
import { IndexedNode, searchArtists } from '../../utils/searchEngine';
import { useSearchDropdown } from '../../hooks/useSearchDropdown';
import { ArtistResultRow } from './ArtistResultRow';

interface ArtistPickerProps {
  placeholder: string;
  autoFocus?: boolean;
  /** Which edge the results dropdown lines up with (it can be wider than the field) */
  dropdownAlign?: 'left' | 'right';
  searchIndex: IndexedNode[];
  value: AtlasNode | null;
  onChange: (artist: AtlasNode | null) => void;
}

/** Artist-only search field that shows the chosen artist as a removable chip. */
export const ArtistPicker: React.FC<ArtistPickerProps> = ({
  placeholder,
  autoFocus = false,
  dropdownAlign = 'left',
  searchIndex,
  value,
  onChange
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

  const results = useMemo(() => searchArtists(searchIndex, deferredQuery, 6), [searchIndex, deferredQuery]);

  const pick = (index: number) => {
    onChange(results[index]);
    close();
  };

  return (
    <div className="relative min-w-0" ref={containerRef}>
      {value ? (
        <div
          className="h-9 flex items-center gap-2 px-2 rounded-lg bg-white/10 border"
          style={{ borderColor: `color-mix(in srgb, ${value.color} 60%, transparent)` }}
        >
          <img
            src={value.image}
            alt=""
            referrerPolicy="no-referrer"
            crossOrigin="anonymous"
            className="w-6 h-6 rounded-full object-cover shrink-0 bg-white/5"
            onError={(e) => {
              (e.target as HTMLElement).style.visibility = 'hidden';
            }}
          />
          <span className="flex-1 min-w-0 truncate text-xs font-semibold text-white">{value.label}</span>
          <button
            type="button"
            onClick={() => {
              onChange(null);
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
            className="p-0.5 text-slate-400 hover:text-white cursor-pointer shrink-0"
            title={`Clear ${value.label}`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={(e) => handleKeyDown(e, results.length, pick)}
          autoFocus={autoFocus}
          placeholder={placeholder}
          style={{ color: '#f8fafc' }}
          className="w-full h-9 px-2.5 rounded-lg bg-white/5 border border-white/10 focus:border-emerald-500/50 outline-none text-base sm:text-xs placeholder-slate-500"
        />
      )}

      {!value && isOpen && results.length > 0 && (
        <div className={`absolute ${dropdownAlign === 'left' ? 'left-0' : 'right-0'} top-full mt-1 w-[max(100%,240px)] glass-panel p-1 shadow-2xl z-50 max-h-64 overflow-y-auto border border-white/20`}>
          {results.map((artist, idx) => (
            <ArtistResultRow
              key={artist.id}
              artist={artist}
              isActive={activeIndex === idx}
              onHover={() => setActiveIndex(idx)}
              onPick={() => pick(idx)}
            />
          ))}
        </div>
      )}
    </div>
  );
};
