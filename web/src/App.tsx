import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { Radio, ZoomIn, ZoomOut, Maximize2, Info, Loader2 } from 'lucide-react';
import { useGraphData } from './hooks/useGraphData';
import { AtlasCanvas, AtlasCanvasHandle } from './components/AtlasCanvas';
import { SearchBar } from './components/SearchBar';
import { ControlHUD } from './components/ControlHUD';
import { ArtistDrawer } from './components/ArtistDrawer';
import { AudioPlayerBar } from './components/AudioPlayerBar';
import { AboutModal } from './components/AboutModal';
import { AtlasNode } from './types/atlas';
import { hydrateArtistDetails } from './utils/artistUtils';

const STORAGE_KEY_SEEN_ABOUT = 'music_atlas_has_seen_about';

function getInitialShowAbout(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY_SEEN_ABOUT) !== 'true';
  } catch {
    return false;
  }
}

export const App: React.FC = () => {
  const {
    data,
    nodeMap,
    nodeIndexMap,
    continentIndicesMap,
    sortedGlobalIndices,
    sortedContinentIndices,
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
  const [densityRange, setDensityRange] = useState<[number, number] | null>(null);
  const [connectionPercentile, setConnectionPercentile] = useState<number>(0);
  const [isPlayingAudio, setIsPlayingAudio] = useState<boolean>(false);
  const [activeAudioArtist, setActiveAudioArtist] = useState<AtlasNode | null>(null);
  const [showAbout, setShowAbout] = useState<boolean>(getInitialShowAbout);
  const [isCanvasReady, setIsCanvasReady] = useState<boolean>(false);
  const [mobileDragOffset, setMobileDragOffset] = useState<number>(0);
  const [isMobileDragging, setIsMobileDragging] = useState<boolean>(false);

  const handleCloseAbout = useCallback(() => {
    setShowAbout(false);
    try {
      localStorage.setItem(STORAGE_KEY_SEEN_ABOUT, 'true');
    } catch {
      // Graceful fallback if localStorage is disabled or restricted
    }
  }, []);

  // Fetch continent details on demand when an artist is selected
  useEffect(() => {
    if (!selectedArtistId) return;
    const node = nodeMap.get(selectedArtistId);
    if (node && node.continentId) {
      loadContinentDetails(node.continentId);
    }
  }, [selectedArtistId, nodeMap, loadContinentDetails]);

  // Fetch continent details on demand when an active audio preview starts
  useEffect(() => {
    if (!activeAudioArtist) return;
    const node = nodeMap.get(activeAudioArtist.id);
    if (node && node.continentId) {
      loadContinentDetails(node.continentId);
    }
  }, [activeAudioArtist, nodeMap, loadContinentDetails]);

  // Selected artist object with merged details & hydrated crossover metadata
  const selectedArtist = useMemo(() => {
    if (!selectedArtistId) return null;
    const base = nodeMap.get(selectedArtistId) || null;
    return hydrateArtistDetails(base, detailsMap[selectedArtistId], nodeMap);
  }, [nodeMap, selectedArtistId, detailsMap]);

  // Active audio artist merged with details if available
  const mergedAudioArtist = useMemo(() => {
    if (!activeAudioArtist) return null;
    return hydrateArtistDetails(activeAudioArtist, detailsMap[activeAudioArtist.id], nodeMap);
  }, [activeAudioArtist, detailsMap, nodeMap]);

  // Immediate, synchronous artist selection
  const handleSelectArtist = useCallback((id: string | null, shouldFly: boolean = false) => {
    setSelectedArtistId(id);
    setMobileDragOffset(0);
    setIsMobileDragging(false);
    if (id && shouldFly && canvasRef.current) {
      canvasRef.current.flyToNode(id);
    }
  }, []);

  // Continent selection (clears artist selection and resets rank slice to maintain sync and avoid out-of-bounds)
  const handleSelectContinent = useCallback((continentId: number | null) => {
    setSelectedContinentId(continentId);
    setDensityRange(null);
    if (continentId !== null) {
      setSelectedArtistId(null);
      setMobileDragOffset(0);
      setIsMobileDragging(false);
    }
  }, []);

  // Popularity rank range filter selection
  const handleSelectDensityRange = useCallback((range: [number, number] | null) => {
    setDensityRange(range);
    if (range !== null) {
      setSelectedArtistId(null);
      setMobileDragOffset(0);
      setIsMobileDragging(false);
    }
  }, []);

  const handleSelectConnectionPercentile = useCallback((val: number) => {
    setConnectionPercentile(val);
  }, []);

  const handleCanvasReady = useCallback(() => {
    setIsCanvasReady(true);
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
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInputFocused =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if (e.key === 'Escape') {
        if (showAbout) {
          handleCloseAbout();
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
  }, [showAbout, handleCloseAbout]);

  if (error) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-[#07090e] gap-4 text-center px-4">
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 max-w-md">
          <h2 className="text-base font-bold mb-1">Failed to load Atlas Graph</h2>
          <p className="text-xs text-slate-400">{error || 'Graph data unavailable'}</p>
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
          <p className="text-sm text-slate-400 mt-1">
            Spatializing cosmic artists across EveryNoise community playlists...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#07090e] select-none">
      {/* Full-Screen Loading Overlay */}
      {!isCanvasReady && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#07090e] gap-4 pointer-events-auto">
          <Loader2 className="w-10 h-10 text-emerald-400 animate-spin" />
          <div className="text-center px-4">
            <h2 className="text-lg font-bold text-white tracking-wide">INITIALIZING MUSIC ATLAS</h2>
            <p className="text-sm text-slate-400 mt-1">
              Rendering {data.nodes.length.toLocaleString()} artists and crossover filaments...
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
        sortedGlobalIndices={sortedGlobalIndices}
        sortedContinentIndices={sortedContinentIndices}
        neighborMap={neighborMap}
        selectedNodeId={selectedArtistId}
        onSelectNode={handleSelectArtist}
        selectedContinentId={selectedContinentId}
        densityRange={densityRange}
        connectionPercentile={connectionPercentile}
        onReady={handleCanvasReady}
      />

      {/* Floating Top Navigation Island */}
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
            densityRange={densityRange}
            onSelectDensityRange={handleSelectDensityRange}
            connectionPercentile={connectionPercentile}
            onSelectConnectionPercentile={handleSelectConnectionPercentile}
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
          densityRange={densityRange}
          onSelectDensityRange={handleSelectDensityRange}
          connectionPercentile={connectionPercentile}
          onSelectConnectionPercentile={handleSelectConnectionPercentile}
          align="left"
        />
      </div>

      {/* Floating Zoom & Reset View Controls */}
      {/* Desktop: Bottom-Left */}
      <div
        style={{ position: 'fixed', bottom: '24px', left: '24px', zIndex: 30 }}
        className="hidden sm:flex pointer-events-auto flex-col items-center bg-[#07090e]/70 backdrop-blur-xl border border-white/10 rounded-2xl p-1 shadow-2xl"
      >
        <button
          onClick={() => canvasRef.current?.zoomIn()}
          className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          title="Zoom In"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <div className="w-3.5 h-[1px] bg-white/10 my-0.5" />
        <button
          onClick={() => canvasRef.current?.zoomOut()}
          className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          title="Zoom Out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <div className="w-3.5 h-[1px] bg-white/10 my-0.5" />
        <button
          onClick={() => canvasRef.current?.resetView()}
          className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          title="Reset Map View"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Mobile: Top-Right Beneath Header */}
      <div
        style={{
          position: 'fixed',
          top: 'calc(max(1rem, env(safe-area-inset-top)) + 48px)',
          right: '16px',
          zIndex: 30
        }}
        className="flex sm:hidden pointer-events-auto flex-col items-center bg-[#07090e]/70 backdrop-blur-xl border border-white/10 rounded-2xl p-1 shadow-2xl"
      >
        <button
          onClick={() => canvasRef.current?.zoomIn()}
          className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          title="Zoom In"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <div className="w-3.5 h-[1px] bg-white/10 my-0.5" />
        <button
          onClick={() => canvasRef.current?.zoomOut()}
          className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          title="Zoom Out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <div className="w-3.5 h-[1px] bg-white/10 my-0.5" />
        <button
          onClick={() => canvasRef.current?.resetView()}
          className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          title="Reset Map View"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Bottom Container for Mobile Sheet & Persistent Audio Player */}
      <div className="fixed z-[60] pointer-events-none bottom-0 left-0 right-0 w-full flex flex-col items-center justify-end md:contents">
        {/* Single Persistent Audio Player Bar */}
        {activeAudioArtist && (
          <div
            style={{
              marginBottom: selectedArtist ? '6px' : 'max(12px, env(safe-area-inset-bottom))',
              transform: mobileDragOffset !== 0 ? `translateY(${mobileDragOffset}px)` : undefined,
              transition: isMobileDragging
                ? 'none'
                : 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1), margin 0.3s ease-out'
            }}
            className="pointer-events-auto px-3 sm:px-4 w-full max-w-2xl flex justify-center md:fixed md:bottom-6 md:left-0 md:right-0 md:mx-auto md:mb-0 md:z-[60]"
          >
            <AudioPlayerBar
              currentArtist={mergedAudioArtist}
              isPlaying={isPlayingAudio}
              onTogglePlay={() => setIsPlayingAudio((prev) => !prev)}
              onSelectArtist={(id) => handleSelectArtist(id, true)}
              onClose={() => {
                setIsPlayingAudio(false);
                setActiveAudioArtist(null);
              }}
            />
          </div>
        )}

        {/* Single Floating Artist Inspector */}
        {selectedArtist && (
          <div
            style={{
              transform: mobileDragOffset !== 0 ? `translateY(${mobileDragOffset}px)` : undefined,
              transition: isMobileDragging
                ? 'none'
                : 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)'
            }}
            className="pointer-events-auto w-full md:w-auto md:fixed md:top-[72px] md:bottom-24 md:right-4 lg:right-6 md:z-[60] flex justify-center md:justify-end"
          >
            <ArtistDrawer
              key={selectedArtist.id}
              artist={selectedArtist}
              onClose={() => setSelectedArtistId(null)}
              onSelectNeighbor={(id) => handleSelectArtist(id, true)}
              isPlayingPreview={isPlayingAudio && activeAudioArtist?.id === selectedArtist.id}
              onTogglePreview={handleTogglePreview}
              currentlyPlayingId={activeAudioArtist?.id || null}
              onDragStateChange={(offset, dragging) => {
                setMobileDragOffset(offset);
                setIsMobileDragging(dragging);
              }}
            />
          </div>
        )}
      </div>

      {/* About Modal */}
      <AboutModal isOpen={showAbout} onClose={handleCloseAbout} />
    </div>
  );
};
