/**
 * Converts HSL color values to a hex string.
 * @param h Hue (0 - 360)
 * @param sPct Saturation percentage (0 - 100)
 * @param lPct Lightness percentage (0 - 100)
 */
export function hslToHex(h: number, sPct: number, lPct: number): string {
  const s = sPct / 100;
  const l = lPct / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (0 <= h && h < 60) {
    r = c; g = x; b = 0;
  } else if (60 <= h && h < 120) {
    r = x; g = c; b = 0;
  } else if (120 <= h && h < 180) {
    r = 0; g = c; b = x;
  } else if (180 <= h && h < 240) {
    r = 0; g = x; b = c;
  } else if (240 <= h && h < 300) {
    r = x; g = 0; b = c;
  } else if (300 <= h && h <= 360) {
    r = c; g = 0; b = x;
  }
  const toHex = (val: number) => Math.round((val + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

// Configurable seed to reroll continent colors deterministically
const CONTINENT_COLOR_SEED = 46;

// Multi-tier palettes combining soft pastel, deep jewel, radiant, and muted tones
const COLOR_TIERS = [
  { s: 55, l: 72 }, // Soft Pastel
  { s: 84, l: 46 }, // Deep Jewel
  { s: 75, l: 62 }, // Radiant Warm
  { s: 58, l: 52 }, // Muted Dusty
];

/** A continent's map color: golden-angle hues across the palette tiers, so neighbouring ids stay distinct */
export function continentColor(continentId: number): string {
  const hue = Math.round((continentId * 137.508 + CONTINENT_COLOR_SEED * 83.17) % 360);
  const tier = COLOR_TIERS[(continentId + CONTINENT_COLOR_SEED) % COLOR_TIERS.length];
  return hslToHex(hue, tier.s, tier.l);
}
