import React, { useMemo, useState, useEffect } from 'react';
import { X, Play, Pause, ExternalLink, Users, Disc3, ArrowRight } from 'lucide-react';
import { AtlasNode } from '../types/atlas';

// Accent styling constants for artist drawer elements
const DEFAULT_ACCENT_COLOR = '#10b981';
const SUBGENRE_BADGE_BG_PCT = 25;
const SUBGENRE_BADGE_BORDER_PCT = 75;
const PROGRESS_BAR_WHITE_PCT = 35;

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

  const accentColor = artist.color || DEFAULT_ACCENT_COLOR;
  const [loadedArtistId, setLoadedArtistId] = useState<string | null>(null);
  const isImageLoaded = loadedArtistId === artist.id;

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
    const subs = artist.subscribers ?? 0;
    if (subs >= 1_000_000) return `${(subs / 1_000_000).toFixed(1)}M`;
    if (subs >= 1_000) return `${(subs / 1_000).toFixed(1)}K`;
    return subs.toLocaleString();
  }, [artist.subscribersFormatted, artist.subscribers]);

  const subgenres = useMemo(() => {
    const list = artist.topSubgenres || [];
    return list.filter(
      (g) => g && !['other', 'artist', 'unknown', 'eclectic'].includes(g.trim().toLowerCase())
    );
  }, [artist.topSubgenres]);

  const hasPreview = Boolean(artist.id || artist.label);

  const sidebarImageUrl = useMemo(() => {
    if (!artist.image) return '';
    let url = artist.image.trim();
    if (url.startsWith('//')) {
      url = 'https:' + url;
    }
    // Deezer CDN image: ensure crisp 500x500 portrait
    if (url.includes('dzcdn.net')) {
      return url.replace(/\d+x\d+-/, '500x500-');
    }
    // Upgrade Google CDN image to crisp 512x512 portrait
    if (url.includes('googleusercontent.com') || url.includes('ggpht.com')) {
      const base = url.split('=')[0];
      return `${base}=s512-c-k-c0x00ffffff-no-rj`;
    }
    // Upgrade iTunes artwork to 600x600
    if (url.includes('mzstatic.com')) {
      return url.replace(/\d+x\d+bb/, '600x600bb');
    }
    return url;
  }, [artist.image]);

  return (
    <div className="glass-panel w-80 sm:w-96 shadow-2xl flex flex-col h-[calc(100vh-6rem)] overflow-hidden pointer-events-auto border-l border-white/15">
      {/* Header Image & Close Button with fixed 1:1 square ratio to show full artist portrait without squishing */}
      <div
        style={{ width: '100%', aspectRatio: '1 / 1', position: 'relative', overflow: 'hidden', backgroundColor: '#07090e', flexShrink: 0 }}
        className="aspect-square border-b border-white/10"
      >
        {/* High-visibility Skeleton placeholder while artist picture is loading (no fading) */}
        {!isImageLoaded && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundColor: '#0c101b',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 5
            }}
          >
            <div
              style={{
                width: '72px',
                height: '72px',
                borderRadius: '9999px',
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: `0 0 24px color-mix(in srgb, ${accentColor} 15%, transparent)`
              }}
              className="animate-pulse"
            >
              <Disc3
                className="w-9 h-9 animate-spin"
                style={{
                  color: `color-mix(in srgb, ${accentColor} 80%, transparent)`,
                  animationDuration: '2.5s'
                }}
              />
            </div>
            <div
              style={{
                height: '12px',
                width: '110px',
                borderRadius: '9999px',
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
                marginTop: '16px'
              }}
              className="animate-pulse"
            />
          </div>
        )}

        {/* Ambient blurred backdrop (no fading) */}
        {sidebarImageUrl && isImageLoaded && (
          <img
            key={`${artist.id}-backdrop`}
            src={sidebarImageUrl}
            alt=""
            aria-hidden="true"
            referrerPolicy="no-referrer"
            crossOrigin="anonymous"
            style={{ opacity: 0.35 }}
            className="absolute inset-0 w-full h-full object-cover blur-xl scale-125 pointer-events-none"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
        )}
        {/* Main artist photo with 1:1 square ratio (no fading) */}
        <img
          key={`${artist.id}-main`}
          src={sidebarImageUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&auto=format&fit=crop&q=80'}
          alt={artist.label}
          referrerPolicy="no-referrer"
          crossOrigin="anonymous"
          onLoad={() => setLoadedArtistId(artist.id)}
          style={{ display: isImageLoaded ? 'block' : 'none' }}
          className="w-full h-full object-cover object-top"
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            if (artist.image && target.src !== artist.image) {
              target.src = artist.image;
            } else {
              target.src = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&auto=format&fit=crop&q=80';
            }
            setLoadedArtistId(artist.id);
          }}
        />
        <div
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 6 }}
          className="bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent"
        />

        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '0.75rem',
            right: '0.75rem',
            zIndex: 10,
            width: '32px',
            height: '32px',
            padding: 0
          }}
          className="w-8 h-8 rounded-xl bg-black/60 hover:bg-black/80 border border-white/15 text-slate-300 hover:text-white transition-colors backdrop-blur-md flex items-center justify-center cursor-pointer shadow-md"
          title="Close Drawer"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Quick Play Floating Button */}
        <button
          onClick={() => {
            if (hasPreview) onTogglePreview(artist);
          }}
          disabled={!hasPreview}
          style={{
            position: 'absolute',
            bottom: '0.75rem',
            right: '1rem',
            zIndex: 10,
            ...(hasPreview
              ? {
                  backgroundColor: `color-mix(in srgb, ${accentColor} ${SUBGENRE_BADGE_BORDER_PCT}%, transparent)`,
                  // borderColor: `color-mix(in srgb, ${accentColor} ${SUBGENRE_BADGE_BORDER_PCT}%, transparent)`,
                }
              : {})
          }}
          className={`w-12 h-12 rounded-full font-bold shadow-lg transition-transform flex items-center justify-center shrink-0 ${
            hasPreview
              ? "hover:brightness-110 text-black active:scale-95 cursor-pointer"
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
          <div className="w-5 h-5 flex items-center justify-center shrink-0">
            {isCurrentPlaying ? (
              <Pause className="w-5 h-5 fill-current shrink-0" color='white' fill='white' />
            ) : (
              <Play className="w-5 h-5 fill-current shrink-0" color='white' fill='white' />
            )}
          </div>
        </button>

        {/* Artist Name, Primary Genre & Subgenre Pills */}
        <div style={{ position: 'absolute', bottom: '0.75rem', left: '1rem', right: '4.5rem', zIndex: 10 }}>
          <h2 className="text-xl font-bold text-white tracking-tight truncate drop-shadow-md">
            {artist.label}
          </h2>
          {(subgenres.length > 0) && (
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {subgenres.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap">
                  {subgenres.slice(0, 3).map((g, idx) => (
                    <span
                      key={idx}
                      style={{
                        backgroundColor: `color-mix(in srgb, ${accentColor} ${SUBGENRE_BADGE_BG_PCT}%, transparent)`,
                        borderColor: `color-mix(in srgb, ${accentColor} ${SUBGENRE_BADGE_BORDER_PCT}%, transparent)`,
                      }}
                      className="px-1.5 py-0.5 rounded text-[10px] font-medium border text-slate-200"
                    >
                      {g}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Body Content */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {/* Metrics */}
        <div className="text-xs">
          <div className="bg-white/5 border border-white/10 rounded-xl p-2.5 flex items-center gap-2.5">
            <Users className="w-4 h-4 text-cyan-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-slate-400 text-[10px] uppercase font-semibold tracking-wider">Subscribers</div>
              <div className="font-bold text-white font-mono text-sm truncate">{subscriberDisplay}</div>
            </div>
          </div>
        </div>

        {/* Top Shared Playlists */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Disc3 className="w-3.5 h-3.5" style={{ color: accentColor }} />
              <span className="tracking-wide uppercase">TOP SHARED PLAYLISTS ({displayedNeighbors.length})</span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {displayedNeighbors.length > 0 ? (
              displayedNeighbors.map((c, idx) => {
                const barPercent = Math.max(12, Math.min(100, Math.floor((c.sharedPlaylists / (maxShared || 1)) * 100)));
                return (
                  <button
                    key={c.neighborId}
                    type="button"
                    onClick={() => onSelectNeighbor(c.neighborId)}
                    className="w-full group bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl p-2.5 cursor-pointer text-left transition-colors flex flex-col gap-1.5"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-slate-500 text-[11px]">#{idx + 1}</span>
                        <span className="font-semibold text-white truncate group-hover:text-emerald-400 transition-colors">
                          {c.neighborName}
                        </span>
                      </div>
                      <div
                        className="flex items-center gap-1 text-[11px] font-mono font-bold shrink-0"
                        style={{ color: accentColor }}
                      >
                        <span>{c.sharedPlaylists}</span>
                        <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                      </div>
                    </div>

                    {/* Relative Shared Curation Progress Bar */}
                    <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${barPercent}%`,
                          background: `linear-gradient(to right, ${accentColor}, color-mix(in srgb, ${accentColor}, white ${PROGRESS_BAR_WHITE_PCT}%))`
                        }}
                      />
                    </div>
                  </button>
                );
              })
            ) : !artist.topCrossovers ? (
              /* High-visibility Skeleton loader for connection list if data is ever resolving */
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 flex flex-col gap-2 animate-pulse">
                  <div className="flex items-center justify-between">
                    <div className="h-3.5 w-24 bg-white/10 rounded" />
                    <div className="h-3.5 w-6 bg-white/10 rounded" />
                  </div>
                  <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                    <div className="bg-white/20 h-full rounded-full w-2/3" />
                  </div>
                </div>
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
            href={artist.spotifyUrl || `https://open.spotify.com/search/${encodeURIComponent(artist.label)}`}
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
