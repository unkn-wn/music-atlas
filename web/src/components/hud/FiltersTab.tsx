import React, { useRef, useEffect, useCallback } from 'react';

interface FiltersTabProps {
  densityRange: [number, number] | null;
  onSelectDensityRange: (range: [number, number] | null) => void;
  connectionPercentile: number;
  onSelectConnectionPercentile?: (val: number) => void;
}

export const FiltersTab: React.FC<FiltersTabProps> = ({
  densityRange,
  onSelectDensityRange,
  connectionPercentile,
  onSelectConnectionPercentile
}) => {
  const minPercent = densityRange ? densityRange[0] : 0;
  const maxPercent = densityRange ? densityRange[1] : 100;

  const sliderRafRef = useRef<number | null>(null);
  const connectionRafRef = useRef<number | null>(null);

  const scheduleRangeUpdate = useCallback(
    (range: [number, number] | null) => {
      if (sliderRafRef.current !== null) {
        cancelAnimationFrame(sliderRafRef.current);
      }
      sliderRafRef.current = requestAnimationFrame(() => {
        sliderRafRef.current = null;
        onSelectDensityRange(range);
      });
    },
    [onSelectDensityRange]
  );

  const scheduleConnectionUpdate = useCallback(
    (percentile: number) => {
      if (connectionRafRef.current !== null) {
        cancelAnimationFrame(connectionRafRef.current);
      }
      connectionRafRef.current = requestAnimationFrame(() => {
        connectionRafRef.current = null;
        onSelectConnectionPercentile?.(percentile);
      });
    },
    [onSelectConnectionPercentile]
  );

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
  );
};
