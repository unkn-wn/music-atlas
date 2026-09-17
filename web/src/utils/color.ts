const rgbaCache = new Map<string, string>();

function parseHexChannel(s: string, fallback: number): number {
  const v = parseInt(s, 16);
  return Number.isNaN(v) ? fallback : v;
}

export function hexToRgba(hex: string, alpha: number): string {
  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  const key = `${hex}_${clampedAlpha.toFixed(2)}`;
  const cached = rgbaCache.get(key);
  if (cached) return cached;

  let r = 148, g = 163, b = 184;
  if (hex && hex.charAt(0) === '#') {
    let clean = hex.slice(1);
    if (clean.length === 3) {
      clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
    }
    if (clean.length >= 6) {
      r = parseHexChannel(clean.substring(0, 2), 148);
      g = parseHexChannel(clean.substring(2, 4), 163);
      b = parseHexChannel(clean.substring(4, 6), 184);
    }
  }

  // WebGL premultiplied alpha
  const pr = Math.round(r * clampedAlpha);
  const pg = Math.round(g * clampedAlpha);
  const pb = Math.round(b * clampedAlpha);
  const result = `rgba(${pr}, ${pg}, ${pb}, ${clampedAlpha})`;
  rgbaCache.set(key, result);
  return result;
}
