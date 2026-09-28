import React from 'react';
import { Play, Pause, Volume2, VolumeX, Loader2, X } from 'lucide-react';
import { AtlasNode } from '../types/atlas';
import { useAudioPlayer, formatAudioTime } from '../hooks/useAudioPlayer';

interface AudioPlayerBarProps {
  currentArtist: AtlasNode | null;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onClose?: () => void;
  onSelectArtist?: (artistId: string) => void;
}

export const AudioPlayerBar: React.FC<AudioPlayerBarProps> = ({
  currentArtist,
  isPlaying,
  onTogglePlay,
  onClose,
  onSelectArtist
}) => {
  const {
    audioRef,
    progress,
    duration,
    currentTime,
    volume,
    isMuted,
    isLoadingAudio,
    resolvedTitle,
    handleTimeUpdate,
    handleSeek,
    toggleMute,
    handleVolumeChange
  } = useAudioPlayer(currentArtist, isPlaying, onTogglePlay);

  if (!currentArtist) return null;

  const hasPreview = Boolean(currentArtist.id || currentArtist.label);

  return (
    <div className="glass-panel relative z-10 w-full max-w-2xl px-3 sm:px-4 py-2 sm:py-2.5 shadow-2xl flex items-center gap-2.5 sm:gap-4 pointer-events-auto border border-white/15 animate-in slide-in-from-bottom duration-300">
      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => onTogglePlay()}
        onError={() => {
          if (!audioRef.current?.src || audioRef.current.src === window.location.href) return;
          if (isPlaying) onTogglePlay();
        }}
      />

      {/* Artist Thumbnail & Info */}
      <div
        onClick={() => {
          if (currentArtist && onSelectArtist) {
            onSelectArtist(currentArtist.id);
          }
        }}
        className="flex items-center gap-2 sm:gap-3 w-40 sm:w-56 shrink-0 cursor-pointer group select-none min-w-0"
        title={`View ${currentArtist.label} details`}
      >
        <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg overflow-hidden relative shrink-0 bg-slate-800 shadow-md">
          <img
            key={currentArtist.id}
            src={currentArtist.image}
            alt={currentArtist.label}
            referrerPolicy="no-referrer"
            crossOrigin="anonymous"
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
          {isPlaying && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center gap-0.5">
              <div className="eq-bar" />
              <div className="eq-bar" />
              <div className="eq-bar" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 flex flex-col justify-between h-8 sm:h-9 py-0.5">
          {resolvedTitle ? (
            <div
              className="text-xs font-bold text-white truncate leading-tight"
              title={resolvedTitle}
            >
              {resolvedTitle}
            </div>
          ) : (
            <div className="h-3 w-28 sm:w-36 bg-white/10 rounded animate-pulse" />
          )}
          <div className="text-[10px] sm:text-[11px] text-slate-400 truncate flex items-center gap-1 leading-tight">
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: currentArtist.color }}
            />
            <span className="truncate group-hover:text-slate-200 transition-colors">
              {currentArtist.label}
            </span>
          </div>
        </div>
      </div>

      {/* Play/Pause Button */}
      <button
        onClick={() => onTogglePlay()}
        disabled={isLoadingAudio}
        className="w-9 h-9 sm:w-10 sm:h-10 rounded-full font-bold shadow-md transition-transform shrink-0 flex items-center justify-center bg-emerald-500 hover:bg-emerald-400 text-black shadow-emerald-500/30 active:scale-95 cursor-pointer"
        title={
          isLoadingAudio
            ? 'Resolving audio preview...'
            : isPlaying
            ? 'Pause Preview'
            : 'Play Preview'
        }
      >
        <div className="w-4 h-4 flex items-center justify-center shrink-0">
          {isLoadingAudio ? (
            <Loader2 className="w-4 h-4 animate-spin shrink-0" strokeWidth={2.5} />
          ) : isPlaying ? (
            <Pause className="w-4 h-4 fill-current shrink-0" />
          ) : (
            <Play className="w-4 h-4 fill-current shrink-0 ml-0.5" />
          )}
        </div>
      </button>

      {/* Scrubber & Time */}
      <div className="flex-1 flex items-center gap-1.5 sm:gap-2 min-w-0">
        <span className="text-[10px] text-slate-400 w-7 sm:w-8 text-right shrink-0">
          {formatAudioTime(currentTime)}
        </span>
        <input
          type="range"
          min="0"
          max="100"
          step="0.1"
          value={progress}
          onChange={handleSeek}
          disabled={!hasPreview}
          className="w-full min-w-0"
        />
        <span className="text-[10px] text-slate-400 w-7 sm:w-8 shrink-0">
          {formatAudioTime(duration)}
        </span>
      </div>

      {/* Volume Control */}
      <div className="hidden sm:flex items-center gap-2 shrink-0">
        <button onClick={toggleMute} className="text-slate-400 hover:text-white transition-colors">
          {isMuted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={isMuted ? 0 : volume}
          onChange={handleVolumeChange}
          className="w-16"
        />
      </div>

      {/* Close/Dismiss Player Button */}
      {onClose && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="p-1 sm:p-1.5 text-slate-400 hover:text-white transition-colors shrink-0 cursor-pointer flex items-center justify-center"
          title="Dismiss playback"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
