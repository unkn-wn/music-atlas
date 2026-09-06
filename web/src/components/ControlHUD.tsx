import React, { useState, useRef, useEffect } from 'react';
import { Layers, ChevronDown } from 'lucide-react';
import { Continent } from '../types/atlas';

interface ControlHUDProps {
  continents: Continent[];
  selectedContinentId: number | null;
  onSelectContinent: (id: number | null) => void;
}

export const ControlHUD: React.FC<ControlHUDProps> = ({
  continents,
  selectedContinentId,
  onSelectContinent
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
        <span className="max-w-[110px] truncate">
          {activeContinent ? activeContinent.name : 'Continents'}
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
