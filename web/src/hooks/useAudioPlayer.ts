import { useRef, useState, useEffect } from 'react';
import { AtlasNode } from '../types/atlas';
import { resolveArtistPreview, getCachedPreview } from '../utils/audioResolver';

export function formatAudioTime(seconds: number): string {
  return `0:${Math.floor(seconds).toString().padStart(2, '0')}`;
}

export function useAudioPlayer(
  currentArtist: AtlasNode | null,
  isPlaying: boolean,
  onTogglePlay: () => void
) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeArtistIdRef = useRef<string | null>(null);
  const loadedSrcRef = useRef<string | null>(null);

  // Preserve callback in a ref to avoid restart cascades when inline arrow functions are passed
  const onTogglePlayRef = useRef(onTogglePlay);
  onTogglePlayRef.current = onTogglePlay;

  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(30);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(0.2);
  const [isMuted, setIsMuted] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [resolvedTitle, setResolvedTitle] = useState<string | null>(() => {
    const cached = currentArtist ? getCachedPreview(currentArtist.id, currentArtist.label) : null;
    return cached?.trackTitle || null;
  });

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
    const cached = currentArtist ? getCachedPreview(currentArtist.id, currentArtist.label) : null;
    setResolvedTitle(cached?.trackTitle || null);
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
          console.warn('Playback resume error:', e);
          onTogglePlayRef.current();
        }
      });
      return;
    }

    // Resolve preview on demand
    const targetArtistId = currentArtist.id;
    activeArtistIdRef.current = targetArtistId;
    setIsLoadingAudio(true);

    resolveArtistPreview(targetArtistId, currentArtist.label)
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
              console.warn('Audio play error:', e);
              onTogglePlayRef.current();
            }
          }
        } else {
          console.warn('No preview available for:', currentArtist.label);
          onTogglePlayRef.current();
        }
      })
      .catch((err) => {
        if (activeArtistIdRef.current === targetArtistId) {
          console.warn('Preview resolve error:', err);
          onTogglePlayRef.current();
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

  return {
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
  };
}
