import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Layers, ChevronDown, Search, X, ArrowUpDown, SlidersHorizontal } from 'lucide-react';
import { Continent } from '../types/atlas';

interface ControlHUDProps {
  continents: Continent[];
  selectedContinentId: number | null;
  onSelectContinent: (id: number | null) => void;
  densityRange: [number, number] | null;
  onSelectDensityRange: (range: [number, number] | null) => void;
  connectionPercentile?: number;
  onSelectConnectionPercentile?: (val: number) => void;
  align?: 'left' | 'right';
}

export const ControlHUD: React.FC<ControlHUDProps> = ({
  continents,
  selectedContinentId,
  onSelectContinent,
  densityRange,
  onSelectDensityRange,
  connectionPercentile = 0,
  onSelectConnectionPercentile,
  align = 'right'
}) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeTab, setActiveTab] = useState<'continents' | 'density'>('continents');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'count' | 'name'>('count');
  const popoverRef = useRef<HTMLDivElement>(null);

  const closePopover = () => {
    setShowDropdown(false);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        closePopover();
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, []);

  const activeContinent = continents.find((c) => c.id === selectedContinentId);
  const isFiltered = selectedContinentId !== null || densityRange !== null || connectionPercentile > 0;

  const minPercent = densityRange ? densityRange[0] : 0;
  const maxPercent = densityRange ? densityRange[1] : 100;

  const getButtonLabel = () => {
    let rankStr: string | null = null;
    if (densityRange !== null) {
      const [minP, maxP] = densityRange;
      if (minP <= 0 && maxP >= 100) {
        rankStr = null;
      } else if (minP <= 0) {
        rankStr = `Top ${maxP}%`;
      } else if (maxP >= 100) {
        rankStr = `Top ${minP}%–100%`;
      } else {
        rankStr = `${minP}%–${maxP}%`;
      }
    }

    let connStr: string | null = null;
    if (connectionPercentile > 0) {
      connStr = `Connections: Top ${100 - connectionPercentile}%`;
    }

    const parts: string[] = [];
    if (activeContinent) parts.push(activeContinent.name);
    if (rankStr) parts.push(rankStr);
    if (connStr) parts.push(connStr);

    return parts.length > 0 ? parts.join(' · ') : 'Filters';
  };

  // Filter & sort continents
  const filteredContinents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = q ? continents.filter((c) => c.name.toLowerCase().includes(q)) : [...continents];
    return list.sort((a, b) => {
      if (sortBy === 'count') {
        return b.artistCount - a.artistCount;
      }
      return a.name.localeCompare(b.name);
    });
  }, [continents, searchQuery, sortBy]);

  const sliderRafRef = useRef<number | null>(null);
  const connectionRafRef = useRef<number | null>(null);

  const scheduleRangeUpdate = useCallback((range: [number, number] | null) => {
    if (sliderRafRef.current !== null) {
      cancelAnimationFrame(sliderRafRef.current);
    }
    sliderRafRef.current = requestAnimationFrame(() => {
      sliderRafRef.current = null;
      onSelectDensityRange(range);
    });
  }, [onSelectDensityRange]);

  const scheduleConnectionUpdate = useCallback((percentile: number) => {
    if (connectionRafRef.current !== null) {
      cancelAnimationFrame(connectionRafRef.current);
    }
    connectionRafRef.current = requestAnimationFrame(() => {
      connectionRafRef.current = null;
      onSelectConnectionPercentile?.(percentile);
    });
  }, [onSelectConnectionPercentile]);

  useEffect(() => {
    return () => {
      if (sliderRafRef.current !== null) {
        cancelAnimationFrame(sliderRafRef.current);
      }
      if (connectionRafRef.current !== null) {
        cancelAnimationFrame(connectionRafRef.current);
      }
    };
  }, []);

  const handleMinSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newMin = parseInt(e.target.value, 10);
    const clampedMin = Math.min(newMin, maxPercent - 1);

    if (clampedMin <= 0 && maxPercent >= 100) {
      scheduleRangeUpdate(null);
    } else {
      scheduleRangeUpdate([clampedMin, maxPercent]);
    }
  };

  const handleMaxSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newMax = parseInt(e.target.value, 10);
    const clampedMax = Math.max(newMax, minPercent + 1);

    if (minPercent <= 0 && clampedMax >= 100) {
      scheduleRangeUpdate(null);
    } else {
      scheduleRangeUpdate([minPercent, clampedMax]);
    }
  };

  const handleConnectionSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    scheduleConnectionUpdate(val);
  };

  return (
    <div className="relative pointer-events-auto flex items-center gap-2.5" ref={popoverRef}>
      {/* Unified Filter Button */}
      <button
        onClick={() => {
          if (showDropdown) {
            closePopover();
          } else {
            setShowDropdown(true);
          }
        }}
        className={`glass-panel h-10 px-3.5 flex items-center gap-2 text-xs font-medium transition-all shadow-xl shrink-0 cursor-pointer ${
          isFiltered
            ? 'border-emerald-500/50 text-emerald-300 bg-emerald-500/10'
            : 'text-slate-300 hover:text-white hover:bg-white/10'
        }`}
        title={isFiltered ? getButtonLabel() : 'Filter by continent, popularity, or connections'}
      >
        {densityRange !== null || connectionPercentile > 0 ? (
          <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        ) : (
          <Layers className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        )}
        <span className="max-w-[130px] sm:max-w-[360px] truncate">
          {getButtonLabel()}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 ml-0.5 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
      </button>

      {/* Popover Dropdown */}
      {showDropdown && (
        <div
          onWheel={(e) => e.stopPropagation()}
          className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} top-full mt-2 glass-panel p-3 shadow-2xl z-50 border border-white/20 flex flex-col`}
          style={{ width: 'min(480px, calc(100vw - 2rem))', maxHeight: 'min(460px, calc(100vh - 100px))' }}
        >
          {/* Segmented Tab Control (No transform or size increase on active) */}
          <div className="flex rounded-lg bg-white/5 p-1 mb-2.5 border border-white/10 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('continents')}
              className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === 'continents'
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Continents</span>
              {selectedContinentId !== null && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 ml-0.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('density')}
              className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === 'density'
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Filters</span>
              {(densityRange !== null || connectionPercentile > 0) && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 ml-0.5" />
              )}
            </button>
          </div>

          {/* Tab 1: Continents & Communities */}
          {activeTab === 'continents' && (
            <>
              {/* Search & Sort Bar */}
              <div className="flex items-center gap-2 mb-2">
                <div className="relative flex-1 flex items-center h-8 gap-2 bg-white/5 border border-white/10 rounded-lg px-2.5 focus-within:border-emerald-500/50">
                  <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter continents..."
                    style={{ color: '#f8fafc' }}
                    className="w-full bg-transparent border-none outline-none text-base sm:text-xs placeholder-slate-500"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="text-slate-400 hover:text-white p-0.5 bg-transparent border-none cursor-pointer shrink-0 flex items-center justify-center"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Sort Toggle */}
                <button
                  type="button"
                  onClick={() => setSortBy(sortBy === 'count' ? 'name' : 'count')}
                  className="h-8 flex items-center gap-1 px-2.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 text-[11px] text-slate-300 cursor-pointer shrink-0"
                  title={`Sort by ${sortBy === 'count' ? 'Name (A-Z)' : 'Size (Most artists)'}`}
                >
                  <ArrowUpDown className="w-3 h-3 text-slate-400" />
                  <span>{sortBy === 'count' ? 'By Size' : 'A-Z'}</span>
                </button>
              </div>

              {/* Scrollable Continent List */}
              <div className="flex flex-col gap-1 overflow-y-auto pr-1 flex-1">
                {!searchQuery && (
                  <button
                    onClick={() => {
                      onSelectContinent(null);
                      closePopover();
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium text-left cursor-pointer ${
                      selectedContinentId === null ? 'bg-emerald-500/20 text-emerald-300' : 'hover:bg-white/10 text-slate-300'
                    }`}
                  >
                    <span>All Continents</span>
                    <span className="text-[10px] text-slate-400">
                      ({continents.reduce((acc, c) => acc + c.artistCount, 0).toLocaleString()})
                    </span>
                  </button>
                )}

                {filteredContinents.length === 0 ? (
                  <div className="py-4 text-center text-xs text-slate-500">
                    No continents matching "{searchQuery}"
                  </div>
                ) : (
                  filteredContinents.map((c) => {
                    const isSelected = selectedContinentId === c.id;
                    return (
                      <button
                        key={c.id}
                        onClick={() => {
                          onSelectContinent(isSelected ? null : c.id);
                          closePopover();
                        }}
                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium text-left cursor-pointer ${
                          isSelected ? 'bg-white/20 text-white' : 'hover:bg-white/10 text-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: c.color }}
                          />
                          <span className="truncate">{c.name}</span>
                        </div>
                        <span className="text-[10px] text-slate-400 shrink-0 ml-2">
                          {c.artistCount.toLocaleString()}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}

          {/* Tab 2: Filters (Popularity & Connections) */}
          {activeTab === 'density' && (
            <div className="flex flex-col py-2 px-1 gap-4">
              {/* Slider 1: Artist Popularity */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-medium">Artist Popularity</span>
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400 font-medium">
                      {densityRange === null || (minPercent <= 0 && maxPercent >= 100)
                        ? 'All Artists'
                        : minPercent <= 0
                        ? `Top ${maxPercent}%`
                        : maxPercent >= 100
                        ? `Top ${minPercent}% – 100%`
                        : `${minPercent}% – ${maxPercent}%`}
                    </span>
                    {densityRange !== null && (
                      <button
                        type="button"
                        onClick={() => onSelectDensityRange(null)}
                        className="text-[11px] text-slate-400 hover:text-white underline cursor-pointer bg-transparent border-none p-0"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>

                {/* Dual Slider Track Container */}
                <div className="relative flex items-center h-6 select-none touch-none">
                  {/* Background Track */}
                  <div className="absolute w-full h-1.5 bg-white/10 rounded-full" />

                  {/* Active Highlighted Track Segment */}
                  <div
                    className="absolute h-1.5 bg-emerald-500 rounded-full pointer-events-none"
                    style={{
                      left: `${minPercent}%`,
                      width: `${Math.max(0, maxPercent - minPercent)}%`
                    }}
                  />

                  {/* Min Thumb Input */}
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={minPercent}
                    onChange={handleMinSliderChange}
                    className="range-slider-input absolute w-full pointer-events-none appearance-none bg-transparent h-1.5 outline-none"
                    style={{ zIndex: minPercent > 70 ? 5 : 3 }}
                    aria-label="Minimum popularity percentage"
                  />

                  {/* Max Thumb Input */}
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={maxPercent}
                    onChange={handleMaxSliderChange}
                    className="range-slider-input absolute w-full pointer-events-none appearance-none bg-transparent h-1.5 outline-none"
                    style={{ zIndex: 4 }}
                    aria-label="Maximum popularity percentage"
                  />
                </div>
              </div>

              {/* Divider */}
              <div className="w-full h-px bg-white/10" />

              {/* Slider 2: Connection Strength */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-300 font-medium">Connection Strength</span>
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400 font-medium">
                      {connectionPercentile <= 0
                        ? 'All Connections'
                        : `Top ${100 - connectionPercentile}%`}
                    </span>
                    {connectionPercentile > 0 && (
                      <button
                        type="button"
                        onClick={() => onSelectConnectionPercentile?.(0)}
                        className="text-[11px] text-slate-400 hover:text-white underline cursor-pointer bg-transparent border-none p-0"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>

                {/* Single Slider Track Container */}
                <div className="relative flex items-center h-6 select-none touch-none">
                  {/* Background Track */}
                  <div className="absolute w-full h-1.5 bg-white/10 rounded-full" />

                  {/* Active Highlighted Track Segment */}
                  <div
                    className="absolute h-1.5 bg-emerald-500 rounded-full pointer-events-none"
                    style={{
                      left: 0,
                      width: `${connectionPercentile}%`
                    }}
                  />

                  {/* Connection Strength Thumb Input */}
                  <input
                    type="range"
                    min={0}
                    max={99}
                    step={1}
                    value={connectionPercentile}
                    onChange={handleConnectionSliderChange}
                    className="range-slider-input absolute w-full pointer-events-auto appearance-none bg-transparent h-1.5 outline-none cursor-pointer"
                    style={{ zIndex: 4 }}
                    aria-label="Minimum connection strength percentage"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
