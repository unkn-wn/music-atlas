import React, { useState, useRef, useMemo } from 'react';
import { Radio, ZoomIn, ZoomOut, Maximize2, Sparkles, Info, Loader2 } from 'lucide-react';
import { useGraphData } from './hooks/useGraphData';
import { AtlasCanvas, AtlasCanvasHandle } from './components/AtlasCanvas';
import { SearchBar } from './components/SearchBar';
import { ControlHUD } from './components/ControlHUD';
import { ArtistDrawer } from './components/ArtistDrawer';
import { AudioPlayerBar } from './components/AudioPlayerBar';
import { AtlasNode } from './types/atlas';

export const App: React.FC = () => {
  const { data, graph, detailsMap, loading, error } = useGraphData();
  const canvasRef = useRef<AtlasCanvasHandle | null>(null);

  // UI States
  const [selectedArtistId, setSelectedArtistId] = useState<string | null>(null);
  const [selectedContinentId, setSelectedContinentId] = useState<number | null>(null);
  const [hoveredContinentId, setHoveredContinentId] = useState<number | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState<boolean>(false);
  const [activeAudioArtist, setActiveAudioArtist] = useState<AtlasNode | null>(null);
  const [showAbout, setShowAbout] = useState<boolean>(false);

  // Fast node map for O(1) selection lookup
  const nodeMap = useMemo(() => {
    if (!data) return new Map<string, AtlasNode>();
    const map = new Map<string, AtlasNode>();
    for (const node of data.nodes) {
      map.set(node.id, node);
    }
    return map;
  }, [data]);

  // Selected artist object with merged details
  const selectedArtist = useMemo(() => {
    if (!selectedArtistId) return null;
    const base = nodeMap.get(selectedArtistId);
    if (!base) return null;
    const details = detailsMap ? detailsMap[selectedArtistId] : undefined;
    if (!details) {
      return {
        ...base,
        spotifyUrl: `https://open.spotify.com/search/${encodeURIComponent(base.label)}`
      };
    }
    return {
      ...base,
      ...details,
      spotifyUrl: details.spotifyUrl || `https://open.spotify.com/search/${encodeURIComponent(base.label)}`
    };
  }, [nodeMap, selectedArtistId, detailsMap]);

  // Active audio artist merged with details if available
  const mergedAudioArtist = useMemo(() => {
    if (!activeAudioArtist) return null;
    const details = detailsMap ? detailsMap[activeAudioArtist.id] : undefined;
    if (!details) return activeAudioArtist;
    return {
      ...activeAudioArtist,
      ...details,
      spotifyUrl: details.spotifyUrl || `https://open.spotify.com/search/${encodeURIComponent(activeAudioArtist.label)}`
    };
  }, [activeAudioArtist, detailsMap]);

  // Drawer artist bound strictly to deliberate selection
  const drawerArtist = selectedArtist;

  // Immediate, synchronous artist selection (zero transition lag)
  const handleSelectArtist = (id: string | null, shouldFly: boolean = false) => {
    setSelectedArtistId(id);
    if (id && shouldFly && canvasRef.current) {
      canvasRef.current.flyToNode(id);
    }
  };

  const handleTogglePreview = (artist: AtlasNode) => {
    if (activeAudioArtist?.id === artist.id) {
      setIsPlayingAudio(!isPlayingAudio);
    } else {
      setActiveAudioArtist(artist);
      setIsPlayingAudio(true);
    }
  };

  // Active audio artist ref for keyboard shortcuts
  const activeAudioArtistRef = useRef(activeAudioArtist);
  activeAudioArtistRef.current = activeAudioArtist;

  // Global keyboard shortcuts (Escape to reset view, Space to toggle active audio preview)
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInputFocused =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if (e.key === 'Escape') {
        setSelectedArtistId(null);
        canvasRef.current?.resetView();
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
  }, []);

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

  if (error || !data || !graph) {
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
      {/* WebGL Sigma Canvas */}
      <AtlasCanvas
        ref={canvasRef}
        graph={graph}
        selectedNodeId={selectedArtistId}
        onSelectNode={handleSelectArtist}
        selectedContinentId={selectedContinentId}
        hoveredContinentId={hoveredContinentId}
      />

      {/* Sleek Floating Top Navigation Island */}
      <header className="absolute top-4 left-4 right-4 z-50 flex items-center justify-between gap-4 pointer-events-none">
        {/* Brand Logo & Stats */}
        <div className="glass-panel px-3.5 py-2 flex items-center gap-2.5 shadow-xl pointer-events-auto shrink-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-emerald-500 to-cyan-400 flex items-center justify-center shadow-md shadow-emerald-500/20">
            <Radio className="w-3.5 h-3.5 text-black stroke-[2.5]" />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-xs sm:text-sm tracking-wider text-white">
              MUSIC ATLAS
            </span>
            <span className="hidden lg:inline-block text-[11px] font-mono text-slate-400">
              {data.metadata.nodeCount.toLocaleString()} artists &bull; {data.metadata.edgeCount.toLocaleString()} bridges
            </span>
          </div>
        </div>

        {/* Global Search Bar */}
        <div className="pointer-events-auto flex-1 max-w-sm sm:max-w-md">
          <SearchBar
            nodes={data.nodes}
            onSelectArtist={(artistId) => handleSelectArtist(artistId, true)}
            selectedArtistId={selectedArtistId}
          />
        </div>

        {/* Minimal Control HUD */}
        <div className="pointer-events-auto flex items-center gap-2">
          <ControlHUD
            continents={data.continents}
            selectedContinentId={selectedContinentId}
            onSelectContinent={setSelectedContinentId}
            hoveredContinentId={hoveredContinentId}
            onHoverContinent={setHoveredContinentId}
          />

          <button
            onClick={() => setShowAbout(true)}
            className="glass-panel p-2 hover:bg-white/10 text-slate-400 hover:text-white transition-colors shadow-xl shrink-0"
            title="About Music Atlas"
          >
            <Info className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Floating Minimal Zoom & Reset View Controls */}
      <div
        style={{ position: 'fixed', bottom: '24px', left: '24px', zIndex: 30 }}
        className="pointer-events-auto flex flex-col gap-1.5 shadow-2xl"
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
          title="Reset Map View (Esc)"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>

      {/* Floating Artist Inspector Drawer (Slide-over on Right) */}
      {drawerArtist && (
        <div
          style={{ position: 'fixed', top: '72px', bottom: '24px', right: '24px', left: 'auto', width: 'auto', zIndex: 40 }}
          className="pointer-events-none flex justify-end"
        >
          <ArtistDrawer
            key={drawerArtist.id}
            artist={drawerArtist}
            onClose={() => setSelectedArtistId(null)}
            onSelectNeighbor={handleSelectArtist}
            isPlayingPreview={isPlayingAudio && activeAudioArtist?.id === drawerArtist.id}
            onTogglePreview={handleTogglePreview}
            currentlyPlayingId={activeAudioArtist?.id || null}
          />
        </div>
      )}

      {/* Persistent Audio Player Bar (Bottom Center) */}
      {activeAudioArtist && (
        <div
          style={{ position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', zIndex: 45 }}
          className="pointer-events-none px-4 w-full max-w-2xl flex justify-center"
        >
          <AudioPlayerBar
            currentArtist={mergedAudioArtist}
            isPlaying={isPlayingAudio}
            onTogglePlay={() => setIsPlayingAudio(!isPlayingAudio)}
          />
        </div>
      )}

      {/* About Modal */}
      {showAbout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm pointer-events-auto">
          <div className="glass-panel max-w-lg w-full p-6 shadow-2xl relative border border-white/20">
            <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-emerald-400" />
              About Music Atlas
            </h3>
            <p className="text-sm text-slate-300 leading-relaxed mb-4">
              <strong>Music Atlas</strong> is an autonomous 2D spatial network visualization of the global music streaming landscape, powered by empirical EveryNoise taxonomy ingestion and public YouTube Music human community curations.
            </p>
            <ul className="text-xs text-slate-300 space-y-2 mb-6 list-disc pl-4 font-normal">
              <li><strong>Zero Developer Selection Bias:</strong> Systematic EveryNoise genre taxonomy ingestion spanning thousands of micro-genres and underground scenes.</li>
              <li><strong>Universal Empirical Sizing:</strong> Artist nodes sized strictly proportional to public YouTube Music subscriber counts.</li>
              <li><strong>Spiderweb Filaments:</strong> Inward-curved Bézier crossover bridges derived from real multi-artist human playlist co-occurrences.</li>
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
