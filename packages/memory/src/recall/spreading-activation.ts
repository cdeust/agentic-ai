/**
 * Spreading activation over the entity-relationship graph.
 *
 * Implements Collins & Loftus (1975) semantic priming: when a node is
 * activated (queried), activation propagates along edges with exponential
 * decay by distance. Nodes receiving convergent activation from multiple
 * sources get boosted, enabling multi-hop associative retrieval.
 *
 * This becomes Signal #7 in the WRRF retrieval fusion pipeline.
 *
 * Pure business logic — no I/O.
 *
 * Ablation: CORTEX_ABLATE_SPREADING_ACTIVATION=1 causes spreadActivation()
 * to return only seed activation (no propagation). Guard is in the
 * recall-handler entry point.
 *
 * Port of: cortex@bc0ae4f mcp_server/core/spreading_activation.py
 *
 * source: Collins & Loftus (1975) "A spreading-activation theory of
 *         semantic processing." Psychological Review 82(6):407-428.
 */

// ── Types ───────────────────────────────────────────────────────────────────

/** Adjacency map: entity_id → list of (neighbor_id, edge_weight) pairs. */
export type EntityGraph = Map<number, Array<[number, number]>>;

export interface SpreadOptions {
  /** Initial activation for each seed node (default 1.0). */
  initialActivation?: number;
  /** Activation decay per hop (default 0.65).
   *  source: cortex@bc0ae4f mcp_server/core/spreading_activation.py:17 (empirical tuning) */
  decay?: number;
  /** Activation threshold below which propagation stops (default 0.1).
   *  source: cortex@bc0ae4f mcp_server/core/spreading_activation.py:18 */
  threshold?: number;
  /** Maximum BFS depth (default 3).
   *  source: cortex@bc0ae4f mcp_server/core/spreading_activation.py:19 */
  maxDepth?: number;
  /** Maximum number of activated nodes, top-K cap (default 50).
   *  source: cortex@bc0ae4f mcp_server/core/spreading_activation.py:20 */
  maxNodes?: number;
  /** Pass true to skip propagation (ablation mode — returns seed activations only). */
  disabled?: boolean;
}

export interface EntityGraphBuilderInput {
  id: number;
  name?: string;
  heat?: number;
}

export interface RelationshipInput {
  source_entity_id: number;
  target_entity_id: number;
  weight?: number;
  confidence?: number;
}

// ── Defaults ──────────────────────────────────────────────────────────────

const DEFAULT_DECAY = 0.65;       // source: cortex@bc0ae4f spreading_activation.py:17
const DEFAULT_THRESHOLD = 0.1;    // source: cortex@bc0ae4f spreading_activation.py:18
const DEFAULT_MAX_DEPTH = 3;      // source: cortex@bc0ae4f spreading_activation.py:19
const DEFAULT_MAX_NODES = 50;     // source: cortex@bc0ae4f spreading_activation.py:20

/**
 * Half-threshold multiplier for the propagation inner loop.
 * A neighbor receives activation only if it would exceed threshold/2.
 * source: cortex@bc0ae4f mcp_server/core/spreading_activation.py:46
 */
const HALF_THRESHOLD_FACTOR = 0.5;

// ── Internal helpers ──────────────────────────────────────────────────────

function initializeSeeds(
  graph: EntityGraph,
  seedEntityIds: number[],
  initialActivation: number,
): Map<number, number> {
  const activation = new Map<number, number>();
  for (const eid of seedEntityIds) {
    if (graph.has(eid)) {
      activation.set(eid, initialActivation);
    }
  }
  return activation;
}

/**
 * Propagate activation one BFS hop, returning the next frontier.
 *
 * Loop invariant: every node in nextFrontier has activation >= threshold
 *   and is not a seed.
 *
 * source: cortex@bc0ae4f spreading_activation.py:36-62
 */
function propagateOneHop(
  graph: EntityGraph,
  activation: Map<number, number>,
  frontier: Set<number>,
  seedSet: Set<number>,
  decay: number,
  threshold: number,
): Set<number> {
  const nextFrontier = new Set<number>();
  const halfThreshold = threshold * HALF_THRESHOLD_FACTOR;
  for (const nodeId of frontier) {
    const nodeAct = activation.get(nodeId) ?? 0;
    if (nodeAct < threshold) continue;
    for (const [neighborId, edgeWeight] of graph.get(nodeId) ?? []) {
      const spread = nodeAct * edgeWeight * decay;
      if (spread < halfThreshold) continue;
      activation.set(neighborId, (activation.get(neighborId) ?? 0) + spread);
      nextFrontier.add(neighborId);
    }
  }
  // Filter: only nodes above threshold that are not seeds
  const result = new Set<number>();
  for (const nid of nextFrontier) {
    if ((activation.get(nid) ?? 0) >= threshold && !seedSet.has(nid)) {
      result.add(nid);
    }
  }
  return result;
}

function capActivations(
  activation: Map<number, number>,
  maxNodes: number,
): Map<number, number> {
  if (activation.size <= maxNodes) return activation;
  const sorted = Array.from(activation.entries()).sort((a, b) => b[1] - a[1]);
  return new Map(sorted.slice(0, maxNodes));
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Run spreading activation from seed entities over an entity graph.
 *
 * Algorithm (Collins & Loftus 1975, adapted):
 *   1. Initialize activation[seed] = initialActivation for each seed.
 *   2. BFS by depth — propagate to neighbors with convergent summation.
 *   3. Stop at maxDepth or when no nodes exceed threshold.
 *   4. Cap total activated nodes at maxNodes (keep top by activation).
 *
 * pre:  seedEntityIds is non-empty; graph is a valid adjacency map
 * post: returned map contains every entity reachable within maxDepth
 *       that maintains activation >= threshold; size <= maxNodes
 *
 * Loop invariant: `frontier` contains only nodes above threshold.
 * Termination: loop runs at most maxDepth iterations.
 *
 * source: cortex@bc0ae4f mcp_server/core/spreading_activation.py:76-115
 *
 * @param disabled - Pass true to skip propagation (ablation mode).
 *                   Callers wire this from CORTEX_ABLATE_SPREADING_ACTIVATION.
 */
export function spreadActivation(
  graph: EntityGraph,
  seedEntityIds: number[],
  options?: SpreadOptions,
): Map<number, number> {
  const initialActivation = options?.initialActivation ?? 1.0;
  const decay = options?.decay ?? DEFAULT_DECAY;
  const threshold = options?.threshold ?? DEFAULT_THRESHOLD;
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxNodes = options?.maxNodes ?? DEFAULT_MAX_NODES;
  const disabled = options?.disabled ?? false;

  const activation = initializeSeeds(graph, seedEntityIds, initialActivation);

  if (disabled) {
    // Ablation: return only seed activations, no propagation.
    return activation;
  }
  if (activation.size === 0) return new Map();

  const seedSet = new Set(seedEntityIds);
  let frontier = new Set(activation.keys());

  // invariant: frontier contains only nodes with activation >= threshold
  // termination: _depth counts up to maxDepth
  for (let _depth = 0; _depth < maxDepth; _depth++) {
    frontier = propagateOneHop(graph, activation, frontier, seedSet, decay, threshold);
    if (frontier.size === 0) break;
  }

  return capActivations(activation, maxNodes);
}

/**
 * Map entity activation scores to memory scores.
 * A memory's score = max activation of any entity it mentions.
 * Using max (not sum) avoids over-boosting memories that mention many
 * low-activation entities.
 *
 * pre:  entityActivations is a non-empty Map<entityId, score>
 * post: returned list is sorted descending by score
 *
 * source: cortex@bc0ae4f mcp_server/core/spreading_activation.py:118-144
 */
export function mapEntityActivationToMemories(
  entityActivations: Map<number, number>,
  entityToMemoryIds: Map<number, number[]>,
): Array<[number, number]> {
  const memoryScores = new Map<number, number>();
  for (const [entityId, activation] of entityActivations) {
    for (const memId of entityToMemoryIds.get(entityId) ?? []) {
      const current = memoryScores.get(memId) ?? 0;
      if (activation > current) {
        memoryScores.set(memId, activation);
      }
    }
  }
  return Array.from(memoryScores.entries()).sort((a, b) => b[1] - a[1]);
}

/**
 * Resolve query terms to entity IDs using case-insensitive matching.
 *
 * pre:  queryTerms is a list of strings
 * post: returned list is deduplicated; each id appears at most once
 *
 * source: cortex@bc0ae4f mcp_server/core/spreading_activation.py:147-169
 */
export function resolveSeedEntities(
  queryTerms: string[],
  entityIndex: Map<string, number>,
): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const term of queryTerms) {
    const eid = entityIndex.get(term.toLowerCase());
    if (eid !== undefined && !seen.has(eid)) {
      seen.add(eid);
      result.push(eid);
    }
  }
  return result;
}

/**
 * Build an adjacency list and name index from raw entity/relationship data.
 * This is a pure helper — takes pre-loaded data, no I/O.
 *
 * post: graph is bidirectional; entities below minHeat are excluded
 *
 * source: cortex@bc0ae4f mcp_server/core/spreading_activation.py:172-222
 */
export function buildEntityGraph(
  entities: EntityGraphBuilderInput[],
  relationships: RelationshipInput[],
  minHeat = 0.0,
): { graph: EntityGraph; nameIndex: Map<string, number> } {
  const entityIds = new Set<number>();
  const nameIndex = new Map<string, number>();
  for (const ent of entities) {
    if ((ent.heat ?? 0) >= minHeat) {
      entityIds.add(ent.id);
      if (ent.name) {
        nameIndex.set(ent.name.toLowerCase(), ent.id);
      }
    }
  }
  const graph: EntityGraph = new Map();
  for (const rel of relationships) {
    const src = rel.source_entity_id;
    const tgt = rel.target_entity_id;
    if (!entityIds.has(src) || !entityIds.has(tgt)) continue;
    const edgeWeight = (rel.weight ?? 1.0) * (rel.confidence ?? 1.0);
    if (!graph.has(src)) graph.set(src, []);
    if (!graph.has(tgt)) graph.set(tgt, []);
    const srcEdges = graph.get(src);
    const tgtEdges = graph.get(tgt);
    if (srcEdges !== undefined) srcEdges.push([tgt, edgeWeight]);
    if (tgtEdges !== undefined) tgtEdges.push([src, edgeWeight]);
  }
  return { graph, nameIndex };
}
