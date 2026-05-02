/**
 * causal-graph.ts — PC algorithm for causal edge discovery.
 *
 * Pure business logic — no I/O. Callers pass pre-loaded entity lists,
 * co-occurrence maps, and memory arrays.
 *
 * Port of: mcp_server/core/causal_graph.py
 * source: cortex@f2b9f99 mcp_server/core/causal_graph.py:1-307
 *
 * Algorithm reference:
 *   Spirtes, P., Glymour, C., Scheines, R. (1991).
 *   "An Algorithm for Fast Recovery of Sparse Causal Graphs."
 *   Social Science Computer Review, 9(1), 62–72.
 */

// ── Internal constants ────────────────────────────────────────────────────────

// PMI sentinel: value returned when P(a,b) = 0 (entities never co-occurred).
// source: cortex@f2b9f99 mcp_server/core/causal_graph.py:58 — `else -10.0`
const PMI_ZERO_SENTINEL = -10.0;

// Rounding precision for PMI values (4 decimal places).
// source: cortex@f2b9f99 mcp_server/core/causal_graph.py:66 — `round(pmi, 4)`
const PMI_DECIMAL_PLACES = 4;

// Default independence threshold: PMI > 0.5 → dependent pair.
// source: cortex@f2b9f99 mcp_server/core/causal_graph.py:201 — `independence_threshold: float = 0.5`
const DEFAULT_INDEPENDENCE_THRESHOLD = 0.5;

// Default minimum co-occurrence observations before a pair can be in the skeleton.
// PC algorithm lower bound: ≥3 observations for valid conditional independence test.
// source: cortex@f2b9f99 mcp_server/core/causal_graph.py:202 — `min_observations: int = 3`
const DEFAULT_MIN_OBSERVATIONS = 3;

// Strength multiplier for undirected edges (no temporal precedence).
// source: cortex@f2b9f99 mcp_server/core/causal_graph.py:175 — `strength *= 0.5`
const UNDIRECTED_STRENGTH_FACTOR = 0.5;

// Default max depth for causal chain traversal.
// source: cortex@f2b9f99 mcp_server/core/causal_graph.py:254 — `max_depth: int = 5`
const DEFAULT_MAX_DEPTH = 5;

// ── Types ─────────────────────────────────────────────────────────────────────

/** A co-occurrence pair key: sorted(entity_a, entity_b) joined by "\0". */
type PairKey = string;

/** Directed or undirected causal edge between two entities. */
export interface CausalEdge {
  source: string;
  target: string;
  /** PMI-based edge strength. Higher is stronger. */
  strength: number;
  /** True iff temporal precedence established a clear direction. */
  is_directed: boolean;
  /** Co-occurrence count backing this edge. */
  evidence: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function pairKey(a: string, b: string): PairKey {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return `${lo}\0${hi}`;
}

function parsePairKey(key: PairKey): [string, string] {
  const idx = key.indexOf("\0");
  return [key.slice(0, idx), key.slice(idx + 1)];
}

// ── Co-occurrence matrix ──────────────────────────────────────────────────────

/**
 * Count co-occurrences of entity pairs across memories.
 *
 * precondition:  memories and entityNames are non-null arrays.
 * postcondition: returned map contains counts for all pairs (a, b) where both
 *   a and b appear in the same memory content, keyed by sorted(a, b).
 *
 * source: cortex@f2b9f99 mcp_server/core/causal_graph.py:12-31
 */
export function computeCoOccurrenceMatrix(
  memories: readonly Record<string, unknown>[],
  entityNames: readonly string[],
): Map<PairKey, number> {
  const counts = new Map<PairKey, number>();

  for (const mem of memories) {
    const content = ((mem["content"] as string | undefined) ?? "").toLowerCase();
    const present = entityNames.filter((e) => content.includes(e.toLowerCase()));

    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        const pi = present[i];
        const pj = present[j];
        if (pi === undefined || pj === undefined) continue;
        const key = pairKey(pi, pj);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }

  return counts;
}

// ── Conditional independence (PMI) ────────────────────────────────────────────

/**
 * Test conditional independence using pointwise mutual information.
 *
 * precondition:  total >= 0; all counts >= 0.
 * postcondition: returns PMI in ℝ; positive = dependent, non-positive = independent.
 *   Returns 0.0 when inputs are degenerate (total=0, a_count=0, b_count=0).
 *
 * source: cortex@f2b9f99 mcp_server/core/causal_graph.py:34-66
 */
export function computeConditionalIndependence(
  pairCount: number,
  aCount: number,
  bCount: number,
  total: number,
  conditionedCount = 0,
): number {
  if (total === 0 || aCount === 0 || bCount === 0) return 0.0;

  const p_ab = pairCount / total;
  const p_a = aCount / total;
  const p_b = bCount / total;
  const expected = p_a * p_b;

  if (expected === 0) return 0.0;

  // source: cortex@f2b9f99 mcp_server/core/causal_graph.py:57-58
  // Pointwise mutual information: log2(P(a,b) / P(a)*P(b))
  const pmi = p_ab > 0 ? Math.log2(p_ab / expected) : PMI_ZERO_SENTINEL;

  if (conditionedCount > 0) {
    // Reduce PMI if a conditioning variable explains the co-occurrence.
    // source: cortex@f2b9f99 mcp_server/core/causal_graph.py:61-63
    const conditioningRatio = pairCount > 0 ? conditionedCount / pairCount : 0;
    return parseFloat((pmi * Math.max(0, 1.0 - conditioningRatio)).toFixed(PMI_DECIMAL_PLACES));
  }

  return parseFloat(pmi.toFixed(PMI_DECIMAL_PLACES));
}

// ── Temporal precedence ───────────────────────────────────────────────────────

/**
 * Determine temporal ordering between two entities by first-seen timestamp.
 *
 * precondition:  entityFirstSeen values are ISO-8601 strings (lexicographic order = chronological).
 * postcondition: returns "a_before_b" | "b_before_a" | null.
 *
 * source: cortex@f2b9f99 mcp_server/core/causal_graph.py:69-92
 */
export function computeTemporalPrecedence(
  entityFirstSeen: ReadonlyMap<string, string>,
  entityA: string,
  entityB: string,
): "a_before_b" | "b_before_a" | null {
  const timeA = entityFirstSeen.get(entityA);
  const timeB = entityFirstSeen.get(entityB);

  if (timeA == null || timeB == null) return null;
  if (timeA < timeB) return "a_before_b";
  if (timeB < timeA) return "b_before_a";
  return null;
}

// ── Skeleton (PC algorithm phase 1) ──────────────────────────────────────────

/**
 * Build initial skeleton of dependent pairs via PMI filtering.
 *
 * precondition:  coOccurrences and entityCounts are pre-computed; totalMemories >= 0.
 * postcondition: returned skeleton contains only pairs where PMI > independenceThreshold
 *   AND co-occurrence count >= minObservations.
 *
 * source: cortex@f2b9f99 mcp_server/core/causal_graph.py:94-115
 */
function buildSkeleton(
  coOccurrences: ReadonlyMap<PairKey, number>,
  entityCounts: ReadonlyMap<string, number>,
  totalMemories: number,
  independenceThreshold: number,
  minObservations: number,
): Map<PairKey, number> {
  const skeleton = new Map<PairKey, number>();

  for (const [key, count] of coOccurrences) {
    if (count < minObservations) continue;

    const [a, b] = parsePairKey(key);
    const pmi = computeConditionalIndependence(
      count,
      entityCounts.get(a) ?? 0,
      entityCounts.get(b) ?? 0,
      totalMemories,
    );

    if (pmi > independenceThreshold) {
      skeleton.set(key, pmi);
    }
  }

  return skeleton;
}

// ── Conditional independence pruning (PC algorithm phase 2) ──────────────────

/**
 * Find skeleton edges that become conditionally independent given a third entity.
 *
 * postcondition: returned set contains pair keys that should be pruned
 *   because conditioning on some third entity makes them independent.
 *
 * source: cortex@f2b9f99 mcp_server/core/causal_graph.py:118-155
 */
function findConditionallyIndependentEdges(
  skeleton: ReadonlyMap<PairKey, number>,
  entityNames: readonly string[],
  coOccurrences: ReadonlyMap<PairKey, number>,
  entityCounts: ReadonlyMap<string, number>,
  totalMemories: number,
  independenceThreshold: number,
): Set<PairKey> {
  const edgesToRemove = new Set<PairKey>();

  for (const key of skeleton.keys()) {
    const [a, b] = parsePairKey(key);

    for (const c of entityNames) {
      if (c === a || c === b) continue;

      const acCount = coOccurrences.get(pairKey(a, c)) ?? 0;
      const bcCount = coOccurrences.get(pairKey(b, c)) ?? 0;

      if (acCount === 0 || bcCount === 0) continue;

      const minWithC = Math.min(acCount, bcCount);
      const abCount = coOccurrences.get(key) ?? 0;

      const conditionedPmi = computeConditionalIndependence(
        abCount,
        entityCounts.get(a) ?? 0,
        entityCounts.get(b) ?? 0,
        totalMemories,
        minWithC,
      );

      if (conditionedPmi <= independenceThreshold) {
        edgesToRemove.add(key);
        break;
      }
    }
  }

  return edgesToRemove;
}

// ── Edge orientation (PC algorithm phase 3) ───────────────────────────────────

/**
 * Orient skeleton edges using temporal precedence.
 *
 * precondition:  skeleton keys are valid pair keys; coOccurrences is a superset of skeleton.
 * postcondition: returned edges list is sorted by strength descending.
 *   Undirected edges receive strength *= 0.5 per the Python source convention.
 *
 * source: cortex@f2b9f99 mcp_server/core/causal_graph.py:158-188
 */
function orientEdges(
  skeleton: ReadonlyMap<PairKey, number>,
  coOccurrences: ReadonlyMap<PairKey, number>,
  entityFirstSeen: ReadonlyMap<string, string>,
): CausalEdge[] {
  const edges: CausalEdge[] = [];

  for (const [key, strength] of skeleton) {
    const [a, b] = parsePairKey(key);
    const direction = computeTemporalPrecedence(entityFirstSeen, a, b);

    let source: string;
    let target: string;
    let finalStrength = strength;

    if (direction === "a_before_b") {
      source = a;
      target = b;
    } else if (direction === "b_before_a") {
      source = b;
      target = a;
    } else {
      source = a;
      target = b;
      // Undirected: halve strength to reflect uncertainty.
      // source: cortex@f2b9f99 mcp_server/core/causal_graph.py:175
      finalStrength = strength * UNDIRECTED_STRENGTH_FACTOR;
    }

    edges.push({
      source,
      target,
      strength: parseFloat(finalStrength.toFixed(PMI_DECIMAL_PLACES)),
      is_directed: direction !== null,
      evidence: coOccurrences.get(key) ?? 0,
    });
  }

  // Sort by strength descending.
  // source: cortex@f2b9f99 mcp_server/core/causal_graph.py:187
  edges.sort((a, b) => b.strength - a.strength);
  return edges;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface DiscoverCausalEdgesOptions {
  /** PMI threshold above which a pair is considered dependent. Default 0.5. */
  // source: cortex@f2b9f99 mcp_server/core/causal_graph.py:201
  independenceThreshold?: number;
  /** Minimum co-occurrence count to include a pair. Default 3. */
  // source: cortex@f2b9f99 mcp_server/core/causal_graph.py:202
  // PC algorithm lower bound: need ≥3 observations for conditional independence tests.
  minObservations?: number;
  /** First-seen timestamps for temporal orientation. */
  entityFirstSeen?: ReadonlyMap<string, string>;
}

/**
 * Simplified PC algorithm for causal edge discovery.
 *
 * Algorithm (per Spirtes & Glymour 1991, simplified variant):
 *   1. Build skeleton: all entity pairs where PMI > independenceThreshold.
 *   2. Prune: for each skeleton edge (A,B), test conditional independence
 *      given each third entity C; remove if independent.
 *   3. Orient: use temporal first-seen timestamps to direct remaining edges.
 *
 * precondition:  entityNames is non-empty; totalMemories >= 0.
 * postcondition: returned list is sorted by strength descending;
 *   each edge carries source, target, strength, is_directed, evidence.
 *   Returns [] when entityNames is empty or totalMemories = 0.
 *
 * source: cortex@f2b9f99 mcp_server/core/causal_graph.py:200-240
 */
export function discoverCausalEdges(
  entityNames: readonly string[],
  coOccurrences: ReadonlyMap<PairKey, number>,
  entityCounts: ReadonlyMap<string, number>,
  totalMemories: number,
  options: DiscoverCausalEdgesOptions = {},
): CausalEdge[] {
  const independenceThreshold = options.independenceThreshold ?? DEFAULT_INDEPENDENCE_THRESHOLD;
  const minObservations = options.minObservations ?? DEFAULT_MIN_OBSERVATIONS;
  const entityFirstSeen = options.entityFirstSeen ?? new Map<string, string>();

  if (entityNames.length === 0 || totalMemories === 0) return [];

  const skeleton = buildSkeleton(
    coOccurrences,
    entityCounts,
    totalMemories,
    independenceThreshold,
    minObservations,
  );

  // Prune conditionally independent edges.
  const edgesToRemove = findConditionallyIndependentEdges(
    skeleton,
    entityNames,
    coOccurrences,
    entityCounts,
    totalMemories,
    independenceThreshold,
  );
  for (const key of edgesToRemove) {
    skeleton.delete(key);
  }

  return orientEdges(skeleton, coOccurrences, entityFirstSeen);
}

// ── Causal chain traversal ────────────────────────────────────────────────────

/**
 * Build a directed adjacency list from directed edges only.
 *
 * postcondition: keys are source entities; values are reachable targets.
 *
 * source: cortex@f2b9f99 mcp_server/core/causal_graph.py:243-249
 */
function buildDirectedAdjacency(edges: readonly CausalEdge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.is_directed) {
      const targets = adj.get(edge.source) ?? [];
      targets.push(edge.target);
      adj.set(edge.source, targets);
    }
  }
  return adj;
}

/**
 * Find causal chains starting from a given entity.
 *
 * precondition:  maxDepth >= 1.
 * postcondition: each returned path begins with start; no path contains a cycle;
 *   paths are terminated when no outgoing directed edges remain OR depth = maxDepth.
 *
 * source: cortex@f2b9f99 mcp_server/core/causal_graph.py:252-288
 */
export function findCausalChain(
  edges: readonly CausalEdge[],
  start: string,
  maxDepth = DEFAULT_MAX_DEPTH,
): string[][] {
  const adj = buildDirectedAdjacency(edges);

  if (!adj.has(start)) return [];

  const paths: string[][] = [];
  // Stack of [currentNode, pathSoFar]
  const stack: Array<[string, string[]]> = [[start, [start]]];

  // Invariant: every entry on the stack satisfies path.length <= maxDepth
  // and start === path[0].
  // Termination: each iteration pops one entry; pushes entries only when
  // path.length < maxDepth, so the stack is bounded by maxDepth^(fanout).
  while (stack.length > 0) {
    const top = stack.pop();
    if (top === undefined) break;
    const [node, path] = top;

    if (path.length > maxDepth) continue;

    const neighbors = adj.get(node) ?? [];
    if (neighbors.length === 0 && path.length > 1) {
      paths.push(path);
      continue;
    }

    let extended = false;
    for (const neighbor of neighbors) {
      if (!path.includes(neighbor)) {
        stack.push([neighbor, [...path, neighbor]]);
        extended = true;
      }
    }

    if (!extended && path.length > 1) {
      paths.push(path);
    }
  }

  return paths;
}

// ── Common cause detection ────────────────────────────────────────────────────

/**
 * Find common causes (fork structures) for two entities.
 *
 * postcondition: returned list is sorted; contains entities C such that
 *   C → entityA and C → entityB are both directed edges in the graph.
 *
 * source: cortex@f2b9f99 mcp_server/core/causal_graph.py:291-307
 */
export function findCommonCauses(
  edges: readonly CausalEdge[],
  entityA: string,
  entityB: string,
): string[] {
  // Build reverse adjacency: target → set of sources
  const reverseAdj = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.is_directed) {
      const sources = reverseAdj.get(edge.target) ?? new Set<string>();
      sources.add(edge.source);
      reverseAdj.set(edge.target, sources);
    }
  }

  const causesA = reverseAdj.get(entityA) ?? new Set<string>();
  const causesB = reverseAdj.get(entityB) ?? new Set<string>();

  const common: string[] = [];
  for (const c of causesA) {
    if (causesB.has(c)) common.push(c);
  }
  return common.sort();
}
