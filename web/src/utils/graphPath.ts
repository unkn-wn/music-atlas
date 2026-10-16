import { AtlasEdge } from '../types/atlas';

/** Undirected CSR adjacency over node indices: neighbours of i are targets[offsets[i] .. offsets[i + 1]). */
export interface GraphAdjacency {
  offsets: Int32Array;
  targets: Int32Array;
  /** Index into the edges array for each adjacency entry */
  edgeIds: Int32Array;
}

export interface GraphPath {
  /** Node indices from start to end; degrees of separation = nodes.length - 1 */
  nodes: number[];
  /** Edge indices joining consecutive nodes */
  edges: number[];
}

export function buildAdjacency(nodeCount: number, edges: AtlasEdge[]): GraphAdjacency {
  const offsets = new Int32Array(nodeCount + 1);
  for (const e of edges) {
    offsets[e.sourceIndex! + 1]++;
    offsets[e.targetIndex! + 1]++;
  }
  for (let i = 0; i < nodeCount; i++) offsets[i + 1] += offsets[i];

  const targets = new Int32Array(offsets[nodeCount]);
  const edgeIds = new Int32Array(offsets[nodeCount]);
  const cursor = offsets.slice(0, nodeCount);
  edges.forEach((e, i) => {
    const s = e.sourceIndex!;
    const t = e.targetIndex!;
    targets[cursor[s]] = t;
    edgeIds[cursor[s]++] = i;
    targets[cursor[t]] = s;
    edgeIds[cursor[t]++] = i;
  });
  return { offsets, targets, edgeIds };
}

/**
 * Fewest-hop path between two artists over the drawn edges. Among equally short paths it returns the
 * strongest chain (highest product of edge weights). BFS pops every node of one layer before the next,
 * so a node's best score is final by the time its own neighbours are relaxed.
 */
export function findPath(
  adjacency: GraphAdjacency,
  edges: AtlasEdge[],
  from: number,
  to: number
): GraphPath | null {
  if (from === to) return { nodes: [from], edges: [] };

  const { offsets, targets, edgeIds } = adjacency;
  const n = offsets.length - 1;
  const dist = new Int32Array(n).fill(-1);
  const score = new Float64Array(n);
  const parent = new Int32Array(n);
  const parentEdge = new Int32Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;

  dist[from] = 0;
  queue[tail++] = from;

  while (head < tail) {
    const u = queue[head++];
    // Every node one layer above the target has been relaxed
    if (dist[to] !== -1 && dist[u] >= dist[to]) break;

    for (let k = offsets[u]; k < offsets[u + 1]; k++) {
      const v = targets[k];
      const candidate = score[u] + Math.log(edges[edgeIds[k]].weight);
      if (dist[v] === -1) {
        dist[v] = dist[u] + 1;
        score[v] = candidate;
        parent[v] = u;
        parentEdge[v] = edgeIds[k];
        queue[tail++] = v;
      } else if (dist[v] === dist[u] + 1 && candidate > score[v]) {
        score[v] = candidate;
        parent[v] = u;
        parentEdge[v] = edgeIds[k];
      }
    }
  }

  if (dist[to] === -1) return null;

  const pathNodes = [to];
  const pathEdges: number[] = [];
  for (let v = to; v !== from; v = parent[v]) {
    pathEdges.push(parentEdge[v]);
    pathNodes.push(parent[v]);
  }
  return { nodes: pathNodes.reverse(), edges: pathEdges.reverse() };
}
