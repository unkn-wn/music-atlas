import React, { useState, useRef, useEffect } from 'react';
import { Layers, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { Continent } from '../types/atlas';
import { ContinentsTab } from './hud/ContinentsTab';
import { FiltersTab } from './hud/FiltersTab';
import { formatControlHudLabel } from './hud/hudUtils';

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
  const isFiltered =
    selectedContinentId !== null || densityRange !== null || connectionPercentile > 0;
  const buttonLabel = formatControlHudLabel(activeContinent, densityRange, connectionPercentile);

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
        title={isFiltered ? buttonLabel : 'Filter by continent, popularity, or connections'}
      >
        {densityRange !== null || connectionPercentile > 0 ? (
          <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        ) : (
          <Layers className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        )}
        <span className="max-w-[130px] sm:max-w-[360px] truncate">{buttonLabel}</span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-slate-400 ml-0.5 transition-transform ${
            showDropdown ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Popover Dropdown */}
      {showDropdown && (
        <div
          onWheel={(e) => e.stopPropagation()}
          className={`absolute ${
            align === 'left' ? 'left-0' : 'right-0'
          } top-full mt-2 glass-panel p-3 shadow-2xl z-50 border border-white/20 flex flex-col`}
          style={{
            width: 'min(480px, calc(100vw - 2rem))',
            maxHeight: 'min(460px, calc(100vh - 100px))'
          }}
        >
          {/* Segmented Tab Control */}
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
            <ContinentsTab
              continents={continents}
              selectedContinentId={selectedContinentId}
              onSelectContinent={onSelectContinent}
              onClosePopover={closePopover}
            />
          )}

          {/* Tab 2: Filters (Popularity & Connections) */}
          {activeTab === 'density' && (
            <FiltersTab
              densityRange={densityRange}
              onSelectDensityRange={onSelectDensityRange}
              connectionPercentile={connectionPercentile}
              onSelectConnectionPercentile={onSelectConnectionPercentile}
            />
          )}
        </div>
      )}
    </div>
  );
};
