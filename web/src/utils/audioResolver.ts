/**
 * Client-Side On-Demand Deezer Audio Preview Resolver
 * 
 * Resolves fresh 30-second audio previews directly from Deezer API via JSONP.
 * Bypasses CORS completely and avoids expired CDN tokens by fetching
 * a freshly signed URL (with 15-min TTL) right when the user requests playback.
 */

export interface DeezerPreviewResult {
  previewUrl: string;
  trackTitle?: string;
}

// In-memory cache for resolved preview URLs during the browser session
// Deezer tokens have a 15-minute expiration; we cache for 12 minutes to stay safely within window.
const previewCache = new Map<string, { previewUrl: string; trackTitle?: string; expiresAt: number }>();

let callbackSeq = 0;

function jsonpRequest(url: string, timeoutMs: number = 6000): Promise<any> {
  return new Promise((resolve, reject) => {
    callbackSeq = (callbackSeq + 1) % 1000000;
    const callbackName = `__dz_cb_${Date.now()}_${callbackSeq}`;
    const script = document.createElement('script');
    let finished = false;

    const cleanup = () => {
      finished = true;
      clearTimeout(timer);
      try {
        delete (window as any)[callbackName];
      } catch {
        (window as any)[callbackName] = undefined;
      }
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };

    const timer = setTimeout(() => {
      if (!finished) {
        cleanup();
        reject(new Error('Deezer JSONP request timed out'));
      }
    }, timeoutMs);

    (window as any)[callbackName] = (data: any) => {
      if (finished) return;
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      if (!finished) {
        cleanup();
        reject(new Error('Deezer JSONP script load error'));
      }
    };

    const separator = url.includes('?') ? '&' : '?';
    script.src = `${url}${separator}output=jsonp&callback=${callbackName}`;
    document.head.appendChild(script);
  });
}

/**
 * Resolves a fresh, playable 30s preview URL for any artist node.
 */
export async function resolveArtistPreview(
  artistId: string,
  artistName: string,
  topTrack?: string
): Promise<DeezerPreviewResult | null> {
  const cacheKey = artistId || artistName.toLowerCase().trim();
  const cached = previewCache.get(cacheKey);

  // Return valid cached token if within 12-minute window
  if (cached && Date.now() < cached.expiresAt) {
    return { previewUrl: cached.previewUrl, trackTitle: cached.trackTitle };
  }

  // 1. Primary approach: If node has a Deezer ID (dz_<id>), fetch artist's top tracks
  if (artistId.startsWith('dz_')) {
    const dzId = artistId.replace('dz_', '');
    try {
      const resp = await jsonpRequest(`https://api.deezer.com/artist/${dzId}/top?limit=3`);
      const items = resp?.data;
      if (Array.isArray(items)) {
        for (const track of items) {
          if (track?.preview) {
            const result: DeezerPreviewResult = {
              previewUrl: track.preview,
              trackTitle: track.title || topTrack
            };
            previewCache.set(cacheKey, {
              ...result,
              expiresAt: Date.now() + 12 * 60 * 1000
            });
            return result;
          }
        }
      }
    } catch {
      // Fall through to search query fallback
    }
  }

  // 2. Search fallback: Query Deezer catalog by artist name and/or topTrack
  try {
    const query = topTrack && topTrack !== artistName
      ? `${artistName} ${topTrack}`
      : artistName;
    const resp = await jsonpRequest(`https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=3`);
    const items = resp?.data;
    if (Array.isArray(items)) {
      for (const track of items) {
        if (track?.preview) {
          const result: DeezerPreviewResult = {
            previewUrl: track.preview,
            trackTitle: track.title || topTrack
          };
          previewCache.set(cacheKey, {
            ...result,
            expiresAt: Date.now() + 12 * 60 * 1000
          });
          return result;
        }
      }
    }
  } catch {
    // If search also fails, return null
  }

  return null;
}
