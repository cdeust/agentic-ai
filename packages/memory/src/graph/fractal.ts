/**
 * Fractal memory tree — multi-scale hierarchical retrieval.
 *
 * Implements a 3-level memory hierarchy:
 *   - Level 0: Individual memories (leaf nodes)
 *   - Level 1: Similarity-based clusters (agglomerative)
 *   - Level 2: Directory/domain-level root clusters
 *
 * Adaptive retrieval weights query length against hierarchy levels:
 *   - Short queries -> broad Level 2 results
 *   - Long queries -> specific Level 0 results
 *
 * Port of: mcp_server/core/fractal.py
 * Pure business logic — no I/O. Receives pre-computed data, returns hierarchy.
 */

export {
  UnionFind,
  agglomerativeCluster,
  computeCentroid,
} from "../recall/fractal/clustering.js";

import {
  agglomerativeCluster,
  buildL1Clusters,
  buildL2Clusters,
} from "../recall/fractal/clustering.js";

type SimilarityFn = (a: unknown, b: unknown) => number;

export interface FractalHierarchy {
  levels: { 0: Record<string, unknown>[]; 1: Record<string, unknown>[]; 2: Record<string, unknown>[] };
  cluster_map: Record<string, Record<string, unknown>>;
  stats: { total_memories: number; l1_clusters: number; l2_clusters: number };
}

// ── Hierarchy Construction ────────────────────────────────────────────────────

/**
 * Build a 3-level fractal memory tree.
 *
 * @returns {levels, cluster_map, stats}
 *
 * Precondition: memories is an array; similarityFn(a,b) returns a value in [0,1].
 * Postcondition: stats.total_memories === memories.length;
 *   levels[0] === memories (not a copy); all cluster IDs in levels[1] and levels[2]
 *   are present in cluster_map.
 */
export function buildHierarchy(
  memories: Record<string, unknown>[],
  similarityFn: SimilarityFn,
  embeddingDim: number,
  l1Threshold: number = 0.6,
): FractalHierarchy {
  if (memories.length === 0) {
    return {
      levels: { 0: [], 1: [], 2: [] },
      cluster_map: {},
      stats: { total_memories: 0, l1_clusters: 0, l2_clusters: 0 },
    };
  }

  const l1Raw = agglomerativeCluster(memories, similarityFn, l1Threshold);
  const [level1, l1Map] = buildL1Clusters(l1Raw, embeddingDim);
  const [level2, l2Map] = buildL2Clusters(level1, memories, embeddingDim);
  const clusterMap: Record<string, Record<string, unknown>> = {};
  for (const [k, v] of l1Map) clusterMap[k] = v as unknown as Record<string, unknown>;
  for (const [k, v] of l2Map) clusterMap[k] = v as unknown as Record<string, unknown>;

  return {
    levels: {
      0: memories,
      1: level1 as unknown as Record<string, unknown>[],
      2: level2 as unknown as Record<string, unknown>[],
    },
    cluster_map: clusterMap,
    stats: {
      total_memories: memories.length,
      l1_clusters: level1.length,
      l2_clusters: level2.length,
    },
  };
}

// ── Adaptive Retrieval Weighting ──────────────────────────────────────────────

/**
 * Compute retrieval weights for each hierarchy level based on query length.
 *
 * @returns [level_0_weight, level_1_weight, level_2_weight]
 *
 * Short queries (<10 words) -> broad (L2 heavy)
 * Long queries (>30 words) -> specific (L0 heavy)
 * Medium -> balanced
 *
 * Postcondition: each weight in [0.3, 1.0].
 */
export function computeLevelWeights(query: string): [number, number, number] {
  const wordCount = query.split(/\s+/).length;

  if (wordCount < 10) return [0.3, 0.5, 1.0];
  if (wordCount > 30) return [1.0, 0.5, 0.3];
  return [0.7, 0.7, 0.7];
}

// ── Scoring ───────────────────────────────────────────────────────────────────

type ScoredResults = Map<number, Record<string, unknown>>;

function scoreLevel0(
  hierarchy: FractalHierarchy,
  queryEmbedding: unknown,
  similarityFn: SimilarityFn,
  weight: number,
  results: ScoredResults,
): void {
  for (const mem of hierarchy.levels[0]) {
    const emb = mem["embedding"];
    if (emb == null) continue;
    const sim = similarityFn(queryEmbedding, emb);
    const mid = mem["id"] as number;
    if (mid != null) {
      results.set(mid, {
        memory_id: mid,
        score: sim * weight,
        level_scores: { L0: sim },
        matched_level: 0,
      });
    }
  }
}

function scoreLevel1(
  hierarchy: FractalHierarchy,
  queryEmbedding: unknown,
  similarityFn: SimilarityFn,
  weight: number,
  results: ScoredResults,
): void {
  for (const cluster of hierarchy.levels[1]) {
    const centroid = cluster["centroid"];
    if (centroid == null) continue;
    const sim = similarityFn(queryEmbedding, centroid);
    const memIds = (cluster["memory_ids"] ?? []) as number[];
    for (const mid of memIds) {
      if (results.has(mid)) {
        const existing = results.get(mid)!;
        existing["score"] = (existing["score"] as number) + sim * weight;
        (existing["level_scores"] as Record<string, number>)["L1"] = sim;
      } else {
        results.set(mid, {
          memory_id: mid,
          score: sim * weight,
          level_scores: { L1: sim },
          matched_level: 1,
        });
      }
    }
  }
}

function scoreLevel2(
  hierarchy: FractalHierarchy,
  queryEmbedding: unknown,
  similarityFn: SimilarityFn,
  weight: number,
  results: ScoredResults,
): void {
  for (const root of hierarchy.levels[2]) {
    const centroid = root["centroid"];
    if (centroid == null) continue;
    const sim = similarityFn(queryEmbedding, centroid);
    const childClusterIds = (root["child_clusters"] ?? []) as string[];
    for (const childId of childClusterIds) {
      const child = hierarchy.cluster_map[childId];
      if (!child) continue;
      const memIds = (child["memory_ids"] ?? []) as number[];
      for (const mid of memIds) {
        if (results.has(mid)) {
          const existing = results.get(mid)!;
          existing["score"] = (existing["score"] as number) + sim * weight;
          (existing["level_scores"] as Record<string, number>)["L2"] = sim;
        } else {
          results.set(mid, {
            memory_id: mid,
            score: sim * weight,
            level_scores: { L2: sim },
            matched_level: 2,
          });
        }
      }
    }
  }
}

/**
 * Score memories against the fractal hierarchy with adaptive weighting.
 *
 * @returns Scored results with hierarchy context, sorted descending by score.
 *
 * Precondition: hierarchy is a valid FractalHierarchy; similarityFn returns values in [0,1].
 * Postcondition: result.length <= maxResults; result is sorted descending by score.
 */
export function scoreAgainstHierarchy(
  queryEmbedding: unknown,
  hierarchy: FractalHierarchy,
  similarityFn: SimilarityFn,
  query: string = "",
  maxResults: number = 10,
): Record<string, unknown>[] {
  const [w0, w1, w2] = computeLevelWeights(query);
  const results: ScoredResults = new Map();

  scoreLevel0(hierarchy, queryEmbedding, similarityFn, w0, results);
  scoreLevel1(hierarchy, queryEmbedding, similarityFn, w1, results);
  scoreLevel2(hierarchy, queryEmbedding, similarityFn, w2, results);

  const sorted = Array.from(results.values()).sort(
    (a, b) => (b["score"] as number) - (a["score"] as number),
  );
  return sorted.slice(0, maxResults);
}

// ── Navigation ────────────────────────────────────────────────────────────────

/**
 * Navigate from a cluster to its children/memories.
 *
 * For L2 cluster -> returns L1 child clusters.
 * For L1 cluster -> returns memory IDs.
 *
 * Postcondition: returns empty array if cluster not found or level is 0.
 */
export function drillDown(
  clusterId: string,
  hierarchy: FractalHierarchy,
): Record<string, unknown>[] {
  const cluster = hierarchy.cluster_map[clusterId];
  if (!cluster) return [];

  if (cluster["level"] === 2) {
    const childIds = (cluster["child_clusters"] ?? []) as string[];
    return childIds
      .map((cid) => hierarchy.cluster_map[cid])
      .filter((c): c is Record<string, unknown> => c != null);
  }

  if (cluster["level"] === 1) {
    const memIds = (cluster["memory_ids"] ?? []) as number[];
    return memIds.map((mid) => ({ memory_id: mid }));
  }

  return [];
}

/**
 * Given a memory ID, return its cluster hierarchy path.
 *
 * @returns [L1_cluster_id, L2_cluster_id] or partial path.
 *
 * Postcondition: result.length in [0, 2].
 */
export function rollUp(
  memoryId: number,
  hierarchy: FractalHierarchy,
): string[] {
  const path: string[] = [];

  for (const cluster of hierarchy.levels[1]) {
    const memIds = (cluster["memory_ids"] ?? []) as number[];
    if (memIds.includes(memoryId)) {
      const clusterId = cluster["cluster_id"] as string;
      path.push(clusterId);
      for (const root of hierarchy.levels[2]) {
        const childIds = (root["child_clusters"] ?? []) as string[];
        if (childIds.includes(clusterId)) {
          path.push(root["cluster_id"] as string);
          break;
        }
      }
      break;
    }
  }

  return path;
}
