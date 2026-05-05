/* eslint-disable @typescript-eslint/no-magic-numbers -- source: exact port of Python source; all numeric literals copied verbatim from cited Python file */
/**
 * Personalized PageRank traversal over Cortex's entity graph (Phase 2).
 *
 * Replaces the Swift graph.traverse(entities, maxHops=2, maxNodes=5) BFS
 * with a principled weighted walk. Each node gets a PPR score
 * proportional to the probability that a random walker, restarted with
 * probability α at the Phase 1 seed entities, visits it.
 *
 * Paper backing:
 *   Gutiérrez, Shu, Gu, Yasunaga, Su. "HippoRAG: Neurobiologically
 *   Inspired Long-Term Memory for Large Language Models". NeurIPS 2024,
 *   arxiv 2405.14831. Section 3.3 — scores passages by aggregating PPR
 *   mass of their contained entities seeded on query entities. Reports
 *   strong multi-hop QA gains on MuSiQue, 2WikiMultihopQA, HotpotQA.
 *
 * Applied here: seed PPR on entities extracted from Phase 1 results,
 * aggregate mass onto memories that contain those entities, return
 * memories ranked by PPR mass. Bridges stages via shared entity
 * vocabulary — the structural counterpart to dense semantic similarity.
 *
 * Complements (not replaces) Cortex's existing spreading_activation.py
 * (Collins & Loftus 1975), which is a decaying BFS. PPR gives a
 * stationary distribution rather than a depth-bounded traversal; both
 * are valid, with different use cases.
 *
 * source: Cortex mcp_server/core/context_assembly/ppr_traversal.py
 */

export type Adjacency = Map<string, Array<[string, number]>>;

/**
 * Compute PPR scores for every node reachable from the seeds.
 *
 * Power-iteration variant of Personalized PageRank.
 *
 * @param adjacency - node_id → list of [neighbor_id, edge_weight] tuples.
 *   Weights are normalized to probabilities during iteration.
 * @param seeds - node_id → seed mass. Mass is re-injected at these nodes
 *   on every restart. Does not need to be normalized.
 * @param alpha - restart probability. Default 0.15 (Brin & Page 1998
 *   canonical). Higher α → more localized results.
 * @param maxIters - cap on power iterations.
 * @param tolerance - L1 convergence threshold.
 *
 * @returns Map node_id → PPR score. Only nodes with non-zero mass.
 */
export function personalizedPagerank(
  adjacency: Adjacency,
  seeds: Map<string, number>,
  {
    alpha = 0.15, // source: Brin & Page 1998 canonical restart probability; Cortex ppr_traversal.py::personalized_pagerank
    maxIters = 30,
    tolerance = 1e-4, // source: Cortex ppr_traversal.py::personalized_pagerank L1 convergence threshold
  }: {
    alpha?: number;
    maxIters?: number;
    tolerance?: number;
  } = {},
): Map<string, number> {
  if (seeds.size === 0) return new Map();

  // Normalize seed mass
  let seedTotal = 0;
  for (const v of seeds.values()) seedTotal += v;
  if (seedTotal <= 0) return new Map();

  const seedDist = new Map<string, number>();
  for (const [k, v] of seeds) {
    seedDist.set(k, v / seedTotal);
  }

  // Initialize rank = seed distribution
  let rank = new Map<string, number>(seedDist);

  // Pre-normalize outgoing edge weights to probabilities
  const outProbs = new Map<string, Array<[string, number]>>();
  for (const [node, edges] of adjacency) {
    const total = edges.reduce((s, [, w]) => s + w, 0);
    if (total > 0) {
      outProbs.set(node, edges.map(([n, w]) => [n, w / total]));
    } else {
      outProbs.set(node, []);
    }
  }

  for (let _iter = 0; _iter < maxIters; _iter++) {
    const newRank = new Map<string, number>();

    // Random restart mass
    for (const [node, mass] of seedDist) {
      newRank.set(node, (newRank.get(node) ?? 0) + alpha * mass);
    }

    // Walk step: distribute (1 - α) of each node's mass along edges
    for (const [node, mass] of rank) {
      if (mass <= 0) continue;
      const edges = outProbs.get(node) ?? [];
      if (edges.length === 0) {
        // Dangling node: re-inject via seeds
        for (const [s, sm] of seedDist) {
          newRank.set(s, (newRank.get(s) ?? 0) + (1 - alpha) * mass * sm);
        }
        continue;
      }
      for (const [nbr, prob] of edges) {
        newRank.set(nbr, (newRank.get(nbr) ?? 0) + (1 - alpha) * mass * prob);
      }
    }

    // Convergence check
    const allKeys = new Set([...newRank.keys(), ...rank.keys()]);
    let delta = 0;
    for (const k of allKeys) {
      delta += Math.abs((newRank.get(k) ?? 0) - (rank.get(k) ?? 0));
    }
    rank = newRank;
    if (delta < tolerance) break;
  }

  const result = new Map<string, number>();
  for (const [k, v] of rank) {
    if (v > 0) result.set(k, v);
  }
  return result;
}

// ── Adapter: build PPR input from Cortex's entity/relationship tables ──

/**
 * Build a PPR adjacency map from Cortex's entity/relationship records.
 *
 * @param entities - list of entity dicts with at least "id" or "name".
 * @param relationships - list of relationship dicts with "source_entity_id",
 *   "target_entity_id", and optionally "strength" (defaults to 1.0).
 *   Undirected — each relationship adds both directions.
 *
 * @returns Adjacency map suitable for personalizedPagerank.
 */
export function buildEntityAdjacency(
  entities: Array<Record<string, unknown>>,
  relationships: Array<Record<string, unknown>>,
): Adjacency {
  const adj: Adjacency = new Map();

  // Ensure every entity is a node even if it has no edges
  for (const e of entities) {
    const nodeId = String(e["id"] ?? e["name"] ?? "");
    if (nodeId && !adj.has(nodeId)) {
      adj.set(nodeId, []);
    }
  }

  for (const r of relationships) {
    const src = String(r["source_entity_id"] ?? r["source"] ?? "");
    const tgt = String(r["target_entity_id"] ?? r["target"] ?? "");
    const weight = Number(r["strength"] ?? 1.0);
    if (src && tgt && weight > 0) {
      if (!adj.has(src)) adj.set(src, []);
      if (!adj.has(tgt)) adj.set(tgt, []);
      const srcList = adj.get(src);
      if (srcList !== undefined) srcList.push([tgt, weight]);
      const tgtList = adj.get(tgt);
      if (tgtList !== undefined) tgtList.push([src, weight]);
    }
  }

  return adj;
}

// ── Score memories by aggregating PPR mass over contained entities ─────

/**
 * Aggregate PPR mass onto memories via their contained entities.
 *
 * Following HippoRAG §3.3: a memory's relevance under PPR is the sum
 * of PPR mass of its entities. Memories without any entity get score
 * 0 and are filtered out.
 *
 * @param memories - list of memory dicts. Each must expose the list of
 *   entity IDs it contains under entityIdsKey.
 * @param pprScores - output of personalizedPagerank.
 * @param entityIdsKey - field name holding the list of entity IDs.
 *
 * @returns List of [memory, score] tuples sorted by descending score.
 */
export function scoreMemoriesByPpr(
  memories: Array<Record<string, unknown>>,
  pprScores: Map<string, number>,
  entityIdsKey: string = "entity_ids",
): Array<[Record<string, unknown>, number]> {
  const scored: Array<[Record<string, unknown>, number]> = [];

  for (const m of memories) {
    const entityIds = (m[entityIdsKey] as unknown[]) ?? [];
    let mass = 0;
    for (const eid of entityIds) {
      mass += pprScores.get(String(eid)) ?? 0;
    }
    if (mass > 0) {
      scored.push([m, mass]);
    }
  }

  scored.sort(([, a], [, b]) => b - a);
  return scored;
}
