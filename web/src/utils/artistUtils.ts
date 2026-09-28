import { AtlasNode, ArtistDetail } from '../types/atlas';

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
