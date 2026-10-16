import React from 'react';
import { AtlasNode } from '../../types/atlas';
import { filterValidSubgenres } from '../../utils/artistUtils';

interface ArtistResultRowProps {
  artist: AtlasNode;
  isActive: boolean;
  onPick: () => void;
  onHover: () => void;
}

function formatGenreDisplay(artist: AtlasNode): string {
  const firstSubgenre = filterValidSubgenres(artist.topSubgenres)[0] || '';
  const rawPrimary = artist.primaryGenre ? artist.primaryGenre.trim() : '';
  const hasPrimary = Boolean(
    rawPrimary &&
      !['other', 'artist', 'unknown', 'eclectic'].includes(rawPrimary.toLowerCase()) &&
      (!firstSubgenre || rawPrimary.toLowerCase() !== firstSubgenre.toLowerCase())
  );

  if (hasPrimary && firstSubgenre) return `${rawPrimary} • ${firstSubgenre}`;
  if (hasPrimary) return rawPrimary;
  return firstSubgenre;
}

/** Autocomplete row: avatar ringed in the artist's continent colour, name and genre. */
export const ArtistResultRow: React.FC<ArtistResultRowProps> = ({ artist, isActive, onPick, onHover }) => {
  const genreDisplay = formatGenreDisplay(artist);

  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault();
      }}
      onMouseEnter={onHover}
      onClick={onPick}
      className={`w-full flex items-center gap-3 p-2 rounded-lg cursor-pointer text-left ${
        isActive ? 'bg-white/15 text-white' : 'hover:bg-white/10 text-slate-200'
      }`}
    >
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

      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <span className="text-sm font-semibold text-white truncate leading-tight">{artist.label}</span>
        {genreDisplay ? (
          <span className="text-xs text-slate-400 truncate mt-0.5 leading-tight">{genreDisplay}</span>
        ) : null}
      </div>
    </button>
  );
};
