/**
 * BFS traversal core for the Successor Representation cognitive-map graph.
 *
 * Structural model (Kekulé constraint count):
 *   - Each node has valence = |SR graph neighbors|.
 *   - BFS expands layer-by-layer up to maxDepth hops.
 *   - Cycle-breaking: visited set tracks node ids that have been settled.
 *   - Edge pruning: edges below minWeight are not enqueued (prevents
 *     long, weakly-connected paths from polluting results).
 *   - Weight accumulation: cumulativeWeight = product of edge weights
 *     along the path. Equivalent to the SR's discounted reachability.
 *   - Distance = 1 - cumulativeWeight (higher = further in SR space).
 *
 * source: navigate_from / _enqueue_neighbors in cognitive_map.py.
 * source: Dayan (1993) "Improving Generalization for Temporal Difference
 *   Learning" — discounted future reachability as the SR definition.
 * source: Stachenfeld et al. (2017) "The Hippocampus as a Predictive Map".
 */

import type {
  BFSNavigationResult,
  BFSNodeResult,
  Coordinates2D,
  SRGraph,
} from "./types.js";

// source: cognitive_map.py _MAX_NAVIGATE_DEPTH = 3
const DEFAULT_MAX_DEPTH = 3;

// source: navigate_from min_weight default = 0.05
const DEFAULT_MIN_WEIGHT = 0.05;

// ── BFS queue item ─────────────────────────────────────────────────────────

interface QueueItem {
  nodeId: number;
  cumulativeWeight: number;
  depth: number;
  path: number[];
}

// ── Internal helpers ───────────────────────────────────────────────────────

function enqueueNeighbors(
  current: QueueItem,
  srGraph: SRGraph,
  visited: Map<number, BFSNodeResult>,
  queue: QueueItem[],
  minWeight: number,
): void {
  const neighbors = srGraph.get(current.nodeId);
  if (!neighbors) return;

  // Sort descending by weight to explore strongest links first (matches Python)
  const sorted = [...neighbors.entries()].sort((a, b) => b[1] - a[1]);

  for (const [neighborId, weight] of sorted) {
    if (visited.has(neighborId) || weight < minWeight) continue;
    queue.push({
      nodeId: neighborId,
      cumulativeWeight: current.cumulativeWeight * weight,
      depth: current.depth + 1,
      path: [...current.path, neighborId],
    });
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * BFS navigation through the SR graph starting at `startMemoryId`.
 *
 * Returns all reachable nodes within `maxDepth` hops (start node excluded
 * from results), with their cumulative SR distance and hop count.
 *
 * Handles cyclic graphs: visited set prevents re-processing settled nodes.
 *
 * @param startMemoryId - Seed node.
 * @param srGraph       - Weighted adjacency map (SRGraph).
 * @param maxDepth      - Maximum BFS depth. Hard-capped at 4 by callers.
 * @param minWeight     - Minimum edge weight to follow.
 * @returns Map of nodeId → {distance, hops, path}.
 */
export function navigateFrom(
  startMemoryId: number,
  srGraph: SRGraph,
  maxDepth: number = DEFAULT_MAX_DEPTH,
  minWeight: number = DEFAULT_MIN_WEIGHT,
): BFSNavigationResult {
  const visited = new Map<number, BFSNodeResult>();

  // Initial queue item: start node at full weight, depth 0
  const queue: QueueItem[] = [
    {
      nodeId: startMemoryId,
      cumulativeWeight: 1.0,
      depth: 0,
      path: [startMemoryId],
    },
  ];

  while (queue.length > 0) {
    // FIFO — shift from front for BFS ordering (matches Python queue.pop(0))
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const current = queue.shift()!;

    if (visited.has(current.nodeId)) continue;

    // Record the node if it is not the seed (depth > 0)
    if (current.depth > 0) {
      visited.set(current.nodeId, {
        distance: Math.round((1.0 - current.cumulativeWeight) * 10000) / 10000,
        hops: current.depth,
        path: current.path,
      });
    }

    if (current.depth < maxDepth) {
      enqueueNeighbors(current, srGraph, visited, queue, minWeight);
    }
  }

  return visited;
}

// ── SR graph builders ──────────────────────────────────────────────────────

/**
 * Build a weighted SR co-access graph from ordered access sequences.
 *
 * For each sequence [m1, m2, m3, ...]:
 *   SR[m1][m2] += 1
 *   SR[m1][m3] += discount
 *   SR[m1][m4] += discount^2  ...
 * Back-links are weighted by an additional factor of `discount`.
 *
 * source: build_co_access_graph in cognitive_map.py.
 * source: Dayan (1993) — discounted future reachability definition.
 *
 * @param accessSequences - Ordered memory ID sequences.
 * @param discount        - Temporal discount γ (0 < γ < 1).
 *                         source: cognitive_map.py _SR_DISCOUNT = 0.9
 * @returns Weighted adjacency SRGraph.
 */
export function buildCoAccessGraph(
  accessSequences: number[][],
  discount = 0.9,
): SRGraph {
  const srGraph: SRGraph = new Map();

  const addEdge = (src: number, tgt: number, weight: number): void => {
    let neighbors = srGraph.get(src);
    if (!neighbors) {
      neighbors = new Map();
      srGraph.set(src, neighbors);
    }
    neighbors.set(tgt, (neighbors.get(tgt) ?? 0) + weight);
  };

  for (const seq of accessSequences) {
    for (let i = 0; i < seq.length; i++) {
      const src = seq[i];
      if (src === undefined) continue;
      for (let j = i + 1; j < seq.length; j++) {
        const tgt = seq[j];
        if (tgt === undefined) continue;
        const dist = j - i;
        const weight = Math.pow(discount, dist - 1);
        addEdge(src, tgt, weight);
        // Bidirectional back-link weighted less (matches Python)
        addEdge(tgt, src, weight * discount);
      }
    }
  }

  return srGraph;
}

/**
 * Parse an ISO 8601 timestamp string to a Unix timestamp (seconds).
 * Returns 0 on parse failure.
 *
 * source: _parse_iso_timestamp in cognitive_map.py.
 */
function parseIsoTimestamp(s: string): number {
  const ms = Date.parse(s);
  return isNaN(ms) ? 0 : ms / 1000;
}

/**
 * Build a temporal co-access graph from memories' last-accessed timestamps.
 *
 * Two memories are co-accessed if their timestamps are within `windowHours`
 * of each other. Edge weight = temporal proximity in [0, 1].
 *
 * source: build_temporal_co_access + _link_nearby_memories in cognitive_map.py.
 * source: Stachenfeld et al. (2017) — temporal adjacency as SR proxy.
 *
 * @param memories    - Memory records with `id` and `lastAccessed` fields.
 * @param windowHours - Co-access time window.
 *                     source: cognitive_map.py _CO_ACCESS_WINDOW_HOURS = 2.0
 */
export function buildTemporalCoAccess(
  memories: Array<{ id: number; lastAccessed?: string }>,
  windowHours = 2.0,
): SRGraph {
  const windowSecs = windowHours * 3600;
  const graph: SRGraph = new Map();

  // Filter to memories with a parseable timestamp, sorted ascending
  const sorted = memories
    .filter((m) => m.lastAccessed !== undefined && m.lastAccessed !== "")
    .map((m) => ({
      id: m.id,
      ts: parseIsoTimestamp(m.lastAccessed as string),
    }))
    .sort((a, b) => a.ts - b.ts);

  const addEdge = (srcId: number, tgtId: number, weight: number): void => {
    if (!graph.has(srcId)) graph.set(srcId, new Map());
    if (!graph.has(tgtId)) graph.set(tgtId, new Map());
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    graph.get(srcId)!.set(tgtId, weight);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    graph.get(tgtId)!.set(srcId, weight);
  };

  for (let i = 0; i < sorted.length; i++) {
    const memA = sorted[i];
    if (!memA) continue;
    for (let j = i + 1; j < sorted.length; j++) {
      const memB = sorted[j];
      if (!memB) continue;
      const gap = Math.abs(memB.ts - memA.ts);
      if (gap > windowSecs) break; // sorted — all further pairs are wider
      const proximity = 1.0 - gap / windowSecs;
      addEdge(memA.id, memB.id, proximity);
    }
  }

  return graph;
}

// ── SR retrieval scoring ──────────────────────────────────────────────────

/**
 * Score candidate memories by SR affinity to seed memories.
 *
 * score(candidate) = sum of SR[seed][candidate] for all seeds,
 * normalised by number of seeds.
 * Seeds themselves are excluded from results.
 *
 * source: compute_sr_scores in cognitive_map.py.
 *
 * @returns Array of [memoryId, srScore] sorted descending, capped at topK.
 */
export function computeSrScores(
  seedMemoryIds: number[],
  srGraph: SRGraph,
  topK = 20,
): Array<[number, number]> {
  if (seedMemoryIds.length === 0) return [];

  const seedSet = new Set(seedMemoryIds);
  const scores = new Map<number, number>();

  for (const seedId of seedMemoryIds) {
    const neighbors = srGraph.get(seedId);
    if (!neighbors) continue;
    for (const [candId, weight] of neighbors.entries()) {
      if (seedSet.has(candId)) continue;
      scores.set(candId, (scores.get(candId) ?? 0) + weight);
    }
  }

  const nSeeds = seedMemoryIds.length;
  const normalized: Array<[number, number]> = [...scores.entries()].map(
    ([id, score]) => [id, score / nSeeds],
  );

  normalized.sort((a, b) => b[1] - a[1]);
  return normalized.slice(0, topK);
}

// ── 2D projection ─────────────────────────────────────────────────────────

/**
 * Project memories to 2D coordinates using a force-directed approximation.
 *
 * Algorithm:
 *   1. Place nodes on a unit circle (spectral initialization).
 *   2. Apply spring relaxation: strongly connected nodes attract.
 *   3. Normalize to [-1, 1].
 *
 * source: project_to_2d + _spring_relax in cognitive_map.py.
 * source: Fruchterman & Reingold (1991) "Graph Drawing by Force-directed
 *   Placement" — conceptual basis for spring relaxation.
 *
 * @param srGraph   - Weighted adjacency map.
 * @param memoryIds - IDs to project.
 * @returns Map of memoryId → [x, y] in [-1, 1].
 */
export function projectTo2d(
  srGraph: SRGraph,
  memoryIds: number[],
): Coordinates2D {
  if (memoryIds.length === 0) return new Map();

  const n = memoryIds.length;
  const idxMap = new Map<number, number>(memoryIds.map((id, i) => [id, i]));

  // Initialize on unit circle
  const positions: Array<[number, number]> = memoryIds.map((_, i) => [
    Math.cos((2 * Math.PI * i) / n),
    Math.sin((2 * Math.PI * i) / n),
  ]);

  // Spring relaxation — 5 iterations (matches Python)
  // source: _spring_relax iterations=5 in cognitive_map.py
  springRelax(positions, srGraph, idxMap, 5);

  // Normalize to [-1, 1]
  const allCoords = positions.flatMap(([x, y]) => [Math.abs(x), Math.abs(y)]);
  const maxAbs = Math.max(...allCoords, 1e-9);

  const result: Coordinates2D = new Map();
  for (const [mid, i] of idxMap.entries()) {
    const pos = positions[i];
    if (!pos) continue;
    result.set(mid, [
      Math.round((pos[0] / maxAbs) * 10000) / 10000,
      Math.round((pos[1] / maxAbs) * 10000) / 10000,
    ]);
  }
  return result;
}

function springRelax(
  positions: Array<[number, number]>,
  srGraph: SRGraph,
  idxMap: Map<number, number>,
  iterations: number,
): void {
  const n = positions.length;

  for (let iter = 0; iter < iterations; iter++) {
    const forces: Array<[number, number]> = Array.from(
      { length: n },
      () => [0, 0] as [number, number],
    );

    for (const [mid, neighbors] of srGraph.entries()) {
      const i = idxMap.get(mid);
      if (i === undefined) continue;
      const posI = positions[i];
      if (!posI) continue;

      for (const [neighborId, weight] of neighbors.entries()) {
        const j = idxMap.get(neighborId);
        if (j === undefined) continue;
        const posJ = positions[j];
        if (!posJ) continue;
        const forceI = forces[i];
        if (!forceI) continue;

        const dx = posJ[0] - posI[0];
        const dy = posJ[1] - posI[1];
        // source: _spring_relax force scale factor = 0.1 in cognitive_map.py
        forceI[0] += dx * weight * 0.1;
        forceI[1] += dy * weight * 0.1;
      }
    }

    for (let i = 0; i < n; i++) {
      const pos = positions[i];
      const force = forces[i];
      if (!pos || !force) continue;
      pos[0] += force[0];
      pos[1] += force[1];
    }
  }
}
