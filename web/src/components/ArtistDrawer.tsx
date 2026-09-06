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

  // Display adaptive connections without arbitrary 10-item truncation (retains adaptive 6 to 20 connections)
  const displayedNeighbors = useMemo(() => {
    if (!artist.topCrossovers) return [];
    return [...artist.topCrossovers].sort(
      (a, b) => (b.sharedPlaylists - a.sharedPlaylists) || (b.cosineSimilarity - a.cosineSimilarity)
    );
  }, [artist.topCrossovers]);

  const maxShared = displayedNeighbors.length > 0 ? displayedNeighbors[0].sharedPlaylists : 1;

  const subscriberDisplay = useMemo(() => {
    if (artist.subscribersFormatted) return artist.subscribersFormatted;
    const subs = artist.subscribers ?? artist.followers ?? artist.monthlyListeners ?? 0;
    if (subs >= 1_000_000) return `${(subs / 1_000_000).toFixed(1)}M`;
    if (subs >= 1_000) return `${(subs / 1_000).toFixed(1)}K`;
    return subs.toLocaleString();
  }, [artist.subscribersFormatted, artist.subscribers, artist.followers, artist.monthlyListeners]);

  const subgenres = useMemo(() => {
    const list = (artist.topSubgenres && artist.topSubgenres.length > 0)
      ? artist.topSubgenres
      : (artist.genres || []);
    return list.filter((g) => g && g.toLowerCase() !== 'eclectic' && g.toLowerCase() !== 'other');
  }, [artist.topSubgenres, artist.genres]);

  const hasPreview = Boolean(artist.previewUrl);

  return (
    <div className="glass-panel w-80 sm:w-96 shadow-2xl flex flex-col h-[calc(100vh-6rem)] overflow-hidden pointer-events-auto border-l border-white/15 animate-in slide-in-from-right duration-300">
      {/* Header Image & Close Button */}
      <div className="relative h-56 w-full shrink-0 overflow-hidden bg-slate-950">
        {/* Ambient blurred backdrop */}
        {artist.image && (
          <img
            key={`${artist.id}-backdrop`}
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
          key={`${artist.id}-main`}
          src={artist.image || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&auto=format&fit=crop&q=80'}
          alt={artist.label}
          className="w-full h-full object-cover object-top"
          onError={(e) => {
            (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&auto=format&fit=crop&q=80';
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-full bg-black/60 hover:bg-black/90 text-slate-300 hover:text-white transition-colors backdrop-blur-md"
          title="Close Drawer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Quick Play Floating Button */}
        <button
          onClick={() => {
            if (hasPreview) onTogglePreview(artist);
          }}
          disabled={!hasPreview}
          className={`absolute bottom-3 right-4 p-3 rounded-full font-bold shadow-lg transition-transform flex items-center justify-center ${
            hasPreview
              ? "bg-emerald-500 hover:bg-emerald-400 text-black shadow-emerald-500/30 active:scale-95 cursor-pointer"
              : "bg-slate-700 text-slate-400 cursor-not-allowed opacity-60 shadow-none"
          }`}
          title={
            !hasPreview
              ? "No audio preview available"
              : isCurrentPlaying
              ? `Pause Preview: ${artist.label}`
              : `Play 30s Audio Preview: ${artist.label}`
          }
        >
          {isCurrentPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
        </button>

        {/* Artist Name, Primary Genre & Subgenre Pills */}
        <div className="absolute bottom-3 left-4 right-16">
          <h2 className="text-xl font-bold text-white tracking-tight truncate drop-shadow-md">
            {artist.label}
          </h2>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <div className="flex items-center gap-1.5 shrink-0">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: artist.color }}
              />
              <span className="text-xs font-semibold text-slate-200">
                {artist.primaryGenre || 'Artist'}
              </span>
            </div>
            {subgenres.length > 0 && (
              <>
                <span className="text-slate-500 text-xs">•</span>
                <div className="flex items-center gap-1 flex-wrap">
                  {subgenres.slice(0, 3).map((g, idx) => (
                    <span
                      key={idx}
                      className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/15 border border-emerald-500/30 text-emerald-300"
                    >
                      {g}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Body Content */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {/* Metrics Grid */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 flex items-center gap-2.5">
            <Users className="w-4 h-4 text-cyan-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-slate-400 text-[10px] uppercase font-semibold tracking-wider">Subscribers</div>
              <div className="font-bold text-white font-mono text-sm truncate">{subscriberDisplay}</div>
            </div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 flex items-center gap-2.5">
            <Flame className="w-4 h-4 text-amber-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-slate-400 text-[10px] uppercase font-semibold tracking-wider">Popularity</div>
              <div className="font-bold text-white font-mono text-sm">{artist.popularity} / 100</div>
            </div>
          </div>
        </div>

        {/* Adaptive Prominent Connections */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Disc3 className="w-3.5 h-3.5 text-emerald-400" />
              <span className="tracking-wide">PROMINENT CONNECTIONS ({displayedNeighbors.length})</span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">Shared Curations</span>
          </div>

          <div className="flex flex-col gap-2">
            {displayedNeighbors.length > 0 ? (
              displayedNeighbors.map((c, idx) => {
                const barPercent = Math.max(12, Math.min(100, Math.floor((c.sharedPlaylists / (maxShared || 1)) * 100)));
                return (
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
                        style={{ width: `${barPercent}%` }}
                      />
                    </div>
                  </button>
                );
              })
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
