/**
 * Hierarchical recall handler — fractal memory tree retrieval.
 *
 * Uses a 3-level fractal hierarchy (L0=memories, L1=clusters, L2=root
 * clusters) to retrieve memories with adaptive level weighting based on
 * query length.
 *
 *   Short queries -> broad (L2-weighted).
 *   Long queries  -> specific (L0-weighted).
 *
 * REQUIRES either domain or memory_ids to bound the tree build.
 * The uncapped fallback was removed because clustering is O(N^2) in the
 * candidate set (infeasible past ~5K memories, ADR-0045 R3).
 *
 * Port of: mcp_server/handlers/recall_hierarchical.py::handler
 *          mcp_server/core/fractal.py (build_hierarchy, score_against_hierarchy,
 *          compute_level_weights)
 *
 * NOTE: The full fractal module (mcp_server/core/fractal.py) is in
 * port/cortex-graph-navigation scope. This handler stubs the fractal
 * operations and falls back to flat recall when <3 embeddings available.
 *
 * TODO(port-pending): Wire real fractal.buildHierarchy and
 * fractal.scoreAgainstHierarchy once port/cortex-graph-navigation merges.
 */

import { cosineSimilarity } from "./vector-similarity.js";
import type { EmbeddingEngine, MemoryStore } from "./port.js";
import { recallHandler } from "./recall-handler.js";
import type { DEFAULT_RECALL_SETTINGS } from "./recall-handler.js";
import type {
  HierarchicalRecallRequest,
  HierarchicalRecallResponse,
  MemoryItem,
} from "./types.js";

// ── Level weight computation ───────────────────────────────────────────────

/**
 * Compute adaptive level weights [L0, L1, L2] based on query length.
 *
 * Short queries weight toward broader L2 clusters (scanning a topic).
 * Long queries weight toward specific L0 memories (precise question).
 *
 * Port of: mcp_server/core/fractal.py::compute_level_weights
 */
export function computeLevelWeights(query: string): [number, number, number] {
  const words = query.trim().split(/\s+/).length;
  if (words <= 3) return [0.2, 0.3, 0.5]; // broad
  if (words <= 7) return [0.4, 0.4, 0.2]; // balanced
  return [0.7, 0.2, 0.1]; // specific
}

// ── Fractal hierarchy stub ─────────────────────────────────────────────────

interface L1Cluster {
  centroid: number[];
  members: MemoryItem[];
}

/**
 * Simple greedy clustering by cosine similarity threshold.
 *
 * This is a lightweight approximation of the full fractal clustering.
 * It assigns each memory to the first cluster whose centroid is within
 * the threshold, creating a new cluster if none qualifies.
 *
 * TODO(port-pending): Replace with fractal.buildHierarchy from
 * port/cortex-graph-navigation once merged. The real implementation
 * includes L2 super-clusters and a proper centroid update algorithm.
 */
function buildSimpleClusters(
  memories: MemoryItem[],
  similarityFn: (a: number[], b: number[]) => number,
  threshold: number,
): L1Cluster[] {
  const clusters: L1Cluster[] = [];

  for (const mem of memories) {
    if (!mem.embedding || mem.embedding.length === 0) continue;
    const emb = mem.embedding;
    let assigned = false;
    for (const cluster of clusters) {
      if (similarityFn(cluster.centroid, emb) >= threshold) {
        cluster.members.push(mem);
        // Update centroid as running average
        cluster.centroid = cluster.centroid.map(
          (v, i) => (v * (cluster.members.length - 1) + (emb[i] ?? 0)) / cluster.members.length,
        );
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      clusters.push({ centroid: [...emb], members: [mem] });
    }
  }

  return clusters;
}

/**
 * Score memories against the fractal hierarchy for a query embedding.
 *
 * Returns (memory_id, score, matchedLevel) triples.
 *
 * TODO(port-pending): Replace with fractal.scoreAgainstHierarchy.
 */
function scoreAgainstHierarchy(
  queryEmbedding: number[],
  clusters: L1Cluster[],
  levelWeights: [number, number, number],
  similarityFn: (a: number[], b: number[]) => number,
): Array<{ memory_id: number; score: number; matched_level: string; level_scores: Record<string, number> }> {
  const [wL0, wL1] = levelWeights;
  const results: Array<{
    memory_id: number;
    score: number;
    matched_level: string;
    level_scores: Record<string, number>;
  }> = [];

  for (const cluster of clusters) {
    const l1Sim = similarityFn(queryEmbedding, cluster.centroid);
    for (const mem of cluster.members) {
      if (!mem.embedding || mem.embedding.length === 0) continue;
      const l0Sim = similarityFn(queryEmbedding, mem.embedding);
      const score = wL0 * l0Sim + wL1 * l1Sim;
      results.push({
        memory_id: mem.id,
        score,
        matched_level: l0Sim >= l1Sim ? "L0" : "L1",
        level_scores: {
          L0: Math.round(l0Sim * 10000) / 10000,
          L1: Math.round(l1Sim * 10000) / 10000,
        },
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

// ── Candidate fetching ────────────────────────────────────────────────────

async function fetchCandidates(
  store: MemoryStore,
  domain: string,
  memoryIds: number[],
  minHeat: number,
): Promise<MemoryItem[]> {
  if (memoryIds.length > 0) {
    const hydrated = await store.getByIds(memoryIds);
    return hydrated.filter((m) => m.heat >= minHeat);
  }
  return store.getMemoriesForDomain(domain, minHeat, 500);
}

// ── Handler ───────────────────────────────────────────────────────────────

type RecallSettings = typeof DEFAULT_RECALL_SETTINGS;

/**
 * Hierarchical recall handler.
 *
 * Contract (v3.13.0+, ADR-0045 R3):
 *   pre:  args.query is non-empty; exactly one of args.domain or
 *         args.memory_ids is provided (both empty → ValidationError string
 *         in response.results[0].content).
 *   post: results bounded by max_results; hierarchy built over at most
 *         500 memories (domain mode) or len(memory_ids) (explicit mode).
 *
 * Falls back to flat recall when <3 embeddings are available.
 *
 * Port of: mcp_server/handlers/recall_hierarchical.py::handler
 */
export async function recallHierarchicalHandler(
  args: HierarchicalRecallRequest | null | undefined,
  store: MemoryStore,
  embeddings: EmbeddingEngine | null = null,
  settings: RecallSettings,
): Promise<HierarchicalRecallResponse> {
  const empty: HierarchicalRecallResponse = {
    results: [],
    total: 0,
    hierarchy: { stats: {} },
  };

  if (!args || !args.query) return empty;

  const {
    query,
    domain = "",
    memory_ids: memoryIdsRaw = [],
    max_results = 10,
    min_heat = 0.05,
    cluster_threshold = 0.6,
  } = args;

  const memoryIds = memoryIdsRaw.map((id) => Number(id));

  // ADR-0045 R3: require domain or memory_ids
  if (!domain && memoryIds.length === 0) {
    // Fall back gracefully — do not throw; Python raises ValidationError
    return {
      results: [],
      total: 0,
      hierarchy: {
        stats: {
          error:
            "recall_hierarchical requires domain or memory_ids; uncapped fallback removed (ADR-0045 R3)",
        },
      },
    };
  }

  const memories = await fetchCandidates(store, domain, memoryIds, min_heat);
  if (memories.length === 0) return { ...empty };

  if (!embeddings) {
    // No embedding engine — fall back to flat recall
    const flatResult = await recallHandler(
      { query, domain: domain || undefined, max_results, min_heat },
      store,
      null,
      settings,
    );
    return {
      results: flatResult.results.map((r) => ({
        memory_id: r.memory_id,
        score: r.score,
        matched_level: "L0",
        level_scores: {},
        content: r.content,
        heat: r.heat,
        domain: r.domain,
        tags: r.tags,
        created_at: r.created_at,
      })),
      total: flatResult.total,
      hierarchy: { stats: { fallback: "no_embedding_engine" } },
    };
  }

  const queryEmbedding = await embeddings.encode(query);
  if (!queryEmbedding) {
    return { results: [], total: 0, hierarchy: { stats: {} } };
  }

  // Filter to memories with embeddings
  const memoriesWithEmb = memories.filter(
    (m) => m.embedding && m.embedding.length > 0,
  );

  // Fall back to flat recall when too few embeddings (< 3)
  if (memoriesWithEmb.length < 3) {
    const flatResult = await recallHandler(
      { query, domain: domain || undefined, max_results, min_heat },
      store,
      embeddings,
      settings,
    );
    return {
      results: flatResult.results.map((r) => ({
        memory_id: r.memory_id,
        score: r.score,
        matched_level: "L0",
        level_scores: {},
        content: r.content,
        heat: r.heat,
        domain: r.domain,
        tags: r.tags,
        created_at: r.created_at,
      })),
      total: flatResult.total,
      hierarchy: { stats: { fallback: "too_few_embeddings" } },
    };
  }

  // Build fractal hierarchy stub
  const simFn = (a: number[], b: number[]): number =>
    cosineSimilarity(a, b);

  const clusters = buildSimpleClusters(memoriesWithEmb, simFn, cluster_threshold);
  const levelWeights = computeLevelWeights(query);

  const rawResults = scoreAgainstHierarchy(
    queryEmbedding,
    clusters,
    levelWeights,
    simFn,
  );

  // Enrich results with full memory data
  const topIds = rawResults.slice(0, max_results).map((r) => r.memory_id);
  const mems = await store.getByIds(topIds);
  const memMap = new Map(mems.map((m) => [m.id, m]));

  const results = rawResults
    .slice(0, max_results)
    .flatMap((item) => {
      const mem = memMap.get(item.memory_id);
      if (!mem) return [];
      return [
        {
          memory_id: item.memory_id,
          score: Math.round(item.score * 10000) / 10000,
          matched_level: item.matched_level,
          level_scores: item.level_scores,
          content: mem.content,
          heat: Math.round(mem.heat * 10000) / 10000,
          domain: mem.domain ?? "",
          tags: Array.isArray(mem.tags) ? mem.tags : [],
          created_at: mem.created_at ?? "",
        },
      ];
    });

  // Track replay for consolidation cascade
  for (const mem of results) {
    const id = mem.memory_id;
    if (id == null) continue;
    try {
      await store.updateMemoryAccess(id);
      await store.incrementReplayCount(id);
    } catch {
      // side-effect failures silenced
    }
  }

  return {
    results,
    total: results.length,
    query_word_count: query.trim().split(/\s+/).length,
    level_weights: { L0: levelWeights[0], L1: levelWeights[1], L2: levelWeights[2] },
    hierarchy: { stats: { cluster_count: clusters.length } },
  };
}
