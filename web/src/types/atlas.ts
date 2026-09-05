export interface CrossoverNeighbor {
  neighborId: string;
  neighborName: string;
  image: string;
  cosineSimilarity: number;
  sharedPlaylists: number;
  crossoverPercent: number;
}

export interface AtlasNode {
  id: string;
  label: string;
  x: number;
  y: number;
  size: number;
  type?: string;
  isHeadliner?: boolean;
  color: string;
  continentId: number;
  continentName: string;
  popularity: number;
  followers: number;
  monthlyListeners?: number;
  image: string;
  previewUrl: string;
  topTrack: string;
  spotifyUrl: string;
  genres: string[];
  macroGenre: string;
  topCrossovers: CrossoverNeighbor[];
}

export interface AtlasEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  curvature?: number;
  weight: number;
  size: number;
  color?: string;
  rawSharedPlaylists: number;
  crossoverSourcePercent: number;
  crossoverTargetPercent: number;
}

export interface Continent {
  id: number;
  name: string;
  color: string;
  artistCount: number;
  artistIds: string[];
}

export interface AtlasMetadata {
  generatedAt: string;
  nodeCount: number;
  edgeCount: number;
  continentCount: number;
  version: string;
}

export interface AtlasGraphBundle {
  metadata: AtlasMetadata;
  continents: Continent[];
  nodes: AtlasNode[];
  edges: AtlasEdge[];
}
