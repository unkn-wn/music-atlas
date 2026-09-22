import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX, ExternalLink, Loader2 } from 'lucide-react';
import { AtlasNode } from '../types/atlas';
import { resolveArtistPreview } from '../utils/audioResolver';

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
  onSelectArtist
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeArtistIdRef = useRef<string | null>(null);
  const loadedSrcRef = useRef<string | null>(null);

  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(30);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(0.2);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [resolvedTitle, setResolvedTitle] = useState<string | null>(null);

  // Synchronously stop and purge old audio when artist changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
    }
    loadedSrcRef.current = null;
    activeArtistIdRef.current = currentArtist?.id || null;
    setCurrentTime(0);
    setProgress(0);
    setResolvedTitle(null);
    setIsLoadingAudio(false);
  }, [currentArtist?.id]);

  // Clean up audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current.removeAttribute('src');
        audioRef.current.load();
      }
    };
  }, []);

  // Volume & Mute control
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  // Playback & On-Demand Preview Resolution
  useEffect(() => {
    const audioElement = audioRef.current;
    if (!audioElement || !currentArtist) return;

    if (!isPlaying) {
      audioElement.pause();
      setIsLoadingAudio(false);
      return;
    }

    // If audio is already loaded and ready for this exact artist, just play
    if (loadedSrcRef.current && audioElement.src === loadedSrcRef.current) {
      audioElement.play().catch((e: any) => {
        if (e.name !== 'AbortError') {
          console.warn("Playback resume error:", e);
          onTogglePlay();
        }
      });
      return;
    }

    // Resolve preview on demand
    const targetArtistId = currentArtist.id;
    activeArtistIdRef.current = targetArtistId;
    setIsLoadingAudio(true);

    resolveArtistPreview(targetArtistId, currentArtist.label, currentArtist.topTrack)
      .then(async (result) => {
        // Discard if user switched artists while resolving
        if (activeArtistIdRef.current !== targetArtistId) {
          return;
        }

        if (result?.previewUrl && audioRef.current) {
          loadedSrcRef.current = result.previewUrl;
          if (result.trackTitle) {
            setResolvedTitle(result.trackTitle);
          }
          audioRef.current.src = result.previewUrl;
          audioRef.current.volume = isMuted ? 0 : volume;
          audioRef.current.currentTime = 0;
          try {
            await audioRef.current.play();
          } catch (e: any) {
            if (e.name !== 'AbortError') {
              console.warn("Audio play error:", e);
              onTogglePlay();
            }
          }
        } else {
          console.warn("No preview available for:", currentArtist.label);
          onTogglePlay();
        }
      })
      .catch((err) => {
        if (activeArtistIdRef.current === targetArtistId) {
          console.warn("Preview resolve error:", err);
          onTogglePlay();
        }
      })
      .finally(() => {
        if (activeArtistIdRef.current === targetArtistId) {
          setIsLoadingAudio(false);
        }
      });
  }, [currentArtist?.id, isPlaying]);

  const handleTimeUpdate = () => {
    if (audioRef.current && !isLoadingAudio) {
      const cur = audioRef.current.currentTime;
      const dur = audioRef.current.duration || 30;
      setCurrentTime(cur);
      setDuration(dur);
      setProgress((cur / dur) * 100);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setProgress(val);
    if (audioRef.current) {
      audioRef.current.currentTime = (val / 100) * duration;
    }
  };

  const toggleMute = () => {
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (audioRef.current) {
      audioRef.current.volume = val;
      if (val === 0) setIsMuted(true);
      else setIsMuted(false);
    }
  };

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
        className="flex items-center gap-2 sm:gap-3 min-w-0 max-w-[125px] sm:max-w-none sm:w-52 shrink-0 cursor-pointer group select-none"
        title={`View ${currentArtist.label} details`}
      >
        <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg overflow-hidden relative shrink-0 bg-slate-800 shadow-md group-hover:scale-105 transition-transform">
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
        <div className="min-w-0 flex-1">
          <div className="text-xs font-bold text-white truncate group-hover:text-emerald-300 transition-colors" title={resolvedTitle || currentArtist.topTrack || currentArtist.label}>
            {resolvedTitle || currentArtist.topTrack || currentArtist.label}
          </div>
          <div className="text-[10px] sm:text-[11px] text-slate-400 truncate flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: currentArtist.color }} />
            <span className="truncate group-hover:text-slate-200 transition-colors">
              {currentArtist.label}
            </span>
          </div>
        </div>
      </div>

      {/* Play/Pause Button */}
      <button
        onClick={() => {
          onTogglePlay();
        }}
        disabled={isLoadingAudio}
        className="w-9 h-9 sm:w-10 sm:h-10 rounded-full font-bold shadow-md transition-transform shrink-0 flex items-center justify-center bg-emerald-500 hover:bg-emerald-400 text-black shadow-emerald-500/30 active:scale-95 cursor-pointer"
        title={
          isLoadingAudio
            ? "Resolving audio preview..."
            : isPlaying
            ? "Pause Preview"
            : "Play Preview"
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
        <span className="text-[10px] font-mono text-slate-400 w-7 sm:w-8 text-right shrink-0">
          0:{Math.floor(currentTime).toString().padStart(2, '0')}
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
        <span className="text-[10px] font-mono text-slate-400 w-7 sm:w-8 shrink-0">
          0:{Math.floor(duration).toString().padStart(2, '0')}
        </span>
      </div>

      {/* Volume Control */}
      <div className="hidden sm:flex items-center gap-2 shrink-0">
        <button
          onClick={toggleMute}
          className="text-slate-400 hover:text-white transition-colors"
        >
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

      {/* Spotify External Link */}
      <a
        href={currentArtist.spotifyUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="p-1 sm:p-1.5 text-slate-400 hover:text-[#1DB954] transition-colors shrink-0"
        title="Open in Spotify"
      >
        <ExternalLink className="w-4 h-4" />
      </a>
    </div>
  );
};
