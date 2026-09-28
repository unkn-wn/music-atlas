export const DEFAULT_FALLBACK_AVATAR =
  'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&auto=format&fit=crop&q=80';

/**
 * Optimizes Deezer avatar URLs for WebGL and node rendering:
 * - Downsamples 1000x1000 avatars to 64x64 thumbnails to prevent GPU texture exhaustion
 * - Strips Deezer default placeholder hash (d41d8cd98f00b204e9800998ecf8427e)
 */
export function sanitizeAvatarUrl(url: string | undefined): string {
  if (!url || url.includes('d41d8cd98f00b204e9800998ecf8427e')) return '';
  let clean = url.trim();
  if (clean.startsWith('//')) clean = 'https:' + clean;
  if (clean.includes('dzcdn.net')) {
    clean = clean.replace(/\d+x\d+-/, '64x64-');
  }
  return clean;
}

/**
 * Resolves high-resolution artist images for the sidebar / detail view:
 * - Deezer CDN: upgrades to 500x500
 * - Google CDN: upgrades to 512x512
 * - iTunes artwork: upgrades to 600x600
 */
export function resolveArtistImageUrl(rawUrl: string | undefined): string {
  if (!rawUrl) return '';
  let url = rawUrl.trim();
  if (url.startsWith('//')) {
    url = 'https:' + url;
  }
  if (url.includes('dzcdn.net')) {
    return url.replace(/\d+x\d+-/, '500x500-');
  }
  if (url.includes('googleusercontent.com') || url.includes('ggpht.com')) {
    const base = url.split('=')[0];
    return `${base}=s512-c-k-c0x00ffffff-no-rj`;
  }
  if (url.includes('mzstatic.com')) {
    return url.replace(/\d+x\d+bb/, '600x600bb');
  }
  return url;
}
