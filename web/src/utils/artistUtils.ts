import { AtlasNode, ArtistDetail } from '../types/atlas';
import { slugify } from './genreUtils';

/** Artists found in at least this many playlists get a static /artist/<slug>/ page (the app and site plugin check it via hasArtistPage) */
const ARTIST_PAGE_MIN_PLAYLISTS = 30;

const INVALID_GENRE_NAMES = new Set(['other', 'artist', 'unknown', 'eclectic']);

/**
 * Filters out system and non-descriptive subgenre tags.
 */
export function filterValidSubgenres(subgenres: string[] | undefined): string[] {
  if (!subgenres || !Array.isArray(subgenres)) return [];
  return subgenres.filter(
    (g) => g && !INVALID_GENRE_NAMES.has(g.trim().toLowerCase())
  );
}

/**
 * Formats subscriber / listener count into a compact human-readable string (e.g., 2.4M, 150K).
 */
export function formatSubscriberCount(
  subscribers: number | undefined,
  formatted?: string
): string {
  if (formatted) return formatted;
  const subs = subscribers ?? 0;
  if (subs >= 1_000_000) return `${(subs / 1_000_000).toFixed(1)}M`;
  if (subs >= 1_000) return `${(subs / 1_000).toFixed(1)}K`;
  return subs.toLocaleString();
}

/**
 * Hydrates an AtlasNode with continent details, resolving crossover neighbor names, images,
 * and generating fallback Spotify URLs.
 */
export function hydrateArtistDetails(
  base: AtlasNode | null,
  details: ArtistDetail | undefined,
  nodeMap: Map<string, AtlasNode>
): AtlasNode | null {
  if (!base) return null;
  const defaultSpotifyUrl = `https://open.spotify.com/search/${encodeURIComponent(base.label || '')}`;

  if (!details) {
    return {
      ...base,
      spotifyUrl: defaultSpotifyUrl
    };
  }

  const resolvedCrossovers = details.topCrossovers?.map((c) => ({
    ...c,
    neighborName: nodeMap.get(c.neighborId)?.label || c.neighborName || c.neighborId,
    image: nodeMap.get(c.neighborId)?.image || c.image || ''
  }));

  return {
    ...base,
    ...details,
    topCrossovers: resolvedCrossovers,
    spotifyUrl: details.spotifyUrl || defaultSpotifyUrl
  };
}

/**
 * Parses raw continent detail JSON into normalized ArtistDetail records.
 */
export function parseContinentDetails(
  rawChunk: Record<string, any>
): Record<string, ArtistDetail> {
  const chunk: Record<string, ArtistDetail> = {};

  for (const [artistId, detail] of Object.entries(rawChunk)) {
    chunk[artistId] = {
      ...detail,
      topCrossovers: Array.isArray(detail.topCrossovers)
        ? detail.topCrossovers.map((c: any) => {
            if (Array.isArray(c)) {
              return {
                neighborId: c[0],
                overlapPercent: c[1],
                sharedPlaylists: c[2],
                selfPercent: c[3],
                neighborPercent: c[4]
              };
            }
            return c;
          })
        : []
    };
  }

  return chunk;
}

export function hasArtistPage(totalPlaylists: number | undefined): boolean {
  return (totalPlaylists ?? 0) >= ARTIST_PAGE_MIN_PLAYLISTS;
}

/**
 * Name slugs shared by more than one artist. Computed over every artist (not only those with pages), so a
 * page's URL doesn't change when another artist's page appears or disappears.
 */
export function findDuplicateArtistSlugs(nodes: Pick<AtlasNode, 'label'>[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const node of nodes) {
    const slug = slugify(node.label);
    if (seen.has(slug)) duplicates.add(slug);
    else seen.add(slug);
  }
  return duplicates;
}

/** "/artist/ed-sheeran/"; shared or empty (non-Latin) name slugs get the Deezer id: "/artist/aurora-12345/", "/artist/12345/" */
export function artistPagePath(node: Pick<AtlasNode, 'id' | 'label'>, duplicateSlugs: Set<string>): string {
  const slug = slugify(node.label);
  const id = node.id.replace(/^dz_/, '');
  return `/artist/${!slug ? id : duplicateSlugs.has(slug) ? `${slug}-${id}` : slug}/`;
}
