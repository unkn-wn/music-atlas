export interface CrossoverNeighbor {
  neighborId: string;
  neighborName?: string;
  image?: string;
  cosineSimilarity: number;
  sharedPlaylists: number;
  crossoverPercent: number;
}

export interface ArtistDetail {
  subscribersFormatted?: string;
  topTrack?: string;
  previewUrl?: string;
  spotifyUrl?: string;
  deezerUrl?: string;
  totalPlaylists?: number;
  topCrossovers?: CrossoverNeighbor[];
}

export interface AtlasNode {
  id: string;
  label: string;
  x: number;
  y: number;
  size: number;
  color: string;
  continentId: number;
  continentName?: string;
  primaryGenre: string;
  topSubgenres: string[];
  image: string;
  subscribers: number;

  // Optional fields populated when merged with ArtistDetail
  subscribersFormatted?: string;
  topTrack?: string;
  previewUrl?: string;
  spotifyUrl?: string;
  deezerUrl?: string;
  totalPlaylists?: number;
  topCrossovers?: CrossoverNeighbor[];
}

export interface AtlasEdge {
  source: string;
  target: string;
  weight: number;
  size: number;
  isBridge?: boolean;
}

export interface Continent {
  id: number;
  name: string;
  color: string;
  artistCount: number;
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

