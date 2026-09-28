import { Continent } from '../../types/atlas';

/**
 * Computes a human-readable summary label for the Control HUD filter button.
 */
export function formatControlHudLabel(
  activeContinent: Continent | undefined,
  densityRange: [number, number] | null,
  connectionPercentile: number
): string {
  let rankStr: string | null = null;
  if (densityRange !== null) {
    const [minP, maxP] = densityRange;
    if (minP <= 0 && maxP >= 100) {
      rankStr = null;
    } else if (minP <= 0) {
      rankStr = `Top ${maxP}%`;
    } else if (maxP >= 100) {
      rankStr = `Top ${minP}%–100%`;
    } else {
      rankStr = `${minP}%–${maxP}%`;
    }
  }

  let connStr: string | null = null;
  if (connectionPercentile > 0) {
    connStr = `Connections: Top ${100 - connectionPercentile}%`;
  }

  const parts: string[] = [];
  if (activeContinent) parts.push(activeContinent.name);
  if (rankStr) parts.push(rankStr);
  if (connStr) parts.push(connStr);

  return parts.length > 0 ? parts.join(' · ') : 'Filters';
}
