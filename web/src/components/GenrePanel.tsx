import React, { useMemo, useState } from 'react';
import { X, Tags, Users, Globe2, Sparkles, ExternalLink } from 'lucide-react';
import { AtlasNode, Continent } from '../types/atlas';
import { SheetPanel } from './panel/SheetPanel';
import { useGenreInfo } from '../hooks/useGenreInfo';
import { filterValidSubgenres, formatSubscriberCount } from '../utils/artistUtils';
import { findRelatedGenres, formatInception } from '../utils/genreUtils';
import { resolveArtistImageUrl, DEFAULT_FALLBACK_AVATAR } from '../utils/imageUtils';

const INITIAL_ARTISTS_SHOWN = 30;
const MORE_ARTISTS_STEP = 50;
const MAX_CONTINENTS_SHOWN = 6;

interface GenrePanelProps {
  genre: string;
  /** Member node indices, most subscribers first */
  members: number[];
  nodes: AtlasNode[];
  continents: Continent[];
  genreMembers: Map<string, number[]>;
  onClose: () => void;
  onSelectArtist: (artistId: string) => void;
  onSelectGenre: (genre: string) => void;
  onFitIndices: (indices: number[]) => void;
  onDragStateChange?: (offsetY: number, isDragging: boolean) => void;
}

const SectionTitle: React.FC<{ icon: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 mb-2 tracking-wide uppercase">
    {icon}
    <span>{children}</span>
  </div>
);

export const GenrePanel: React.FC<GenrePanelProps> = ({
  genre,
  members,
  nodes,
  continents,
  genreMembers,
  onClose,
  onSelectArtist,
  onSelectGenre,
  onFitIndices,
  onDragStateChange
}) => {
  const [shownCount, setShownCount] = useState(INITIAL_ARTISTS_SHOWN);
  const info = useGenreInfo(genre);

  const continentGroups = useMemo(() => {
    const byId = new Map(continents.map((c) => [c.id, c]));
    const groups = new Map<number, number[]>();
    for (const idx of members) {
      const cId = nodes[idx].continentId;
      const list = groups.get(cId);
      if (list) list.push(idx);
      else groups.set(cId, [idx]);
    }
    return [...groups]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, MAX_CONTINENTS_SHOWN)
      .flatMap(([cId, indices]) => {
        const continent = byId.get(cId);
        return continent ? [{ continent, indices }] : [];
      });
  }, [members, nodes, continents]);

  const relatedGenres = useMemo(
    () =>
      findRelatedGenres(
        genre,
        members,
        (idx) => filterValidSubgenres(nodes[idx].topSubgenres),
        (name) => genreMembers.get(name)?.length ?? 1
      ),
    [genre, members, nodes, genreMembers]
  );

  const accentColor = nodes[members[0]]?.color || '#10b981';
  const shownMembers = members.slice(0, shownCount);

  return (
    <SheetPanel onClose={onClose} onDragStateChange={onDragStateChange}>
      {({ toggleSnap, contentRef }) => (
        <>
          {/* Header */}
          <div
            onClick={(e) => {
              e.stopPropagation();
              toggleSnap();
            }}
            style={{
              background: `linear-gradient(135deg, color-mix(in srgb, ${accentColor} 22%, transparent), transparent 70%)`
            }}
            className="px-3.5 pt-5 md:pt-4 pb-3 flex items-start gap-3 border-b border-white/10 shrink-0 select-none cursor-pointer md:cursor-default"
          >
            <div
              className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center bg-white/5 border-2"
              style={{ borderColor: accentColor }}
            >
              <Tags className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Genre</div>
              <h2 className="text-lg font-bold text-white tracking-tight leading-tight truncate">{genre}</h2>
              <div className="text-xs text-slate-400 mt-0.5">
                {members.length.toLocaleString()} artists
                {info?.since && <> · emerged {formatInception(info.since)}</>}
              </div>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="w-8 h-8 rounded-xl bg-black/40 hover:bg-black/70 border border-white/15 text-slate-300 hover:text-white transition-colors flex items-center justify-center cursor-pointer shrink-0"
              title="Close genre"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div
            ref={contentRef}
            style={{
              touchAction: 'pan-y',
              overscrollBehaviorY: 'contain',
              WebkitOverflowScrolling: 'touch',
              paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0.75rem))'
            }}
            className="flex-1 overflow-y-auto p-3 sm:p-4 flex flex-col gap-4"
          >
            {/* Wikidata description */}
            {info?.desc && (
              <div className="text-xs text-slate-300 leading-relaxed">
                <p className="first-letter:uppercase">{info.desc}</p>
                {/* Source credit doubles as the link: the Wikipedia article, else the Wikidata item */}
                <a
                  href={info.wiki ?? `https://www.wikidata.org/wiki/${info.wd}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-[10px] text-slate-500 hover:text-slate-400 underline mt-1 transition-colors"
                >
                  From Wikidata
                </a>
              </div>
            )}

            {/* Continents the genre's artists live in */}
            {continentGroups.length > 0 && (
              <div>
                <SectionTitle icon={<Globe2 className="w-3.5 h-3.5" style={{ color: accentColor }} />}>
                  Found in
                </SectionTitle>
                <div className="flex flex-wrap gap-1.5">
                  {continentGroups.map(({ continent, indices }) => (
                    <button
                      key={continent.id}
                      type="button"
                      onClick={() => onFitIndices(indices)}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] text-slate-200 cursor-pointer transition-colors max-w-full"
                      title={`Show the ${indices.length} ${genre} artists in ${continent.name}`}
                    >
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: continent.color }} />
                      <span className="truncate">{continent.name}</span>
                      <span className="text-slate-500 tabular-nums">{indices.length}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Related genres by shared artists */}
            {relatedGenres.length > 0 && (
              <div>
                <SectionTitle icon={<Sparkles className="w-3.5 h-3.5" style={{ color: accentColor }} />}>
                  Related genres
                </SectionTitle>
                <div className="flex flex-wrap gap-1.5">
                  {relatedGenres.map((related) => (
                    <button
                      key={related.name}
                      type="button"
                      onClick={() => onSelectGenre(related.name)}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] text-slate-200 cursor-pointer transition-colors"
                      title={`${related.sharedArtists} artists tagged with both`}
                    >
                      <span>{related.name}</span>
                      <span className="text-slate-500 tabular-nums">{related.sharedArtists}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Artists by popularity */}
            <div>
              <SectionTitle icon={<Users className="w-3.5 h-3.5" style={{ color: accentColor }} />}>
                Top artists
              </SectionTitle>
              <div className="flex flex-col gap-1">
                {shownMembers.map((idx, rank) => {
                  const artist = nodes[idx];
                  return (
                    <button
                      key={artist.id}
                      type="button"
                      onClick={() => onSelectArtist(artist.id)}
                      className="w-full flex items-center gap-2.5 p-1.5 rounded-lg hover:bg-white/10 text-left cursor-pointer transition-colors"
                    >
                      <span className="w-6 text-right text-[11px] text-slate-500 tabular-nums shrink-0">
                        {rank + 1}
                      </span>
                      <img
                        src={resolveArtistImageUrl(artist.image) || DEFAULT_FALLBACK_AVATAR}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        crossOrigin="anonymous"
                        className="w-7 h-7 rounded-full object-cover shrink-0 bg-white/5 border"
                        style={{ borderColor: artist.color }}
                        onError={(e) => {
                          (e.target as HTMLElement).style.visibility = 'hidden';
                        }}
                      />
                      <span className="flex-1 min-w-0 truncate text-xs font-semibold text-white">
                        {artist.label}
                      </span>
                      <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">
                        {formatSubscriberCount(artist.subscribers)}
                      </span>
                    </button>
                  );
                })}
              </div>
              {shownCount < members.length && (
                <button
                  type="button"
                  onClick={() => setShownCount((n) => n + MORE_ARTISTS_STEP)}
                  className="mt-2 w-full py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-300 cursor-pointer transition-colors"
                >
                  Show more ({(members.length - shownCount).toLocaleString()} left)
                </button>
              )}
            </div>

            {info?.wiki && !info.desc && (
              <a
                href={info.wiki}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 underline"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Read about {genre} on Wikipedia
              </a>
            )}
          </div>
        </>
      )}
    </SheetPanel>
  );
};
