// Shared by the app and the static-page Vite plugin (scripts/site/): keep it free of browser APIs.
import { normalizeSearchText } from './searchEngine';
import { Continent } from '../types/atlas';

export interface GenreInception {
  year: number;
  /** Wikidata time precision: 7 = century, 8 = decade, 9 = year, 10+ = month/day */
  precision: number;
}

/** One genre's Wikidata enrichment (pipeline stage 7, genre-info.json) */
export interface GenreInfo {
  wd: string;
  desc?: string;
  since?: GenreInception;
  wiki?: string;
}

export interface RelatedGenre {
  name: string;
  sharedArtists: number;
}

const MAX_RELATED_GENRES = 8;

/** Genres with at least this many artists get a static /genres/<slug>/ page (the app and site plugin check it via hasGenrePage) */
const GENRE_PAGE_MIN_ARTISTS = 5;

export interface ContinentGroup<T> {
  continent: Continent;
  members: T[];
}

/** URL slug for a genre ("R&B" -> "r-b"); empty when the name has no Latin letters or digits. */
export function slugify(name: string): string {
  return normalizeSearchText(name)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Genres sharing the most artists with `genre`, scored by Ochiai overlap (shared / sqrt(|A|·|B|)) so the
 * biggest genres don't top every list. `subgenresOf` returns a member's genre tags.
 */
export function findRelatedGenres<T>(
  genre: string,
  members: T[],
  subgenresOf: (member: T) => string[],
  genreSize: (name: string) => number
): RelatedGenre[] {
  const shared = new Map<string, number>();
  for (const member of members) {
    for (const other of subgenresOf(member)) {
      if (other !== genre) shared.set(other, (shared.get(other) ?? 0) + 1);
    }
  }
  return [...shared]
    .filter(([, count]) => count >= 2)
    .map(([name, count]) => ({ name, count, score: count / Math.sqrt(members.length * genreSize(name)) }))
    .sort((a, b) => b.score - a.score || b.count - a.count)
    .slice(0, MAX_RELATED_GENRES)
    .map(({ name, count }) => ({ name, sharedArtists: count }));
}

export function hasGenrePage(artistCount: number): boolean {
  return artistCount >= GENRE_PAGE_MIN_ARTISTS;
}

/** A genre's members grouped by the continent they live in, largest group first */
export function groupByContinent<T>(
  members: T[],
  continents: Continent[],
  continentIdOf: (member: T) => number
): ContinentGroup<T>[] {
  const byId = new Map(continents.map((c) => [c.id, c]));
  const groups = new Map<number, T[]>();
  for (const member of members) {
    const cId = continentIdOf(member);
    const list = groups.get(cId);
    if (list) list.push(member);
    else groups.set(cId, [member]);
  }
  return [...groups]
    .sort((a, b) => b[1].length - a[1].length)
    .flatMap(([cId, list]) => {
      const continent = byId.get(cId);
      return continent ? [{ continent, members: list }] : [];
    });
}

/** "1965", "1960s", "9th century", "1999 BCE" (Wikidata has no year 0: -1999 is 1999 BCE) */
export function formatInception({ year, precision }: GenreInception): string {
  const era = year < 0 ? ' BCE' : '';
  const y = Math.abs(year);
  if (precision >= 9) return `${y}${era}`;
  if (precision === 8) return `${Math.floor(y / 10) * 10}s${era}`;
  const century = Math.ceil(y / 100);
  const suffix = century % 100 >= 11 && century % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][century % 10] ?? 'th';
  return `${century}${suffix} century${era}`;
}
