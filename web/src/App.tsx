import React, { useState, useRef, useMemo, useCallback } from 'react';
import { Radio, ZoomIn, ZoomOut, Maximize2, Sparkles, Info, Loader2, X } from 'lucide-react';
import { useGraphData } from './hooks/useGraphData';
import { AtlasCanvas, AtlasCanvasHandle } from './components/AtlasCanvas';
import { SearchBar } from './components/SearchBar';
import { ControlHUD } from './components/ControlHUD';
import { ArtistDrawer } from './components/ArtistDrawer';
import { AudioPlayerBar } from './components/AudioPlayerBar';
import { AtlasNode } from './types/atlas';

export const App: React.FC = () => {
  const {
    data,
    nodeMap,
    nodeIndexMap,
    continentIndicesMap,
    neighborMap,
    detailsMap,
    loading,
    error,
    loadContinentDetails
  } = useGraphData();

  const canvasRef = useRef<AtlasCanvasHandle | null>(null);

  // UI States
  const [selectedArtistId, setSelectedArtistId] = useState<string | null>(null);
  const [selectedContinentId, setSelectedContinentId] = useState<number | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState<boolean>(false);
  const [activeAudioArtist, setActiveAudioArtist] = useState<AtlasNode | null>(null);
  const [showAbout, setShowAbout] = useState<boolean>(false);
  const [isCanvasReady, setIsCanvasReady] = useState<boolean>(false);

  // Fetch continent details on demand when an artist is selected
  React.useEffect(() => {
    if (!selectedArtistId) return;
    const node = nodeMap.get(selectedArtistId);
    if (node && node.continentId) {
      loadContinentDetails(node.continentId);
    }
  }, [selectedArtistId, nodeMap, loadContinentDetails]);

  // Fetch continent details on demand when an active audio preview starts
  React.useEffect(() => {
    if (!activeAudioArtist) return;
    const node = nodeMap.get(activeAudioArtist.id);
    if (node && node.continentId) {
      loadContinentDetails(node.continentId);
    }
  }, [activeAudioArtist, nodeMap, loadContinentDetails]);

  // Selected artist object with merged details & hydrated crossover metadata
  const selectedArtist = useMemo(() => {
    if (!selectedArtistId) return null;
    const base = nodeMap.get(selectedArtistId);
    if (!base) return null;
    const details = detailsMap[selectedArtistId];
    if (!details) {
      return {
        ...base,
        spotifyUrl: `https://open.spotify.com/search/${encodeURIComponent(base.label || '')}`
      };
    }
    const resolvedCrossovers = details.topCrossovers?.map((c) => ({
      ...c,
      neighborName: nodeMap.get(c.neighborId)?.label || c.neighborName || c.neighborId,
      image: nodeMap.get(c.neighborId)?.image || c.image || ''
    }));
    return {
      ...base,
      ...details,
      topCrossovers: resolvedCrossovers,
      spotifyUrl: details.spotifyUrl || `https://open.spotify.com/search/${encodeURIComponent(base.label || '')}`
    };
  }, [nodeMap, selectedArtistId, detailsMap]);

  // Active audio artist merged with details if available
  const mergedAudioArtist = useMemo(() => {
    if (!activeAudioArtist) return null;
    const details = detailsMap[activeAudioArtist.id];
    if (!details) return activeAudioArtist;
    return {
      ...activeAudioArtist,
      ...details,
      spotifyUrl: details.spotifyUrl || `https://open.spotify.com/search/${encodeURIComponent(activeAudioArtist.label || '')}`
    };
  }, [activeAudioArtist, detailsMap]);

  // Immediate, synchronous artist selection
  const handleSelectArtist = useCallback((id: string | null, shouldFly: boolean = false) => {
    setSelectedArtistId(id);
    if (id && shouldFly && canvasRef.current) {
      canvasRef.current.flyToNode(id);
    }
  }, []);

  // Continent selection (clears artist selection to maintain sync)
  const handleSelectContinent = useCallback((continentId: number | null) => {
    setSelectedContinentId(continentId);
    if (continentId !== null) {
      setSelectedArtistId(null);
    }
  }, []);

  const handleTogglePreview = useCallback((artist: AtlasNode) => {
    setActiveAudioArtist((current) => {
      if (current?.id === artist.id) {
        setIsPlayingAudio((prev) => !prev);
        return current;
      } else {
        setIsPlayingAudio(true);
        return artist;
      }
    });
  }, []);

  // Active audio artist ref for keyboard shortcuts
  const activeAudioArtistRef = useRef(activeAudioArtist);
  activeAudioArtistRef.current = activeAudioArtist;

  // Global keyboard shortcuts (Escape to deselect artist or close modal, Space to toggle active audio preview)
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInputFocused =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if (e.key === 'Escape') {
        if (showAbout) {
          setShowAbout(false);
          return;
        }
        if (!isInputFocused) {
          setSelectedArtistId(null);
        }
        return;
      }

      if ((e.code === 'Space' || e.key === ' ') && !isInputFocused) {
        if (activeAudioArtistRef.current) {
          e.preventDefault();
          setIsPlayingAudio((prev) => !prev);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showAbout]);

  if (error) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-[#07090e] gap-4 text-center px-4">
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 max-w-md">
          <h2 className="text-base font-bold mb-1">Failed to load Atlas Graph</h2>
          <p className="text-xs text-slate-400 font-mono">{error || "Graph data unavailable"}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-[#07090e] gap-4">
        <Loader2 className="w-10 h-10 text-emerald-400 animate-spin" />
        <div className="text-center px-4">
          <h2 className="text-lg font-bold text-white tracking-wide">INITIALIZING MUSIC ATLAS</h2>
          <p className="text-sm text-slate-400 font-mono mt-1">Spatializing cosmic artists across EveryNoise community playlists...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#07090e] select-none">
      {/* Full-Screen Loading Overlay: Stays active and spinning until Cosmograph is fully initialized, uploaded to GPU, and rendered */}
      {!isCanvasReady && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#07090e] gap-4 pointer-events-auto">
          <Loader2 className="w-10 h-10 text-emerald-400 animate-spin" />
          <div className="text-center px-4">
            <h2 className="text-lg font-bold text-white tracking-wide">INITIALIZING MUSIC ATLAS</h2>
            <p className="text-sm text-slate-400 font-mono mt-1">
              Rendering 49,685 artists and crossover filaments...
            </p>
          </div>
        </div>
      )}

      {/* WebGL2 Cosmograph Canvas */}
      <AtlasCanvas
        ref={canvasRef}
        nodes={data.nodes}
          edges={data.edges}
          nodeIndexMap={nodeIndexMap}
          continentIndicesMap={continentIndicesMap}
          neighborMap={neighborMap}
          selectedNodeId={selectedArtistId}
          onSelectNode={handleSelectArtist}
          selectedContinentId={selectedContinentId}
          onReady={() => setIsCanvasReady(true)}
        />

      {/* Sleek Floating Top Navigation Island */}
      <header
        style={{ top: 'max(1rem, env(safe-area-inset-top))' }}
        className="absolute left-4 right-4 z-50 flex items-center justify-between gap-2 sm:gap-4 pointer-events-none"
      >
        {/* Brand Logo & Stats */}
        <div className="glass-panel rounded-full h-10 w-10 sm:w-auto p-0 sm:px-4 flex items-center justify-center sm:justify-start gap-2.5 shadow-xl pointer-events-auto shrink-0 border border-white/10 bg-[#07090e]/85 backdrop-blur-xl">
          <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-emerald-400 to-cyan-400 flex items-center justify-center shadow-md shadow-emerald-500/20 shrink-0">
            <Radio className="w-3.5 h-3.5 text-black stroke-[2.5]" />
          </div>
          <span className="hidden sm:inline-block font-extrabold text-xs sm:text-sm tracking-wider text-white whitespace-nowrap pr-1">
            MUSIC ATLAS
          </span>
        </div>

        {/* Global Search Bar (Expands on Mobile) */}
        <div className="pointer-events-auto flex-1 min-w-0 max-w-none sm:max-w-md">
          <SearchBar
            nodes={data.nodes}
            onSelectArtist={(artistId) => handleSelectArtist(artistId, true)}
            selectedArtistId={selectedArtistId}
          />
        </div>

        {/* Minimal Control HUD (Desktop) */}
        <div className="hidden sm:flex pointer-events-auto items-center gap-2">
          <ControlHUD
            continents={data.continents}
            selectedContinentId={selectedContinentId}
            onSelectContinent={handleSelectContinent}
            align="right"
          />

          <button
            onClick={() => setShowAbout(true)}
            className="glass-panel h-10 w-10 flex items-center justify-center hover:bg-white/10 text-slate-400 hover:text-white transition-colors shadow-xl shrink-0"
            title="About Music Atlas"
          >
            <Info className="w-4 h-4" />
          </button>
        </div>

        {/* Mobile Info Button */}
        <div className="flex sm:hidden pointer-events-auto items-center">
          <button
            onClick={() => setShowAbout(true)}
            className="glass-panel h-10 w-10 flex items-center justify-center hover:bg-white/10 text-slate-400 hover:text-white transition-colors shadow-xl shrink-0"
            title="About Music Atlas"
          >
            <Info className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Mobile Floating Continents Pill (Below Header on Left) */}
      <div
        style={{ top: 'calc(max(1rem, env(safe-area-inset-top)) + 48px)' }}
        className="fixed left-4 z-40 sm:hidden pointer-events-auto"
      >
        <ControlHUD
          continents={data.continents}
          selectedContinentId={selectedContinentId}
          onSelectContinent={handleSelectContinent}
          align="left"
        />
      </div>

      {/* Floating Zoom & Reset View Controls */}
      {/* Desktop: Bottom-Left */}
      <div
        style={{ position: 'fixed', bottom: '24px', left: '24px', zIndex: 30 }}
        className="hidden sm:flex pointer-events-auto flex-col gap-1.5 shadow-2xl"
      >
        <button
          onClick={() => canvasRef.current?.zoomIn()}
          className="glass-panel w-9 h-9 flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/15 transition-all shadow-lg rounded-xl"
          title="Zoom In"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={() => canvasRef.current?.zoomOut()}
          className="glass-panel w-9 h-9 flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/15 transition-all shadow-lg rounded-xl"
          title="Zoom Out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={() => canvasRef.current?.resetView()}
          className="glass-panel w-9 h-9 flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/15 transition-all shadow-lg rounded-xl"
          title="Reset Map View"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>

      {/* Mobile: Top-Right Beneath Header */}
      <div
        style={{ position: 'fixed', top: 'calc(max(1rem, env(safe-area-inset-top)) + 48px)', right: '16px', zIndex: 30 }}
        className="flex sm:hidden pointer-events-auto flex-col gap-1.5 shadow-2xl"
      >
        <button
          onClick={() => canvasRef.current?.zoomIn()}
          className="glass-panel w-8 h-8 flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/15 transition-all shadow-lg rounded-xl"
          title="Zoom In"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => canvasRef.current?.zoomOut()}
          className="glass-panel w-8 h-8 flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/15 transition-all shadow-lg rounded-xl"
          title="Zoom Out"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => canvasRef.current?.resetView()}
          className="glass-panel w-8 h-8 flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/15 transition-all shadow-lg rounded-xl"
          title="Reset Map View"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Bottom Container for Mobile Sheet & Persistent Audio Player */}
      <div className="fixed z-[60] pointer-events-none bottom-0 left-0 right-0 w-full flex flex-col items-center justify-end md:contents">
        {/* Persistent Audio Player Bar */}
        {activeAudioArtist && (
          <div
            style={{
              marginBottom: selectedArtist ? '8px' : 'max(12px, env(safe-area-inset-bottom))'
            }}
            className="pointer-events-none px-3 sm:px-4 w-full max-w-2xl flex justify-center transition-[margin] duration-300 ease-out md:fixed md:bottom-6 md:left-1/2 md:-translate-x-1/2 md:mb-0 md:z-[60]"
          >
            <AudioPlayerBar
              currentArtist={mergedAudioArtist}
              isPlaying={isPlayingAudio}
              onTogglePlay={() => setIsPlayingAudio(!isPlayingAudio)}
              onSelectArtist={(id) => handleSelectArtist(id, true)}
            />
          </div>
        )}

        {/* Floating Artist Inspector: Desktop Slide-over Drawer & Mobile Native Bottom Sheet */}
        {selectedArtist && (
          <div className="pointer-events-none w-full md:w-auto md:fixed md:top-[72px] md:bottom-6 md:right-6 md:z-[60] flex justify-center md:justify-end">
            <ArtistDrawer
              key={selectedArtist.id}
              artist={selectedArtist}
              onClose={() => setSelectedArtistId(null)}
              onSelectNeighbor={(id) => handleSelectArtist(id, true)}
              isPlayingPreview={isPlayingAudio && activeAudioArtist?.id === selectedArtist.id}
              onTogglePreview={handleTogglePreview}
              currentlyPlayingId={activeAudioArtist?.id || null}
            />
          </div>
        )}
      </div>

      {/* About Modal */}
      {showAbout && (
        <div
          onClick={() => setShowAbout(false)}
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm pointer-events-auto"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="glass-panel max-w-lg w-full p-6 shadow-2xl relative border border-white/20 rounded-2xl flex flex-col gap-4"
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-emerald-400" />
                About Music Atlas
              </h3>
              <button
                type="button"
                onClick={() => setShowAbout(false)}
                className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-sm text-slate-300 leading-relaxed">
              Music Atlas is an attempt at visualizing the global music streaming landscape, gathering genres from EveryNoise and public YouTube Music user playlists, with artist information from Deezer. The goal is to see common and similar artists that each user would listen to.
            </p>

            <div className="bg-white/5 border border-white/10 rounded-xl p-3.5 flex flex-col gap-2.5 text-xs text-slate-300">
              <div className="flex items-start gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 mt-1 shrink-0 shadow-sm" />
                <div>
                  <strong className="text-white font-semibold">Dot</strong> — a music artist, larger meaning more popular and more fans (data from Deezer)
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <span className="w-2.5 h-0.5 bg-cyan-400 mt-2 shrink-0 shadow-sm" />
                <div>
                  <strong className="text-white font-semibold">Line</strong> — a connection between two artists, showing up in a significant amount of similar playlists
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-gradient-to-tr from-purple-400 to-pink-400 mt-1 shrink-0 shadow-sm" />
                <div>
                  <strong className="text-white font-semibold">Color</strong> — a group of genres, defined by EveryNoise subgenres and results from YouTube
                </div>
              </div>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Let me know if there are any bugs or issues at{' '}
              <a
                href="mailto:leon.mofx@gmail.com"
                className="text-emerald-400 hover:text-emerald-300 underline font-medium transition-colors"
              >
                leon.mofx@gmail.com
              </a>
              ! Inspired by the Twitch Atlas.
            </p>

            <button
              onClick={() => setShowAbout(false)}
              className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-sm transition-all shadow-lg shadow-emerald-500/20 cursor-pointer"
            >
              Enter the Atlas
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
