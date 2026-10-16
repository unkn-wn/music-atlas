import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { ZoomIn, ZoomOut, Maximize2, Info, Loader2, Route } from 'lucide-react';
import { useGraphData } from './hooks/useGraphData';
import { AtlasCanvas, AtlasCanvasHandle } from './components/AtlasCanvas';
import { SearchBar } from './components/SearchBar';
import { ControlHUD } from './components/ControlHUD';
import { ArtistDrawer } from './components/ArtistDrawer';
import { AudioPlayerBar } from './components/AudioPlayerBar';
import { AboutModal } from './components/AboutModal';
import { GenrePanel } from './components/GenrePanel';
import { PathCard } from './components/PathCard';
import { Spotlight } from './components/canvas/canvasSelection';
import { AtlasNode } from './types/atlas';
import { hydrateArtistDetails } from './utils/artistUtils';
import { findPath, GraphPath } from './utils/graphPath';
import { slugify } from './utils/genreUtils';

const STORAGE_KEY_SEEN_ABOUT = 'music_atlas_has_seen_about';
const ARTIST_PARAM = 'artist';
const GENRE_PARAM = 'genre';
const FROM_PARAM = 'from';
const TO_PARAM = 'to';

// View requested via deep link (e.g. from the /artists/ and /genres/ indexes or a shared path), read once at load
const INITIAL_PARAMS = new URLSearchParams(window.location.search);
const HAS_DEEP_LINK = [ARTIST_PARAM, GENRE_PARAM, FROM_PARAM].some((key) => INITIAL_PARAMS.has(key));

/** The open path panel: either end may still be unpicked */
interface ActivePath {
  fromId: string | null;
  toId: string | null;
  /** null until both ends are picked, or when the artists aren't connected */
  result: GraphPath | null;
}

function getInitialShowAbout(): boolean {
  if (HAS_DEEP_LINK) return false;
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
    adjacency,
    genreMembers,
    genreBySlug,
    searchIndex,
    genreSearchIndex,
    detailsMap,
    loading,
    error,
    loadContinentDetails
  } = useGraphData();

  const canvasRef = useRef<AtlasCanvasHandle | null>(null);

  // UI States
  const [selectedArtistId, setSelectedArtistId] = useState<string | null>(null);
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [activePath, setActivePath] = useState<ActivePath | null>(null);
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

  // Genre and path spotlights replace the filters (and vice versa), so the map never shows a mix of both
  const clearFilters = useCallback(() => {
    setSelectedContinentId(null);
    setDensityRange(null);
    setConnectionPercentile(0);
  }, []);

  const clearSpotlights = useCallback(() => {
    setSelectedGenre(null);
    setActivePath(null);
  }, []);

  // Continent selection (clears artist selection and resets rank slice to maintain sync and avoid out-of-bounds)
  const handleSelectContinent = useCallback((continentId: number | null) => {
    setSelectedContinentId(continentId);
    setDensityRange(null);
    if (continentId !== null) {
      clearSpotlights();
      setSelectedArtistId(null);
      setMobileDragOffset(0);
      setIsMobileDragging(false);
    }
  }, [clearSpotlights]);

  // Popularity rank range filter selection
  const handleSelectDensityRange = useCallback((range: [number, number] | null) => {
    setDensityRange(range);
    if (range !== null) {
      clearSpotlights();
      setSelectedArtistId(null);
      setMobileDragOffset(0);
      setIsMobileDragging(false);
    }
  }, [clearSpotlights]);

  const handleSelectConnectionPercentile = useCallback((val: number) => {
    setConnectionPercentile(val);
    if (val > 0) clearSpotlights();
  }, [clearSpotlights]);

  // Opening a genre shows its panel (closing any artist drawer) and frames its artists
  const handleSelectGenre = useCallback(
    (genre: string) => {
      const members = genreMembers.get(genre);
      if (!members) return;
      clearFilters();
      setActivePath(null);
      setSelectedGenre(genre);
      setSelectedArtistId(null);
      setMobileDragOffset(0);
      setIsMobileDragging(false);
      canvasRef.current?.fitToIndices(members);
    },
    [genreMembers, clearFilters]
  );

  // Opens or edits the path panel; once both ends are known the path replaces any genre or filter on the map
  const handleSetPathEnds = useCallback(
    (fromId: string | null, toId: string | null) => {
      const from = fromId ? nodeIndexMap.get(fromId) : undefined;
      const to = toId ? nodeIndexMap.get(toId) : undefined;
      const result =
        from !== undefined && to !== undefined && data ? findPath(adjacency, data.edges, from, to) : null;
      setActivePath({
        fromId: from !== undefined ? fromId : null,
        toId: to !== undefined ? toId : null,
        result
      });
      if (result) {
        clearFilters();
        setSelectedGenre(null);
        canvasRef.current?.fitToIndices(result.nodes);
      }
    },
    [nodeIndexMap, adjacency, data, clearFilters]
  );

  const handleTracePath = useCallback(
    (artistId: string) => handleSetPathEnds(artistId, null),
    [handleSetPathEnds]
  );
  const handleOpenPathPanel = useCallback(
    () => setActivePath((current) => current ?? { fromId: selectedArtistId, toId: null, result: null }),
    [selectedArtistId]
  );

  const handleCloseArtist = useCallback(() => setSelectedArtistId(null), []);
  const handleCloseGenre = useCallback(() => setSelectedGenre(null), []);
  const handleClosePath = useCallback(() => setActivePath(null), []);
  const handleSelectArtistAndFly = useCallback(
    (id: string) => handleSelectArtist(id, true),
    [handleSelectArtist]
  );
  const handleFitIndices = useCallback((indices: number[]) => canvasRef.current?.fitToIndices(indices), []);
  const handlePanelDragStateChange = useCallback((offset: number, dragging: boolean) => {
    setMobileDragOffset(offset);
    setIsMobileDragging(dragging);
  }, []);
  const handleSamplePlay = useCallback(() => setIsPlayingAudio(false), []);

  // Canvas highlight for the active path, else the open genre's artists and the links among them
  const genreMemberIndices = selectedGenre ? genreMembers.get(selectedGenre) : undefined;
  const spotlight = useMemo<Spotlight | null>(() => {
    if (activePath?.result) {
      return { kind: 'path', pointIndices: activePath.result.nodes, linkIndices: activePath.result.edges };
    }
    if (!genreMemberIndices || !data) return null;
    const isMember = new Uint8Array(data.nodes.length);
    for (const idx of genreMemberIndices) isMember[idx] = 1;
    const linkIndices: number[] = [];
    data.edges.forEach((edge, i) => {
      if (isMember[edge.sourceIndex!] && isMember[edge.targetIndex!]) linkIndices.push(i);
    });
    return { kind: 'genre', pointIndices: genreMemberIndices, linkIndices };
  }, [activePath, genreMemberIndices, data]);

  const handleCanvasReady = useCallback(() => {
    setIsCanvasReady(true);
  }, []);

  // Apply the deep-linked view once the canvas can navigate: a path or genre first, then the artist on top
  const hasAppliedDeepLinkRef = useRef(false);
  useEffect(() => {
    if (!isCanvasReady || hasAppliedDeepLinkRef.current) return;
    hasAppliedDeepLinkRef.current = true;
    const from = INITIAL_PARAMS.get(FROM_PARAM);
    const to = INITIAL_PARAMS.get(TO_PARAM);
    const genre = genreBySlug.get(INITIAL_PARAMS.get(GENRE_PARAM) ?? '');
    const artistId = INITIAL_PARAMS.get(ARTIST_PARAM);
    if (from && to) handleSetPathEnds(from, to);
    else if (genre) handleSelectGenre(genre);
    if (artistId && nodeMap.has(artistId)) handleSelectArtist(artistId, true);
  }, [isCanvasReady, genreBySlug, nodeMap, handleSetPathEnds, handleSelectGenre, handleSelectArtist]);

  // Mirror the current view into the URL so it is shareable
  useEffect(() => {
    if (!isCanvasReady) return;
    const url = new URL(window.location.href);
    const params: [string, string | null][] = [
      [ARTIST_PARAM, selectedArtistId],
      [GENRE_PARAM, selectedGenre ? slugify(selectedGenre) : null],
      [FROM_PARAM, activePath?.fromId ?? null],
      [TO_PARAM, activePath?.toId ?? null]
    ];
    for (const [key, value] of params) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    window.history.replaceState(null, '', url);
  }, [isCanvasReady, selectedArtistId, selectedGenre, activePath]);

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
  // Layers Escape closes, top first: artist drawer, then genre panel, then path
  const escapeLayersRef = useRef({ selectedArtistId, selectedGenre, activePath });
  escapeLayersRef.current = { selectedArtistId, selectedGenre, activePath };

  // Global keyboard shortcuts (Escape to close the top layer or modal, Space to toggle active audio preview)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInputFocused =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'AUDIO' ||
          target.isContentEditable);

      if (e.key === 'Escape') {
        if (showAbout) {
          handleCloseAbout();
          return;
        }
        if (!isInputFocused) {
          const layers = escapeLayersRef.current;
          if (layers.selectedArtistId) setSelectedArtistId(null);
          else if (layers.selectedGenre) setSelectedGenre(null);
          else if (layers.activePath) setActivePath(null);
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

  const isPanelOpen = Boolean(selectedArtist || genreMemberIndices);

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
        adjacency={adjacency}
        selectedNodeId={selectedArtistId}
        spotlight={spotlight}
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
          <img src="/favicon.svg" alt="" className="w-6 h-6 shrink-0" />
          <span className="hidden sm:inline-block font-extrabold text-xs sm:text-sm tracking-wider text-white whitespace-nowrap pr-1">
            MUSIC ATLAS
          </span>
        </div>

        {/* Global Search Bar (Expands on Mobile) */}
        <div className="pointer-events-auto flex-1 min-w-0 max-w-none sm:max-w-md">
          <SearchBar
            searchIndex={searchIndex}
            genreIndex={genreSearchIndex}
            onSelectArtist={handleSelectArtistAndFly}
            onSelectGenre={handleSelectGenre}
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
            onClick={handleOpenPathPanel}
            className="glass-panel h-10 w-10 flex items-center justify-center hover:bg-white/10 text-slate-400 hover:text-white transition-colors shadow-xl shrink-0"
            title="Trace a path between two artists"
          >
            <Route className="w-4 h-4" />
          </button>

          <button
            onClick={() => setShowAbout(true)}
            className="glass-panel h-10 w-10 flex items-center justify-center hover:bg-white/10 text-slate-400 hover:text-white transition-colors shadow-xl shrink-0"
            title="About Music Atlas"
          >
            <Info className="w-4 h-4" />
          </button>
        </div>

        {/* Mobile Path & Info Buttons */}
        <div className="flex sm:hidden pointer-events-auto items-center gap-2">
          <button
            onClick={handleOpenPathPanel}
            className="glass-panel h-10 w-10 flex items-center justify-center hover:bg-white/10 text-slate-400 hover:text-white transition-colors shadow-xl shrink-0"
            title="Trace a path between two artists"
          >
            <Route className="w-4 h-4" />
          </button>
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

      {/* Path panel: below the header, kept clear of the desktop inspector; on mobile below the continents pill and left of the zoom column */}
      {activePath && (
        <div className="fixed z-30 left-4 right-16 sm:right-auto sm:w-[min(560px,calc(100vw_-_2rem))] md:w-[min(560px,calc(100vw_-_21rem))] lg:w-[min(560px,calc(100vw_-_27rem))] top-[calc(max(1rem,env(safe-area-inset-top))_+_96px)] sm:top-[calc(max(1rem,env(safe-area-inset-top))_+_52px)] pointer-events-auto">
          <PathCard
            from={activePath.fromId ? nodeMap.get(activePath.fromId) ?? null : null}
            to={activePath.toId ? nodeMap.get(activePath.toId) ?? null : null}
            path={activePath.result}
            nodes={data.nodes}
            edges={data.edges}
            searchIndex={searchIndex}
            selectedArtistId={selectedArtistId}
            onChangeEnds={handleSetPathEnds}
            onSelectArtist={handleSelectArtistAndFly}
            onClose={handleClosePath}
          />
        </div>
      )}

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
              marginBottom: isPanelOpen ? '6px' : 'max(12px, env(safe-area-inset-bottom))',
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

        {/* Single Floating Inspector: the artist drawer sits on top of an open genre panel */}
        {isPanelOpen && (
          <div
            style={{
              transform: mobileDragOffset !== 0 ? `translateY(${mobileDragOffset}px)` : undefined,
              transition: isMobileDragging
                ? 'none'
                : 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)'
            }}
            className="pointer-events-auto w-full md:w-auto md:fixed md:top-[72px] md:bottom-24 md:right-4 lg:right-6 md:z-[60] flex justify-center md:justify-end"
          >
            {selectedArtist ? (
              <ArtistDrawer
                key={selectedArtist.id}
                artist={selectedArtist}
                onClose={handleCloseArtist}
                onSelectNeighbor={handleSelectArtistAndFly}
                onSelectGenre={handleSelectGenre}
                onTracePath={handleTracePath}
                isPlayingPreview={isPlayingAudio && activeAudioArtist?.id === selectedArtist.id}
                onTogglePreview={handleTogglePreview}
                currentlyPlayingId={activeAudioArtist?.id || null}
                onDragStateChange={handlePanelDragStateChange}
              />
            ) : (
              selectedGenre &&
              genreMemberIndices && (
                <GenrePanel
                  key={selectedGenre}
                  genre={selectedGenre}
                  members={genreMemberIndices}
                  nodes={data.nodes}
                  continents={data.continents}
                  genreMembers={genreMembers}
                  onClose={handleCloseGenre}
                  onSelectArtist={handleSelectArtistAndFly}
                  onSelectGenre={handleSelectGenre}
                  onFitIndices={handleFitIndices}
                  isPlayingPreview={isPlayingAudio && activeAudioArtist !== null}
                  onSamplePlay={handleSamplePlay}
                  onDragStateChange={handlePanelDragStateChange}
                />
              )
            )}
          </div>
        )}
      </div>

      {/* About Modal */}
      <AboutModal isOpen={showAbout} onClose={handleCloseAbout} />
    </div>
  );
};
