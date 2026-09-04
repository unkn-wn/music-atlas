import React, { useState, useRef, useEffect } from 'react';
import { Sliders, Layers, Activity, ChevronDown, X } from 'lucide-react';
import { Continent } from '../types/atlas';

interface ControlHUDProps {
  threshold: number;
  onThresholdChange: (val: number) => void;
  continents: Continent[];
  selectedContinentId: number | null;
  onSelectContinent: (id: number | null) => void;
  sizeMode: 'popularity' | 'degree';
  onToggleSizeMode: () => void;
  visibleEdgeCount: number;
  totalEdgeCount: number;
}

export const ControlHUD: React.FC<ControlHUDProps> = ({
  threshold,
  onThresholdChange,
  continents,
  selectedContinentId,
  onSelectContinent,
  sizeMode,
  onToggleSizeMode,
  visibleEdgeCount,
  totalEdgeCount
}) => {
  const [showContinents, setShowContinents] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowContinents(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const activeContinent = continents.find((c) => c.id === selectedContinentId);

  return (
    <div className="relative pointer-events-auto flex items-center gap-2.5" ref={popoverRef}>
      {/* Compact Threshold Slider Pill */}
      <div className="glass-panel px-3.5 py-2 flex items-center gap-3 shadow-xl">
        <div className="flex items-center gap-1.5 text-xs text-slate-300 font-medium shrink-0">
          <Sliders className="w-3.5 h-3.5 text-cyan-400" />
          <span className="hidden sm:inline">Lines:</span>
          <span className="font-mono text-cyan-400 font-bold bg-cyan-950/40 px-1.5 py-0.5 rounded border border-cyan-800/50 text-[11px]">
            {threshold.toFixed(2)}
          </span>
        </div>

        <input
          type="range"
          min="0.0"
          max="0.80"
          step="0.01"
          value={threshold}
          onChange={(e) => onThresholdChange(parseFloat(e.target.value))}
          className="w-20 sm:w-28 cursor-pointer"
          title={`Filter threshold (${visibleEdgeCount} / ${totalEdgeCount} visible lines)`}
        />
      </div>

      {/* Sizing Toggle Pill */}
      <button
        onClick={onToggleSizeMode}
        className="glass-panel px-3 py-2 flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white hover:bg-white/10 transition-colors shadow-xl shrink-0"
        title="Toggle node circle size metric"
      >
        <Activity className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        <span className="hidden md:inline">Size:</span>
        <strong className="text-white capitalize">{sizeMode === 'popularity' ? 'Pop' : 'Degree'}</strong>
      </button>

      {/* Continents Filter Button */}
      <button
        onClick={() => setShowContinents(!showContinents)}
        className={`glass-panel px-3 py-2 flex items-center gap-1.5 text-xs font-medium transition-all shadow-xl shrink-0 ${
          selectedContinentId !== null
            ? 'border-emerald-500/50 text-emerald-300 bg-emerald-500/10'
            : 'text-slate-300 hover:text-white hover:bg-white/10'
        }`}
        title="Filter by continent / musical genre"
      >
        <Layers className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        <span className="max-w-[100px] truncate">
          {activeContinent ? activeContinent.name.split('/')[0].trim() : 'Continents'}
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-0.5" />
      </button>

      {/* Continents Popover Dropdown */}
      {showContinents && (
        <div className="absolute right-0 top-full mt-2 w-72 glass-panel p-3 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150 border border-white/20">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/10 text-xs font-semibold text-white">
            <span className="flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-emerald-400" />
              Continents & Communities
            </span>
            {selectedContinentId !== null && (
              <button
                onClick={() => {
                  onSelectContinent(null);
                  setShowContinents(false);
                }}
                className="text-[11px] text-emerald-400 hover:text-emerald-300 underline"
              >
                Reset
              </button>
            )}
          </div>

          <div className="flex flex-col gap-1 max-h-64 overflow-y-auto pr-1">
            <button
              onClick={() => {
                onSelectContinent(null);
                setShowContinents(false);
              }}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium text-left transition-colors ${
                selectedContinentId === null ? 'bg-emerald-500/20 text-emerald-300' : 'hover:bg-white/10 text-slate-300'
              }`}
            >
              <span>All Continents</span>
              <span className="font-mono text-[10px] text-slate-400">({continents.reduce((acc, c) => acc + c.artistCount, 0)})</span>
            </button>

            {continents.map((c) => {
              const isSelected = selectedContinentId === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => {
                    onSelectContinent(isSelected ? null : c.id);
                    setShowContinents(false);
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium text-left transition-colors ${
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
                  <span className="font-mono text-[10px] text-slate-400 shrink-0 ml-2">
                    {c.artistCount}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
