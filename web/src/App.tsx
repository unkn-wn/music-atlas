import React, { useState, useRef, useMemo, useCallback } from 'react';
import { Radio, ZoomIn, ZoomOut, Maximize2, Sparkles, Info, Loader2 } from 'lucide-react';
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

  if (loading) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-[#07090e] gap-4">
        <Loader2 className="w-10 h-10 text-emerald-400 animate-spin" />
        <div className="text-center">
          <h2 className="text-lg font-bold text-white tracking-wide">INITIALIZING MUSIC ATLAS</h2>
          <p className="text-sm text-slate-400 font-mono mt-1">Spatializing cosmic artists across EveryNoise community playlists...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-[#07090e] gap-4 text-center px-4">
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 max-w-md">
          <h2 className="text-base font-bold mb-1">Failed to load Atlas Graph</h2>
          <p className="text-xs text-slate-400 font-mono">{error || "Graph data unavailable"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#07090e] select-none">
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
      />

      {/* Sleek Floating Top Navigation Island */}
      <header
        style={{ top: 'max(1rem, env(safe-area-inset-top))' }}
        className="absolute left-4 right-4 z-50 flex items-center justify-between gap-2 sm:gap-4 pointer-events-none"
      >
        {/* Brand Logo & Stats */}
        <div className="glass-panel h-10 w-10 sm:w-auto p-0 sm:px-3.5 flex items-center justify-center sm:justify-start gap-2 sm:gap-2.5 shadow-xl pointer-events-auto shrink-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-emerald-500 to-cyan-400 flex items-center justify-center shadow-md shadow-emerald-500/20">
            <Radio className="w-3.5 h-3.5 text-black stroke-[2.5]" />
          </div>
          <span className="hidden sm:inline-block font-extrabold text-xs sm:text-sm tracking-wider text-white whitespace-nowrap">
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
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm pointer-events-auto">
          <div className="glass-panel max-w-lg w-full p-6 shadow-2xl relative border border-white/20">
            <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-emerald-400" />
              About Music Atlas
            </h3>
            <p className="text-sm text-slate-300 leading-relaxed mb-4">
              <strong>Music Atlas</strong> is an interactive WebGL2 spatial network visualization of the global music streaming landscape, powered by empirical EveryNoise taxonomy ingestion and public YouTube Music human community curations.
            </p>
            <ul className="text-xs text-slate-300 space-y-2 mb-6 list-disc pl-4 font-normal">
              <li><strong>Zero Developer Selection Bias:</strong> Systematic EveryNoise genre taxonomy ingestion spanning thousands of micro-genres and underground scenes.</li>
              <li><strong>Universal Empirical Sizing:</strong> Artist nodes sized strictly proportional to public YouTube Music subscriber counts.</li>
              <li><strong>Spiderweb Filaments:</strong> Crossover bridges derived from real multi-artist human playlist co-occurrences rendered smoothly in WebGL2 GPU shaders.</li>
              <li><strong>Adaptive Focus Mode:</strong> Clicking any artist reveals their top 6 to 20 most prominent connections with relative affinity bars.</li>
              <li><strong>Multi-Subgenre Tagging:</strong> Preserves the top 3 most prominent subgenres per artist with audio preview streams.</li>
            </ul>
            <button
              onClick={() => setShowAbout(false)}
              className="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-sm transition-all shadow-lg shadow-emerald-500/20"
            >
              Enter the Atlas
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
