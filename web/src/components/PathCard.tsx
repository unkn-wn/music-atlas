import React, { useEffect, useState } from 'react';
import { Route, X, Link2, Check, ArrowLeftRight } from 'lucide-react';
import { AtlasNode, AtlasEdge } from '../types/atlas';
import { GraphPath } from '../utils/graphPath';
import { IndexedNode } from '../utils/searchEngine';
import { ArtistPicker } from './search/ArtistPicker';

interface PathCardProps {
  from: AtlasNode | null;
  to: AtlasNode | null;
  /** null until both ends are picked, or when the two artists aren't connected */
  path: GraphPath | null;
  nodes: AtlasNode[];
  edges: AtlasEdge[];
  searchIndex: IndexedNode[];
  selectedArtistId: string | null;
  onChangeEnds: (fromId: string | null, toId: string | null) => void;
  onSelectArtist: (artistId: string) => void;
  onClose: () => void;
}

const COPIED_FEEDBACK_MS = 1600;

function describePath(from: AtlasNode | null, to: AtlasNode | null, path: GraphPath | null): string {
  if (!from || !to) return 'Trace a path between two artists';
  if (!path) return 'No connection found';
  const degrees = path.nodes.length - 1;
  if (degrees === 0) return 'Same artist';
  return `${degrees} degree${degrees === 1 ? '' : 's'} of separation`;
}

/**
 * Degrees-of-separation panel: pick both ends, then the chain of artists, each hop labelled with
 * its shared playlists. The chain wraps on desktop and scrolls sideways on touch screens.
 */
export const PathCard: React.FC<PathCardProps> = ({
  from,
  to,
  path,
  nodes,
  edges,
  searchIndex,
  selectedArtistId,
  onChangeEnds,
  onSelectArtist,
  onClose
}) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copyLink = () => {
    // The URL already mirrors ?from=&to=
    navigator.clipboard
      ?.writeText(window.location.href)
      .then(() => setCopied(true))
      .catch(() => {});
  };

  const iconButton =
    'w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center cursor-pointer shrink-0 transition-colors disabled:opacity-40 disabled:cursor-default';

  return (
    <div className="glass-panel rounded-2xl p-3 shadow-2xl border border-white/15 flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <Route className="w-4 h-4 text-emerald-400 shrink-0" />
        <div className="min-w-0 flex-1 text-sm font-bold text-white leading-tight">
          {describePath(from, to, path)}
        </div>
        {path && (
          <button type="button" onClick={copyLink} className={iconButton} title="Copy link to this connection">
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Link2 className="w-3.5 h-3.5" />}
          </button>
        )}
        <button type="button" onClick={onClose} className={iconButton} title="Close">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* From → To */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
        <ArtistPicker
          placeholder="From artist..."
          autoFocus={!from}
          searchIndex={searchIndex}
          value={from}
          onChange={(artist) => onChangeEnds(artist?.id ?? null, to?.id ?? null)}
        />
        <button
          type="button"
          onClick={() => onChangeEnds(to?.id ?? null, from?.id ?? null)}
          disabled={!from && !to}
          className={iconButton}
          title="Swap artists"
        >
          <ArrowLeftRight className="w-3.5 h-3.5" />
        </button>
        <ArtistPicker
          placeholder="To artist..."
          autoFocus={Boolean(from) && !to}
          dropdownAlign="right"
          searchIndex={searchIndex}
          value={to}
          onChange={(artist) => onChangeEnds(from?.id ?? null, artist?.id ?? null)}
        />
      </div>

      {path && path.nodes.length > 1 && (
        <div
          className="flex items-center gap-1 overflow-x-auto pb-1 -mb-1 sm:flex-wrap sm:overflow-visible sm:gap-y-1.5"
          onWheel={(e) => e.stopPropagation()}
        >
          {path.nodes.map((idx, step) => {
            const artist = nodes[idx];
            const isSelected = artist.id === selectedArtistId;
            const shared = step > 0 ? edges[path.edges[step - 1]].playlists ?? 1 : 0;
            return (
              <React.Fragment key={artist.id}>
                {step > 0 && (
                  <div
                    className="flex flex-col items-center shrink-0 px-0.5 text-slate-500"
                    title={`${shared} playlists include both`}
                  >
                    <span className="text-[9px] tabular-nums leading-none">{shared}</span>
                    <span className="text-xs leading-none">→</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => onSelectArtist(artist.id)}
                  className={`flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full border shrink-0 cursor-pointer transition-colors ${
                    isSelected ? 'bg-white/20' : 'bg-white/5 hover:bg-white/10'
                  }`}
                  style={{ borderColor: `color-mix(in srgb, ${artist.color} 60%, transparent)` }}
                >
                  <img
                    src={artist.image}
                    alt=""
                    referrerPolicy="no-referrer"
                    crossOrigin="anonymous"
                    className="w-5 h-5 rounded-full object-cover bg-white/5"
                    onError={(e) => {
                      (e.target as HTMLElement).style.visibility = 'hidden';
                    }}
                  />
                  <span className="text-[11px] font-semibold text-white max-w-[110px] sm:max-w-[160px] truncate">
                    {artist.label}
                  </span>
                </button>
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
};
