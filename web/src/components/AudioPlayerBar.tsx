import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX, ExternalLink } from 'lucide-react';
import { AtlasNode } from '../types/atlas';

interface AudioPlayerBarProps {
  currentArtist: AtlasNode | null;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onClose?: () => void;
}

// Resilient on-the-fly preview resolver: fetches fresh 30s audio stream from Deezer via JSONP if URL is missing or token expired
async function fetchFreshPreview(artistName: string): Promise<string | null> {
  return new Promise((resolve) => {
    const cb = `dz_cb_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const s = document.createElement('script');
    s.src = `https://api.deezer.com/search?q=${encodeURIComponent(artistName)}&output=jsonp&callback=${cb}`;
    
    let resolved = false;
    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      (window as any)[cb] = () => {
        delete (window as any)[cb];
      };
      if (s.parentNode) s.parentNode.removeChild(s);
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 4500);

    (window as any)[cb] = (res: any) => {
      clearTimeout(timer);
      cleanup();
      if (res && res.data && res.data.length > 0) {
        for (const track of res.data) {
          if (track.preview) {
            resolve(track.preview);
            return;
          }
        }
      }
      resolve(null);
    };

    s.onerror = () => {
      clearTimeout(timer);
      cleanup();
      resolve(null);
    };

    document.head.appendChild(s);
  });
}

export const AudioPlayerBar: React.FC<AudioPlayerBarProps> = ({
  currentArtist,
  isPlaying,
  onTogglePlay
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const resolvedPreviewsRef = useRef<Map<string, string>>(new Map());
  const failedUrlsRef = useRef<Set<string>>(new Set());
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(30);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    if (!audioRef.current || !currentArtist) return;

    let isMounted = true;

    const loadAndPlay = async () => {
      let src = resolvedPreviewsRef.current.get(currentArtist.id) || currentArtist.previewUrl;

      const audioElement = audioRef.current;
      if (audioElement && audioElement.src && (!src || audioElement.src !== src)) {
        audioElement.pause();
      }

      // If previewUrl is missing or known to be empty, fetch on-the-fly
      if (!src) {
        const fresh = await fetchFreshPreview(currentArtist.label);
        if (!isMounted) return;
        if (fresh) {
          src = fresh;
          resolvedPreviewsRef.current.set(currentArtist.id, fresh);
        } else {
          if (isPlaying) onTogglePlay();
          return;
        }
      }

      if (audioRef.current && src && audioRef.current.src !== src) {
        audioRef.current.src = src;
        audioRef.current.currentTime = 0;
        setCurrentTime(0);
        setProgress(0);
      }

      if (isPlaying && audioRef.current) {
        audioRef.current.play().catch(async (e) => {
          if (e.name === 'AbortError') return;
          console.warn("Audio playback blocked or token expired, auto-recovering:", e);
          if (e.name === 'NotAllowedError') {
            onTogglePlay();
            return;
          }
          const recovered = await fetchFreshPreview(currentArtist.label);
          if (recovered && audioRef.current && isMounted) {
            resolvedPreviewsRef.current.set(currentArtist.id, recovered);
            audioRef.current.src = recovered;
            audioRef.current.play().catch(() => onTogglePlay());
          } else {
            onTogglePlay();
          }
        });
      } else if (audioRef.current) {
        audioRef.current.pause();
      }
    };

    loadAndPlay();

    return () => {
      isMounted = false;
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, [currentArtist, isPlaying]);

  const handleTimeUpdate = () => {
    if (audioRef.current) {
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

  return (
    <div className="glass-panel w-full max-w-2xl px-4 py-2.5 shadow-2xl flex items-center gap-4 pointer-events-auto border border-white/15 animate-in slide-in-from-bottom duration-300">
      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => onTogglePlay()}
        onError={async () => {
          if (currentArtist && audioRef.current) {
            const currentSrc = audioRef.current.src;
            if (currentSrc) {
              failedUrlsRef.current.add(currentSrc);
            }
            // Only attempt fallback recovery once per artist to prevent unbounded retry loops
            const alreadyRecovered = resolvedPreviewsRef.current.has(currentArtist.id);
            if (!alreadyRecovered) {
              const fresh = await fetchFreshPreview(currentArtist.label);
              if (fresh && !failedUrlsRef.current.has(fresh) && isPlaying) {
                resolvedPreviewsRef.current.set(currentArtist.id, fresh);
                if (audioRef.current) {
                  audioRef.current.src = fresh;
                  audioRef.current.play().catch(() => onTogglePlay());
                  return;
                }
              }
            }
          }
          if (isPlaying) onTogglePlay();
        }}
      />

      {/* Artist Thumbnail & Info */}
      <div className="flex items-center gap-3 min-w-0 w-52 shrink-0">
        <div className="relative w-10 h-10 rounded-lg overflow-hidden shrink-0 border border-white/20 bg-slate-800">
          <img
            src={currentArtist.image}
            alt={currentArtist.label}
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
        <div className="min-w-0">
          <div className="text-xs font-bold text-white truncate">{currentArtist.label}</div>
          <div className="text-[11px] text-slate-400 truncate flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: currentArtist.color }} />
            <span>{currentArtist.primaryGenre || currentArtist.macroGenre || 'Audio Preview'}</span>
          </div>
        </div>
      </div>

      {/* Play/Pause Button */}
      <button
        onClick={() => {
          if (!isPlaying && audioRef.current && currentArtist?.previewUrl) {
            audioRef.current.play().catch(() => {});
          }
          onTogglePlay();
        }}
        className="p-2.5 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black font-bold shadow-md shadow-emerald-500/30 transition-transform active:scale-95 shrink-0"
        title={isPlaying ? "Pause Preview" : "Play Preview"}
      >
        {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
      </button>

      {/* Scrubber & Time */}
      <div className="flex-1 flex items-center gap-2">
        <span className="text-[10px] font-mono text-slate-400 w-8 text-right">
          0:{Math.floor(currentTime).toString().padStart(2, '0')}
        </span>
        <input
          type="range"
          min="0"
          max="100"
          step="0.1"
          value={progress}
          onChange={handleSeek}
          className="w-full"
        />
        <span className="text-[10px] font-mono text-slate-400 w-8">
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
        className="p-1.5 text-slate-400 hover:text-[#1DB954] transition-colors shrink-0"
        title="Open in Spotify"
      >
        <ExternalLink className="w-4 h-4" />
      </a>
    </div>
  );
};
