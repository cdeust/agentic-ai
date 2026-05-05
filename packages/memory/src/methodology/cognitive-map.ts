/**
 * Cognitive map — Successor Representation for navigation-based memory retrieval.
 *
 * Tracks temporal co-access (memories accessed within a session window are linked)
 * and uses discounted SR weights for retrieval scoring and BFS navigation.
 *
 * Pure business logic — no I/O. Callers pass pre-fetched access history.
 *
 * References:
 *   Dayan (1993) "Improving Generalization for Temporal Difference Learning"
 *   Stachenfeld et al. (2017) "The Hippocampus as a Predictive Map"
 *
 * source: cortex@ed33435 mcp_server/core/cognitive_map.py
 */

// ── SR parameters ─────────────────────────────────────────────────────────────

/**
 * Temporal decay for SR update: discount for co-access distance.
 * source: cortex@ed33435 mcp_server/core/cognitive_map.py:22
 */
const SR_DISCOUNT = 0.9;

/**
 * Session window: memories accessed within this many hours are co-access candidates.
 * source: cortex@ed33435 mcp_server/core/cognitive_map.py:25
 */
const CO_ACCESS_WINDOW_HOURS = 2.0;

/**
 * Maximum BFS depth for navigate_memory tool.
 * source: cortex@ed33435 mcp_server/core/cognitive_map.py:28
 */
const MAX_NAVIGATE_DEPTH = 3;

// ── Types ─────────────────────────────────────────────────────────────────────

export type SrGraph = Map<number, Map<number, number>>;

export interface NavigationResult {
  distance: number;
  hops: number;
  path: number[];
}

export interface MemoryWithAccess {
  id: number;
  last_accessed: string;
}

// ── Co-access graph building ──────────────────────────────────────────────────

/**
 * Build a weighted co-access graph from access sequences.
 *
 * For each sequence [m1, m2, m3, ...], the SR update gives:
 *   SR[m1][m2] += 1
 *   SR[m1][m3] += discount
 *   SR[m1][m4] += discount^2  ...
 *
 * Bidirectional: back-links weighted by an additional factor of discount.
 *
 * precondition: discount in (0, 1)
 * postcondition: all weights > 0; graph is bidirectional
 *
 * source: cortex@ed33435 mcp_server/core/cognitive_map.py:34-66
 */
export function buildCoAccessGraph(
  accessSequences: number[][],
  discount: number = SR_DISCOUNT,
): SrGraph {
  const srGraph: SrGraph = new Map();

  function ensureNode(id: number): Map<number, number> {
    if (!srGraph.has(id)) srGraph.set(id, new Map());
    return srGraph.get(id)!;
  }

  for (const seq of accessSequences) {
    for (let i = 0; i < seq.length; i++) {
      const src = seq[i]!;
      for (let j = i + 1; j < seq.length; j++) {
        const tgt = seq[j]!;
        const dist = j - i;
        const weight = discount ** (dist - 1);

        const srcNode = ensureNode(src);
        srcNode.set(tgt, (srcNode.get(tgt) ?? 0) + weight);

        const tgtNode = ensureNode(tgt);
        tgtNode.set(src, (tgtNode.get(src) ?? 0) + weight * discount);
      }
    }
  }

  return srGraph;
}

// ── ISO timestamp parsing ─────────────────────────────────────────────────────

/**
 * Parse ISO timestamp to Unix float, return 0 on error.
 * source: cortex@ed33435 mcp_server/core/cognitive_map.py:69-79
 */
function parseIsoTimestamp(s: string): number {
  try {
    const dt = new Date(s);
    return isNaN(dt.getTime()) ? 0 : dt.getTime() / 1000;
  } catch {
    return 0;
  }
}

/**
 * Build co-access graph from memories' last_accessed timestamps.
 *
 * Two memories are considered co-accessed if their last_accessed times
 * are within windowHours of each other.
 *
 * precondition: memories have numeric id and ISO last_accessed string
 * postcondition: graph is symmetric with weights in (0, 1]
 *
 * source: cortex@ed33435 mcp_server/core/cognitive_map.py:106-122
 */
export function buildTemporalCoAccess(
  memoriesWithAccessTime: MemoryWithAccess[],
  windowHours: number = CO_ACCESS_WINDOW_HOURS,
): SrGraph {
  const sorted = memoriesWithAccessTime
    .filter((m) => m.last_accessed)
    .sort((a, b) => parseIsoTimestamp(a.last_accessed) - parseIsoTimestamp(b.last_accessed));

  const graph: SrGraph = new Map();
  const windowSecs = windowHours * 3600;

  for (let i = 0; i < sorted.length; i++) {
    const memA = sorted[i]!;
    const tA = parseIsoTimestamp(memA.last_accessed);
    const midA = memA.id;

    for (let j = i + 1; j < sorted.length; j++) {
      const memB = sorted[j]!;
      const tB = parseIsoTimestamp(memB.last_accessed);
      const gap = Math.abs(tB - tA);

      if (gap > windowSecs) break; // sorted, all further pairs are further apart

      const midB = memB.id;
      const proximity = 1.0 - gap / windowSecs;

      if (!graph.has(midA)) graph.set(midA, new Map());
      if (!graph.has(midB)) graph.set(midB, new Map());
      graph.get(midA)!.set(midB, proximity);
      graph.get(midB)!.set(midA, proximity);
    }
  }

  return graph;
}

// ── SR retrieval scoring ──────────────────────────────────────────────────────

/**
 * Score candidate memories by SR affinity to seed memories.
 *
 * SR score for candidate c = sum of SR[seed][c] for all seeds.
 * Seeds themselves are excluded from results.
 *
 * precondition: seedMemoryIds is non-empty; top_k >= 1
 * postcondition: result length <= topK; sorted descending by score; seeds absent
 *
 * source: cortex@ed33435 mcp_server/core/cognitive_map.py:128-163
 */
export function computeSrScores(
  seedMemoryIds: number[],
  srGraph: SrGraph,
  topK = 20,
): Array<[number, number]> {
  if (seedMemoryIds.length === 0 || srGraph.size === 0) return [];

  const seedSet = new Set(seedMemoryIds);
  const scores = new Map<number, number>();

  for (const seedId of seedMemoryIds) {
    const neighbors = srGraph.get(seedId);
    if (!neighbors) continue;
    for (const [candId, weight] of neighbors) {
      if (!seedSet.has(candId)) {
        scores.set(candId, (scores.get(candId) ?? 0) + weight);
      }
    }
  }

  // Normalize by number of seeds
  const nSeeds = seedMemoryIds.length;
  const normalized: Array<[number, number]> = [];
  for (const [mid, score] of scores) {
    normalized.push([mid, score / nSeeds]);
  }

  normalized.sort((a, b) => b[1] - a[1]);
  return normalized.slice(0, topK);
}

// ── Navigation ────────────────────────────────────────────────────────────────

/**
 * BFS navigation through SR graph from a starting memory.
 *
 * Returns all reachable nodes within maxDepth steps, with their
 * cumulative SR distance and hop count.
 *
 * precondition: startMemoryId exists in srGraph or graph is non-empty
 * postcondition: visited does not contain startMemoryId; all hops >= 1
 *
 * source: cortex@ed33435 mcp_server/core/cognitive_map.py:189-228
 */
export function navigateFrom(
  startMemoryId: number,
  srGraph: SrGraph,
  maxDepth: number = MAX_NAVIGATE_DEPTH,
  minWeight = 0.05,
): Map<number, NavigationResult> {
  const visited = new Map<number, NavigationResult>();
  type QueueEntry = [number, number, number, number[]];
  const queue: QueueEntry[] = [[startMemoryId, 1.0, 0, [startMemoryId]]];

  while (queue.length > 0) {
    const entry = queue.shift()!;
    const [currentId, cumulativeWeight, depth, path] = entry;

    if (visited.has(currentId)) continue;

    if (depth > 0) {
      visited.set(currentId, {
        distance: Math.round((1.0 - cumulativeWeight) * 10000) / 10000,
        hops: depth,
        path,
      });
    }

    if (depth < maxDepth) {
      const neighbors = srGraph.get(currentId);
      if (!neighbors) continue;

      const sortedNeighbors = [...neighbors.entries()].sort((a, b) => b[1] - a[1]);
      for (const [neighborId, weight] of sortedNeighbors) {
        if (!visited.has(neighborId) && weight >= minWeight) {
          const newWeight = cumulativeWeight * weight;
          queue.push([neighborId, newWeight, depth + 1, [...path, neighborId]]);
        }
      }
    }
  }

  return visited;
}

// ── 2D projection (for visualization) ────────────────────────────────────────

/**
 * Apply force-directed spring relaxation to positions in-place.
 * source: cortex@ed33435 mcp_server/core/cognitive_map.py:235-260
 */
function springRelax(
  positions: number[][],
  srGraph: SrGraph,
  idxMap: Map<number, number>,
  iterations = 5,
): void {
  const n = positions.length;
  for (let iter = 0; iter < iterations; iter++) {
    const forces: number[][] = Array.from({ length: n }, () => [0.0, 0.0]);

    for (const [mid, neighbors] of srGraph) {
      if (!idxMap.has(mid)) continue;
      const i = idxMap.get(mid)!;
      for (const [neighborId, weight] of neighbors) {
        if (!idxMap.has(neighborId)) continue;
        const j = idxMap.get(neighborId)!;
        const dx = (positions[j]![0] ?? 0) - (positions[i]![0] ?? 0);
        const dy = (positions[j]![1] ?? 0) - (positions[i]![1] ?? 0);
        const fi = forces[i]!;
        fi[0] = (fi[0] ?? 0) + dx * weight * 0.1;
        fi[1] = (fi[1] ?? 0) + dy * weight * 0.1;
      }
    }

    for (let i = 0; i < n; i++) {
      const pos = positions[i]!;
      const force = forces[i]!;
      pos[0] = (pos[0] ?? 0) + (force[0] ?? 0);
      pos[1] = (pos[1] ?? 0) + (force[1] ?? 0);
    }
  }
}

/**
 * Project memories to 2D coordinates using spectral embedding of the SR graph.
 *
 * Uses a simple force-directed approximation:
 * - Strongly connected memories cluster near each other
 * - Isolated memories spread outward
 *
 * postcondition: returned coordinates are in [-1, 1]; keys = memoryIds
 *
 * source: cortex@ed33435 mcp_server/core/cognitive_map.py:263-300
 */
export function projectTo2d(
  srGraph: SrGraph,
  memoryIds: number[],
): Map<number, [number, number]> {
  if (memoryIds.length === 0) return new Map();

  const n = memoryIds.length;
  const idxMap = new Map<number, number>(memoryIds.map((mid, i) => [mid, i]));
  const positions: number[][] = Array.from({ length: n }, (_, i) => [
    Math.cos((2 * Math.PI * i) / n),
    Math.sin((2 * Math.PI * i) / n),
  ]);

  springRelax(positions, srGraph, idxMap);

  const allCoords = positions.flatMap((p) => p);
  const maxAbs = Math.max(Math.max(...allCoords.map(Math.abs)), 1e-9);

  const result = new Map<number, [number, number]>();
  for (const mid of memoryIds) {
    const i = idxMap.get(mid)!;
    result.set(mid, [
      Math.round((positions[i]![0]! / maxAbs) * 10000) / 10000,
      Math.round((positions[i]![1]! / maxAbs) * 10000) / 10000,
    ]);
  }
  return result;
}
