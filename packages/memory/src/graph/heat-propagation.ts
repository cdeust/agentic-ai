/**
 * Spreading activation (heat propagation) over the entity-relationship graph.
 *
 * Implements Collins & Loftus (1975) semantic priming: when a node is
 * activated (queried), activation propagates along edges with exponential
 * decay by distance. Nodes receiving convergent activation from multiple
 * sources get boosted, enabling multi-hop associative retrieval.
 *
 * This module is the TS port of mcp_server/core/spreading_activation.py.
 * All algorithms and default constants are sourced from that file.
 *
 * Pure functions — no I/O. Callers supply pre-loaded graph data.
 *
 * source: Collins, A. M., & Loftus, E. F. (1975). "A spreading-activation
 *   theory of semantic processing." Psychological Review, 82(6), 407–428.
 * source: spreading_activation.py in mcp_server/core/.
 */

import type { EntityGraph, HeatPropagationConfig } from "./types.js";

// ── Default configuration ─────────────────────────────────────────────────
// source: spreading_activation.py _DEFAULT_* constants

/** @internal */
const DEFAULTS: HeatPropagationConfig = {
  decay: 0.65,
  threshold: 0.1,
  maxDepth: 3,
  maxNodes: 50,
  initialActivation: 1.0,
};

// ── Internal helpers ───────────────────────────────────────────────────────

/**
 * Initialize activation map from seed entities present in the graph.
 *
 * source: _initialize_seeds in spreading_activation.py.
 */
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
 * Propagate activation one BFS hop from the current frontier.
 *
 * For each node in the frontier:
 *   spread = nodeActivation * edgeWeight * decay
 *   activation[neighbor] += spread  (convergent summation)
 *
 * Returns the next frontier: nodes that received activation above threshold
 * and are not seeds.
 *
 * source: _propagate_one_hop in spreading_activation.py.
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
  const halfThreshold = threshold * 0.5;

  for (const nodeId of frontier) {
    const nodeAct = activation.get(nodeId) ?? 0;
    if (nodeAct < threshold) continue;

    const neighbors = graph.get(nodeId) ?? [];
    for (const [neighborId, edgeWeight] of neighbors) {
      const spread = nodeAct * edgeWeight * decay;
      if (spread < halfThreshold) continue;

      activation.set(neighborId, (activation.get(neighborId) ?? 0) + spread);
      nextFrontier.add(neighborId);
    }
  }

  // Keep only nodes above threshold that are not seeds
  const filtered = new Set<number>();
  for (const nid of nextFrontier) {
    if ((activation.get(nid) ?? 0) >= threshold && !seedSet.has(nid)) {
      filtered.add(nid);
    }
  }
  return filtered;
}

/**
 * Cap the activation map to `maxNodes` entries (keep top by score).
 *
 * source: _cap_activations in spreading_activation.py.
 */
function capActivations(
  activation: Map<number, number>,
  maxNodes: number,
): Map<number, number> {
  if (activation.size <= maxNodes) return activation;
  const sorted = [...activation.entries()].sort((a, b) => b[1] - a[1]);
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
 * @param graph          - Entity adjacency list (EntityGraph).
 * @param seedEntityIds  - Starting entity IDs.
 * @param config         - Heat propagation parameters. Defaults match Python.
 * @returns Map of {entityId → activationScore} for all reached entities.
 */
export function spreadActivation(
  graph: EntityGraph,
  seedEntityIds: number[],
  config: Partial<HeatPropagationConfig> = {},
): Map<number, number> {
  const cfg: HeatPropagationConfig = { ...DEFAULTS, ...config };

  const activation = initializeSeeds(
    graph,
    seedEntityIds,
    cfg.initialActivation,
  );
  if (activation.size === 0) return new Map();

  const seedSet = new Set(seedEntityIds);
  let frontier = new Set(activation.keys());

  for (let depth = 0; depth < cfg.maxDepth; depth++) {
    frontier = propagateOneHop(
      graph,
      activation,
      frontier,
      seedSet,
      cfg.decay,
      cfg.threshold,
    );
    if (frontier.size === 0) break;
  }

  return capActivations(activation, cfg.maxNodes);
}

/**
 * Map entity activation scores to memory scores.
 *
 * A memory's score = max activation of any entity it mentions.
 * Using max (not sum) avoids over-boosting memories that mention
 * many low-activation entities.
 *
 * source: map_entity_activation_to_memories in spreading_activation.py.
 *
 * @param entityActivations  - Output of spreadActivation.
 * @param entityToMemoryIds  - {entityId → [memoryId, ...]} mapping.
 * @returns Array of [memoryId, score] sorted descending by score.
 */
export function mapEntityActivationToMemories(
  entityActivations: Map<number, number>,
  entityToMemoryIds: Map<number, number[]>,
): Array<[number, number]> {
  const memoryScores = new Map<number, number>();

  for (const [entityId, activation] of entityActivations.entries()) {
    const memIds = entityToMemoryIds.get(entityId) ?? [];
    for (const memId of memIds) {
      const current = memoryScores.get(memId) ?? 0;
      if (activation > current) {
        memoryScores.set(memId, activation);
      }
    }
  }

  return [...memoryScores.entries()].sort((a, b) => b[1] - a[1]);
}

/**
 * Resolve query terms to entity IDs using case-insensitive name matching.
 *
 * source: resolve_seed_entities in spreading_activation.py.
 *
 * @param queryTerms  - Keywords / entity names extracted from the query.
 * @param entityIndex - {lowercaseName → entityId} lookup.
 * @returns Deduplicated list of matched entity IDs.
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
 * Build an entity adjacency list and name index from raw data.
 *
 * source: build_entity_graph in spreading_activation.py.
 *
 * @param entities      - List of entity records with id, name, heat fields.
 * @param relationships - List of relationship records with source/target IDs.
 * @param minHeat       - Filter: only include entities with heat >= minHeat.
 * @returns [graph, nameIndex]
 */
export function buildEntityGraph(
  entities: Array<{ id: number; name?: string; heat?: number }>,
  relationships: Array<{
    sourceEntityId: number;
    targetEntityId: number;
    weight?: number;
    confidence?: number;
  }>,
  minHeat = 0,
): [EntityGraph, Map<string, number>] {
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
    if (!entityIds.has(rel.sourceEntityId) || !entityIds.has(rel.targetEntityId))
      continue;
    const edgeWeight = (rel.weight ?? 1.0) * (rel.confidence ?? 1.0);

    if (!graph.has(rel.sourceEntityId)) graph.set(rel.sourceEntityId, []);
    if (!graph.has(rel.targetEntityId)) graph.set(rel.targetEntityId, []);

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    graph.get(rel.sourceEntityId)!.push([rel.targetEntityId, edgeWeight]);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    graph.get(rel.targetEntityId)!.push([rel.sourceEntityId, edgeWeight]);
  }

  return [graph, nameIndex];
}
