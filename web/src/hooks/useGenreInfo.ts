import { useEffect, useState } from 'react';
import { GenreInfo } from '../utils/genreUtils';

type GenreInfoMap = Record<string, GenreInfo>;

// Fetched once per session, on the first genre panel open
let genreInfoPromise: Promise<GenreInfoMap> | null = null;

function loadGenreInfo(): Promise<GenreInfoMap> {
  genreInfoPromise ??= fetch('/data/genre-info.json')
    .then((res) => (res.ok ? res.json() : {}))
    .catch((err) => {
      console.warn('Could not load genre enrichment:', err);
      // Let a later genre open retry
      genreInfoPromise = null;
      return {};
    });
  return genreInfoPromise;
}

/** Wikidata enrichment for one genre: undefined while loading or when the genre has no exact match. */
export function useGenreInfo(genre: string): GenreInfo | undefined {
  const [infoMap, setInfoMap] = useState<GenreInfoMap | null>(null);

  useEffect(() => {
    let isMounted = true;
    loadGenreInfo().then((map) => {
      if (isMounted) setInfoMap(map);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  return infoMap && Object.prototype.hasOwnProperty.call(infoMap, genre) ? infoMap[genre] : undefined;
}
