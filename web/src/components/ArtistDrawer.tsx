import React, { useMemo } from 'react';
import { X, Play, Pause, ExternalLink, Users, Disc3, ArrowRight, Flame } from 'lucide-react';
import { AtlasNode } from '../types/atlas';

interface ArtistDrawerProps {
  artist: AtlasNode | null;
  onClose: () => void;
  onSelectNeighbor: (neighborId: string) => void;
  isPlayingPreview: boolean;
  onTogglePreview: (artist: AtlasNode) => void;
  currentlyPlayingId: string | null;
}

export const ArtistDrawer: React.FC<ArtistDrawerProps> = ({
  artist,
  onClose,
  onSelectNeighbor,
  isPlayingPreview,
  onTogglePreview,
  currentlyPlayingId
}) => {
  if (!artist) return null;

  const isCurrentPlaying = isPlayingPreview && currentlyPlayingId === artist.id;

  const displayedNeighbors = useMemo(() => {
    if (!artist.topCrossovers) return [];
    return [...artist.topCrossovers]
      .sort((a, b) => (b.sharedPlaylists - a.sharedPlaylists) || (b.cosineSimilarity - a.cosineSimilarity))
      .slice(0, 10);
  }, [artist.topCrossovers]);

  const maxShared = displayedNeighbors.length > 0 ? displayedNeighbors[0].sharedPlaylists : 1;

  return (
    <div className="glass-panel w-80 sm:w-96 shadow-2xl flex flex-col h-[calc(100vh-6rem)] overflow-hidden pointer-events-auto border-l border-white/15 animate-in slide-in-from-right duration-300">
      {/* Header Image & Close Button */}
      <div className="relative h-56 w-full shrink-0 overflow-hidden bg-slate-950">
        {/* Ambient blurred backdrop */}
        {artist.image && (
          <img
            src={artist.image}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover blur-xl scale-125 opacity-35 pointer-events-none"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
        )}
        {/* Main artist photo positioned at object-top for natural portrait framing */}
        <img
          src={artist.image}
          alt={artist.label}
          className="relative w-full h-full object-cover object-top filter brightness-95"
          onError={(e) => {
            (e.target as HTMLElement).style.display = 'none';
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0d1117] via-[#0d1117]/30 to-black/50 pointer-events-none" />

        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-full bg-black/60 hover:bg-black/90 text-white transition-colors border border-white/20"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Quick Play Floating Button */}
        <button
          onClick={() => onTogglePreview(artist)}
          className="absolute bottom-3 right-4 p-3 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black font-bold shadow-lg shadow-emerald-500/30 transition-transform active:scale-95 flex items-center justify-center"
          title="Play 30s Audio Preview"
        >
          {isCurrentPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
        </button>

        {/* Artist Name & Continent Pill */}
        <div className="absolute bottom-3 left-4 right-16">
          <h2 className="text-xl font-bold text-white tracking-tight truncate drop-shadow-md">
            {artist.label}
          </h2>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: artist.color }}
            />
            <span className="text-xs font-semibold text-slate-300 truncate">
              {artist.continentName}
            </span>
          </div>
        </div>
      </div>

      {/* Body Content */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {/* Metrics Grid */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 flex items-center gap-2.5">
            <Flame className="w-4 h-4 text-amber-400 shrink-0" />
            <div>
              <div className="text-slate-400 text-[10px]">Popularity</div>
              <div className="font-bold text-white font-mono text-sm">{artist.popularity} / 100</div>
            </div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 flex items-center gap-2.5">
            <Users className="w-4 h-4 text-cyan-400 shrink-0" />
            <div>
              <div className="text-slate-400 text-[10px]">Monthly Listeners</div>
              <div className="font-bold text-white font-mono text-sm">
                {(artist.monthlyListeners || artist.followers) >= 1_000_000
                  ? `${((artist.monthlyListeners || artist.followers) / 1_000_000).toFixed(1)}M`
                  : ((artist.monthlyListeners || artist.followers) || 0).toLocaleString()}
              </div>
            </div>
          </div>
        </div>

        {/* Genres */}
        {artist.genres && artist.genres.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-wider text-[10px]">
              Genres & Tags
            </div>
            <div className="flex flex-wrap gap-1.5">
              {artist.genres.map((g, idx) => (
                <span
                  key={idx}
                  className="px-2 py-0.5 rounded-full text-[11px] bg-white/5 border border-white/10 text-slate-300 capitalize"
                >
                  {g}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Top Related Artists */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Disc3 className="w-3.5 h-3.5 text-emerald-400" />
              <span>Top Related Artists</span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">Shared Curations</span>
          </div>

          <div className="flex flex-col gap-2">
            {displayedNeighbors.length > 0 ? (
              displayedNeighbors.map((c, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onSelectNeighbor(c.neighborId)}
                  className="w-full group bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl p-2.5 cursor-pointer text-left transition-all flex flex-col gap-1.5"
                >
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-slate-500 text-[11px]">#{idx + 1}</span>
                      <span className="font-semibold text-white truncate group-hover:text-emerald-400 transition-colors">
                        {c.neighborName}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-[11px] font-mono text-emerald-400 font-bold shrink-0">
                      <span>{c.sharedPlaylists} {c.sharedPlaylists === 1 ? 'shared playlist' : 'shared playlists'}</span>
                      <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                    </div>
                  </div>

                  {/* Relative Shared Curation Progress Bar */}
                  <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-emerald-500 to-cyan-400 h-full rounded-full transition-all duration-300"
                      style={{ width: `${Math.max(12, Math.min(100, (c.sharedPlaylists / (maxShared || 1)) * 100))}%` }}
                    />
                  </div>
                </button>
              ))
            ) : (
              <div className="text-xs text-slate-500 italic py-2">
                No strong mutual connections above threshold.
              </div>
            )}
          </div>
        </div>

        {/* Action Button: Open in Spotify */}
        <div className="mt-auto pt-2">
          <a
            href={artist.spotifyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-[#1DB954]/20 hover:bg-[#1DB954]/30 border border-[#1DB954]/40 text-[#1DB954] text-xs font-bold transition-all shadow-sm"
          >
            <ExternalLink className="w-4 h-4" />
            <span>Open on Spotify</span>
          </a>
        </div>
      </div>
    </div>
  );
};
