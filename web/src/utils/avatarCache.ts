// In-memory avatar image cache for standard no-cors HTML image loading.
// Decoupled from WebGL memory: loads strictly for visible labels (30-80 images max),
// avoiding 403 Forbidden CDN issues and eliminating the 21,216px texture atlas crash.
const MAX_CACHED_AVATARS = 500;
const avatarCache = new Map<string, HTMLImageElement>();
const avatarPendingCallbacks = new Map<string, Array<() => void>>();
const failedAvatars = new Set<string>();

/**
 * Retrieves a cached HTMLImageElement or initiates background loading.
 * Calls `onLoaded` once the image successfully finishes loading and decoding.
 */
export function getAvatarImage(
  rawUrl: string | undefined | null,
  onLoaded?: () => void
): HTMLImageElement | null {
  if (!rawUrl || rawUrl.includes('d41d8cd98f00b204e9800998ecf8427e')) return null;
  const url = rawUrl.trim();
  if (failedAvatars.has(url)) return null;

  const cached = avatarCache.get(url);
  if (cached) {
    // Refresh LRU position
    avatarCache.delete(url);
    avatarCache.set(url, cached);
    if (cached.complete && cached.naturalWidth > 0) {
      return cached;
    }
    if (onLoaded) {
      const callbacks = avatarPendingCallbacks.get(url);
      if (callbacks) {
        callbacks.push(onLoaded);
      } else {
        avatarPendingCallbacks.set(url, [onLoaded]);
      }
    }
    return null;
  }

  const img = new Image();
  if (onLoaded) {
    avatarPendingCallbacks.set(url, [onLoaded]);
  }

  img.onload = () => {
    img.onload = null;
    img.onerror = null;
    const callbacks = avatarPendingCallbacks.get(url);
    avatarPendingCallbacks.delete(url);
    if (callbacks) {
      callbacks.forEach((cb) => {
        try {
          cb();
        } catch (_) {}
      });
    }
  };

  img.onerror = () => {
    img.onload = null;
    img.onerror = null;
    avatarPendingCallbacks.delete(url);
    failedAvatars.add(url);
    avatarCache.delete(url);
  };

  img.src = url;

  if (avatarCache.size >= MAX_CACHED_AVATARS) {
    const oldestKey = avatarCache.keys().next().value;
    if (oldestKey) avatarCache.delete(oldestKey);
  }

  avatarCache.set(url, img);
  return null;
}
