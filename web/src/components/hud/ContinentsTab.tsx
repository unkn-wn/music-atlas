import React, { useState, useMemo } from 'react';
import { Search, X, ArrowUpDown } from 'lucide-react';
import { Continent } from '../../types/atlas';

interface ContinentsTabProps {
  continents: Continent[];
  selectedContinentId: number | null;
  onSelectContinent: (id: number | null) => void;
  onClosePopover: () => void;
}

export const ContinentsTab: React.FC<ContinentsTabProps> = ({
  continents,
  selectedContinentId,
  onSelectContinent,
  onClosePopover
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'count' | 'name'>('count');

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

  return (
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
              onClosePopover();
            }}
            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium text-left cursor-pointer ${
              selectedContinentId === null
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'hover:bg-white/10 text-slate-300'
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
                  onClosePopover();
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
  );
};
