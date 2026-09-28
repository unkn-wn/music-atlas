import React, { useMemo, useState, useEffect, useRef } from 'react';
import { X, Play, Pause, ExternalLink, Disc3, ArrowRight } from 'lucide-react';
import { AtlasNode } from '../types/atlas';
import { useBottomSheetGesture } from '../hooks/useBottomSheetGesture';
import { resolveArtistImageUrl, DEFAULT_FALLBACK_AVATAR } from '../utils/imageUtils';
import { filterValidSubgenres, formatSubscriberCount } from '../utils/artistUtils';

const DEFAULT_ACCENT_COLOR = '#10b981';
const PROGRESS_BAR_WHITE_PCT = 45;

interface ArtistDrawerProps {
  artist: AtlasNode | null;
  onClose: () => void;
  onSelectNeighbor: (neighborId: string) => void;
  isPlayingPreview: boolean;
  onTogglePreview: (artist: AtlasNode) => void;
  currentlyPlayingId: string | null;
  onDragStateChange?: (offsetY: number, isDragging: boolean) => void;
}

export const ArtistDrawer: React.FC<ArtistDrawerProps> = ({
  artist,
  onClose,
  onSelectNeighbor,
  isPlayingPreview,
  onTogglePreview,
  currentlyPlayingId,
  onDragStateChange
}) => {
  if (!artist) return null;

  // Use authentic artist continent color with 100% exact hue and tone matching the canvas
  const accentColor = artist.color || DEFAULT_ACCENT_COLOR;
  const [loadedArtistId, setLoadedArtistId] = useState<string | null>(null);
  const isImageLoaded = loadedArtistId === artist.id;
  const contentRef = useRef<HTMLDivElement | null>(null);

  const {
    snapState,
    setSnapState,
    dragOffsetY,
    isDragging,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd
  } = useBottomSheetGesture({
    onClose,
    onDragStateChange,
    contentRef
  });

  const isCurrentPlaying = isPlayingPreview && currentlyPlayingId === artist.id;

  // Display adaptive connections without arbitrary truncation
  const displayedNeighbors = useMemo(() => {
    if (!artist.topCrossovers) return [];
    return [...artist.topCrossovers].sort(
      (a, b) => b.sharedPlaylists - a.sharedPlaylists || b.cosineSimilarity - a.cosineSimilarity
    );
  }, [artist.topCrossovers]);

  const maxShared = displayedNeighbors.length > 0 ? displayedNeighbors[0].sharedPlaylists : 1;
  const subscriberDisplay = formatSubscriberCount(artist.subscribers, artist.subscribersFormatted);
  const subgenres = useMemo(() => filterValidSubgenres(artist.topSubgenres), [artist.topSubgenres]);
  const hasPreview = Boolean(artist.id || artist.label);
  const sidebarImageUrl = useMemo(() => resolveArtistImageUrl(artist.image), [artist.image]);

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      style={{
        height:
          snapState === 'expanded' ? '82dvh' : 'calc(185px + env(safe-area-inset-bottom, 0px))',
        transform: onDragStateChange
          ? undefined
          : isDragging && dragOffsetY !== 0
          ? `translateY(${dragOffsetY}px)`
          : 'translateY(0px)',
        transition: isDragging
          ? 'none'
          : 'height 0.35s cubic-bezier(0.32, 0.72, 0, 1), transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)'
      }}
      className="glass-panel w-full md:w-72 lg:w-96 shadow-2xl flex flex-col md:!h-[calc(100vh-10.5rem)] md:!transform-none overflow-hidden pointer-events-auto rounded-t-2xl md:rounded-2xl border-t md:border-l border-white/15 relative"
    >
      {/* Mobile iOS Sheet Grab Handle */}
      <div
        onClick={(e) => {
          e.stopPropagation();
          setSnapState((prev) => (prev === 'peek' ? 'expanded' : 'peek'));
        }}
        className="md:hidden absolute top-1.5 inset-x-0 flex justify-center py-1 cursor-pointer select-none z-20 pointer-events-auto"
      >
        <div className="w-10 h-1 bg-white/25 rounded-full hover:bg-white/40 transition-colors" />
      </div>

      {/* Mobile Compact Artist Header */}
      <div className="md:hidden px-3.5 pt-3.5 pb-2.5 flex items-center justify-between gap-3 border-b border-white/10 shrink-0 select-none relative">
        <div
          className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            setSnapState((prev) => (prev === 'peek' ? 'expanded' : 'peek'));
          }}
        >
          {/* Avatar Circle with accent ring */}
          <div
            className="w-10 h-10 rounded-full shrink-0 overflow-hidden flex items-center justify-center bg-white/5 border-2 shadow-md"
            style={{ borderColor: accentColor }}
          >
            <img
              src={sidebarImageUrl || DEFAULT_FALLBACK_AVATAR}
              alt={artist.label}
              referrerPolicy="no-referrer"
              crossOrigin="anonymous"
              className="w-full h-full object-cover"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                if (artist.image && target.src !== artist.image) {
                  target.src = artist.image;
                } else {
                  target.src = DEFAULT_FALLBACK_AVATAR;
                }
              }}
            />
          </div>

          {/* Artist Name & Stats */}
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold text-white tracking-tight truncate leading-tight">
              {artist.label}
            </h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-xs text-slate-400 font-medium">
                {subscriberDisplay} listeners
              </span>
              {subgenres.length > 0 && (
                <span
                  style={{
                    backgroundColor: `color-mix(in srgb, ${accentColor} 20%, #131722)`,
                    borderColor: `color-mix(in srgb, ${accentColor} 65%, transparent)`
                  }}
                  className="px-1.5 py-0.5 rounded text-[10px] font-medium border text-white truncate max-w-[110px]"
                >
                  {subgenres[0]}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons: Quick Play & Close */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (hasPreview) onTogglePreview(artist);
            }}
            disabled={!hasPreview}
            style={{
              ...(hasPreview ? { backgroundColor: accentColor } : {})
            }}
            className={`w-9 h-9 rounded-full font-bold shadow-md transition-transform flex items-center justify-center shrink-0 ${
              hasPreview
                ? 'hover:brightness-110 text-white active:scale-95 cursor-pointer'
                : 'bg-slate-700 text-slate-400 cursor-not-allowed opacity-60 shadow-none'
            }`}
            title={
              !hasPreview
                ? 'No audio preview available'
                : isCurrentPlaying
                ? `Pause Preview: ${artist.label}`
                : `Play 30s Audio Preview: ${artist.label}`
            }
          >
            {isCurrentPlaying ? (
              <Pause className="w-4 h-4 text-white fill-white" fill="white" color="white" />
            ) : (
              <Play className="w-4 h-4 text-white fill-white ml-0.5" fill="white" color="white" />
            )}
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="p-1.5 text-slate-400 hover:text-white transition-colors flex items-center justify-center cursor-pointer shrink-0"
            title="Close Drawer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Desktop Header Image */}
      <div
        style={{
          width: '100%',
          position: 'relative',
          overflow: 'hidden',
          backgroundColor: '#07090e',
          flexShrink: 0
        }}
        className="hidden md:block aspect-square max-h-56 lg:max-h-72 border-b border-white/10"
      >
        {/* Skeleton placeholder while artist picture is loading */}
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

        {/* Ambient blurred backdrop */}
        {sidebarImageUrl && isImageLoaded && (
          <img
            key={`${artist.id}-backdrop`}
            src={sidebarImageUrl}
            alt=""
            aria-hidden="true"
            referrerPolicy="no-referrer"
            crossOrigin="anonymous"
            style={{ opacity: 0.25 }}
            className="absolute inset-0 w-full h-full object-cover blur-xl scale-125 pointer-events-none"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
        )}

        {/* Main artist photo */}
        <img
          key={`${artist.id}-main`}
          src={sidebarImageUrl || DEFAULT_FALLBACK_AVATAR}
          alt={artist.label}
          referrerPolicy="no-referrer"
          crossOrigin="anonymous"
          onLoad={() => setLoadedArtistId(artist.id)}
          style={{ display: isImageLoaded ? 'block' : 'none' }}
          className="w-full h-full object-cover object-center"
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            if (artist.image && target.src !== artist.image) {
              target.src = artist.image;
            } else {
              target.src = DEFAULT_FALLBACK_AVATAR;
            }
            setLoadedArtistId(artist.id);
          }}
        />

        {/* Bottom gradient scrim for text readability */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '62%',
            pointerEvents: 'none',
            zIndex: 6,
            background:
              'linear-gradient(to top, rgba(7, 9, 14, 0.92) 0%, rgba(7, 9, 14, 0.50) 45%, transparent 100%)'
          }}
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
            ...(hasPreview ? { backgroundColor: accentColor } : {})
          }}
          className={`w-12 h-12 rounded-full font-bold shadow-lg transition-transform flex items-center justify-center shrink-0 ${
            hasPreview
              ? 'hover:brightness-110 text-white active:scale-95 cursor-pointer'
              : 'bg-slate-700 text-slate-400 cursor-not-allowed opacity-60 shadow-none'
          }`}
          title={
            !hasPreview
              ? 'No audio preview available'
              : isCurrentPlaying
              ? `Pause Preview: ${artist.label}`
              : `Play 30s Audio Preview: ${artist.label}`
          }
        >
          <div className="w-5 h-5 flex items-center justify-center shrink-0">
            {isCurrentPlaying ? (
              <Pause
                className="w-5 h-5 fill-white text-white shrink-0"
                fill="white"
                color="white"
              />
            ) : (
              <Play
                className="w-5 h-5 fill-white text-white shrink-0 ml-0.5"
                fill="white"
                color="white"
              />
            )}
          </div>
        </button>

        {/* Artist Name, Listeners & Subgenres */}
        <div
          style={{
            position: 'absolute',
            bottom: '0.75rem',
            left: '1rem',
            right: '4.5rem',
            zIndex: 10
          }}
        >
          <h2 className="text-xl font-bold text-white tracking-tight truncate drop-shadow-md">
            {artist.label}
          </h2>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-xs text-slate-300 font-medium drop-shadow">
              {subscriberDisplay} listeners
            </span>
            {subgenres.length > 0 && (
              <>
                <span className="text-slate-400 text-xs select-none">•</span>
                <div className="flex items-center gap-1 flex-wrap">
                  {subgenres.slice(0, 3).map((g, idx) => (
                    <span
                      key={idx}
                      style={{
                        backgroundColor: `color-mix(in srgb, ${accentColor} 20%, #131722)`,
                        borderColor: `color-mix(in srgb, ${accentColor} 65%, transparent)`
                      }}
                      className="px-1.5 py-0.5 rounded text-[10px] font-medium border text-white"
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
      <div
        ref={contentRef}
        style={{
          touchAction: 'pan-y',
          overscrollBehaviorY: 'contain',
          WebkitOverflowScrolling: 'touch',
          paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0.75rem))'
        }}
        className="flex-1 overflow-y-auto p-3 sm:p-4 flex flex-col gap-3 sm:gap-4"
      >
        {/* Top Shared Playlists */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Disc3 className="w-3.5 h-3.5" style={{ color: accentColor }} />
              <span className="tracking-wide uppercase">
                TOP SHARED PLAYLISTS ({displayedNeighbors.length})
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {displayedNeighbors.length > 0 ? (
              displayedNeighbors.map((c, idx) => {
                const barPercent = Math.max(
                  12,
                  Math.min(100, Math.floor((c.sharedPlaylists / (maxShared || 1)) * 100))
                );
                return (
                  <button
                    key={c.neighborId}
                    type="button"
                    onClick={() => onSelectNeighbor(c.neighborId)}
                    className="w-full group bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl p-2.5 cursor-pointer text-left transition-colors flex flex-col gap-1.5"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-slate-500 text-[11px]">#{idx + 1}</span>
                        <span className="font-semibold text-white truncate">{c.neighborName}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-white shrink-0">
                        <span>{c.sharedPlaylists}</span>
                        <ArrowRight className="w-3 h-3" />
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
              /* High-visibility Skeleton loader for connection list */
              Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-2.5 flex flex-col gap-2 animate-pulse"
                >
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
            href={
              artist.spotifyUrl ||
              `https://open.spotify.com/search/${encodeURIComponent(artist.label)}`
            }
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
