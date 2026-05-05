/**
 * fractal-drill-down.ts — drill_down handler for the fractal memory cluster tree.
 *
 * Descend one level into a fractal cluster previously returned by
 * recall_hierarchical:
 *   L2 cluster → child L1 clusters
 *   L1 cluster → individual memories (with full content)
 *
 * Layer: core/recall (pure logic + store read, no network I/O).
 * Allowed imports: recall port types, vector-similarity, remember store port.
 *
 * source: cortex@ed33435 mcp_server/handlers/drill_down.py::_handler_impl
 * source: cortex@ed33435 mcp_server/core/fractal.py::drill_down
 * source: cortex@ed33435 mcp_server/core/fractal_clustering.py::build_l1_clusters
 *         build_l2_clusters, agglomerative_cluster
 */

import { cosineSimilarity } from "./vector-similarity.js";
import type { EmbeddingEngine, MemoryStore } from "./port.js";
import type { MemoryItem } from "./types.js";

// ── Constants ─────────────────────────────────────────────────────────────────

// source: cortex@ed33435 mcp_server/handlers/drill_down.py:93 — domain limit 500
const DOMAIN_CANDIDATE_CAP = 500;
// source: cortex@ed33435 mcp_server/core/fractal_clustering.py:150 — avg_heat fallback when heat unset
const AVG_HEAT_FALLBACK = 0.5; // source: cortex@ed33435 fractal_clustering.py:150
// source: cortex@ed33435 mcp_server/core/fractal.py default l1_threshold=0.6
const DEFAULT_CLUSTER_THRESHOLD = 0.6;
// source: cortex@ed33435 mcp_server/handlers/drill_down.py schema min_heat default 0.05
const DEFAULT_MIN_HEAT = 0.05;
// source: cortex@ed33435 mcp_server/core/fractal.py — 4 decimal rounding factor
const ROUND_FACTOR = 10000;

// ── Internal cluster types ────────────────────────────────────────────────────

interface L1Cluster {
  readonly clusterId: string;
  readonly level: 1;
  readonly centroid: number[];
  readonly members: MemoryItem[];
  avgHeat: number;
}

interface L2Cluster {
  readonly clusterId: string;
  readonly level: 2;
  readonly centroid: number[];
  readonly childClusterIds: string[];
  readonly directory: string;
}

interface FractalHierarchy {
  readonly l1: Map<string, L1Cluster>;
  readonly l2: Map<string, L2Cluster>;
}

// ── Hierarchy construction ─────────────────────────────────────────────────────

/**
 * Greedy L1 clustering by cosine similarity threshold.
 *
 * precondition:  memories is non-empty and all items have .embedding non-null.
 * postcondition: every memory is assigned to exactly one L1 cluster;
 *   cluster IDs are stable lexicographic strings "L1-{i}".
 *
 * source: cortex@ed33435 mcp_server/core/fractal_clustering.py::agglomerative_cluster
 *         build_l1_clusters
 */
function buildL1Clusters(
  memories: MemoryItem[],
  similarityFn: (a: number[], b: number[]) => number,
  threshold: number,
): L1Cluster[] {
  // invariant: clusters holds all assigned clusters so far;
  // termination: i reaches memories.length
  const rawGroups: MemoryItem[][] = [];
  const centroids: number[][] = [];

  for (const mem of memories) {
    if (!mem.embedding || mem.embedding.length === 0) continue;
    const emb = mem.embedding;
    let assigned = false;
    for (let ci = 0; ci < rawGroups.length; ci++) {
      const ctr = centroids[ci];
      const grp = rawGroups[ci];
      if (ctr === undefined || grp === undefined) continue;
      if (similarityFn(ctr, emb) >= threshold) {
        grp.push(mem);
        // Update centroid as running average
        const n = grp.length;
        centroids[ci] = ctr.map((v, d) => (v * (n - 1) + (emb[d] ?? 0)) / n);
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      rawGroups.push([mem]);
      centroids.push([...emb]);
    }
  }

  return rawGroups.map((group, i) => {
    const avgHeat =
      group.length > 0
        ? group.reduce((s, m) => s + (m.heat ?? AVG_HEAT_FALLBACK), 0) / group.length // source: cortex@ed33435 fractal_clustering.py:150-155
        : 0;
    return {
      clusterId: `L1-${i}`,
      level: 1 as const,
      centroid: centroids[i] ?? [],
      members: group,
      avgHeat: Math.round(avgHeat * ROUND_FACTOR) / ROUND_FACTOR,
    };
  });
}

/**
 * Group L1 clusters into L2 super-clusters by dominant directory/domain.
 *
 * precondition:  l1Clusters is non-empty.
 * postcondition: every L1 cluster belongs to exactly one L2 cluster;
 *   cluster IDs are stable strings "L2-{j}".
 *
 * source: cortex@ed33435 mcp_server/core/fractal_clustering.py::build_l2_clusters
 *         _find_dominant_directory
 */
function buildL2Clusters(l1Clusters: L1Cluster[]): L2Cluster[] {
  // Group L1 clusters by the dominant directory of their members
  const dirGroups = new Map<string, L1Cluster[]>();
  for (const cluster of l1Clusters) {
    const dirCount = new Map<string, number>();
    for (const m of cluster.members) {
      const dir = (m as unknown as Record<string, unknown>)["directory_context"] as string | undefined
        ?? m.domain
        ?? "global";
      dirCount.set(dir, (dirCount.get(dir) ?? 0) + 1);
    }
    let domDir = "global";
    let maxCount = 0;
    for (const [d, c] of dirCount) {
      if (c > maxCount) { maxCount = c; domDir = d; }
    }
    const existing = dirGroups.get(domDir) ?? [];
    existing.push(cluster);
    dirGroups.set(domDir, existing);
  }

  const result: L2Cluster[] = [];
  let j = 0;
  for (const [dir, group] of dirGroups) {
    // Compute centroid as mean of L1 centroids
    const n = group.length;
    const dim = group[0]?.centroid.length ?? 0;
    const sumVec = new Array<number>(dim).fill(0);
    for (const cl of group) {
      for (let d = 0; d < dim; d++) {
        sumVec[d] = (sumVec[d] ?? 0) + (cl.centroid[d] ?? 0);
      }
    }
    const centroid = sumVec.map((v) => v / n);
    result.push({
      clusterId: `L2-${j}`,
      level: 2 as const,
      centroid,
      childClusterIds: group.map((cl) => cl.clusterId),
      directory: dir,
    });
    j++;
  }
  return result;
}

/**
 * Build the full fractal hierarchy (L1 + L2) from a flat memory list.
 *
 * precondition:  memories is non-empty.
 * postcondition: returns a FractalHierarchy with l1 and l2 maps populated.
 *
 * source: cortex@ed33435 mcp_server/core/fractal.py::build_hierarchy
 */
function buildFractalHierarchy(
  memories: MemoryItem[],
  threshold: number,
): FractalHierarchy {
  const memoriesWithEmb = memories.filter(
    (m) => m.embedding && m.embedding.length > 0,
  );
  const simFn = (a: number[], b: number[]): number => cosineSimilarity(a, b);
  const l1List = buildL1Clusters(memoriesWithEmb, simFn, threshold);
  const l2List = buildL2Clusters(l1List);

  const l1 = new Map<string, L1Cluster>(l1List.map((c) => [c.clusterId, c]));
  const l2 = new Map<string, L2Cluster>(l2List.map((c) => [c.clusterId, c]));
  return { l1, l2 };
}

// ── Fractal navigation (core logic) ───────────────────────────────────────────

/**
 * Descend one level in the fractal hierarchy given a cluster ID.
 *
 * For an L2 cluster → returns child L1 cluster summaries.
 * For an L1 cluster → returns leaf {memory_id} objects.
 * Returns [] when clusterId is unknown.
 *
 * precondition:  clusterId follows format "L{level}-{index}".
 * postcondition: result is either L1 cluster summaries or memory-id leaves.
 *
 * source: cortex@ed33435 mcp_server/core/fractal.py::drill_down:207-231
 */
function fractalDrillDown(
  clusterId: string,
  hierarchy: FractalHierarchy,
): Array<Record<string, unknown>> {
  const l2cluster = hierarchy.l2.get(clusterId);
  if (l2cluster) {
    return l2cluster.childClusterIds.flatMap((childId) => {
      const child = hierarchy.l1.get(childId);
      if (!child) return [];
      return [{
        cluster_id: child.clusterId,
        level: child.level,
        size: child.members.length,
        avg_heat: child.avgHeat,
        memory_ids: child.members.map((m) => m.id),
      }];
    });
  }

  const l1cluster = hierarchy.l1.get(clusterId);
  if (l1cluster) {
    return l1cluster.members.map((m) => ({ memory_id: m.id }));
  }

  return [];
}

// ── DrillDown handler dependencies ────────────────────────────────────────────

export interface DrillDownDeps {
  /** The recall-side memory store (async read methods). */
  store: MemoryStore;
  /** Optional embedding engine for similarity. */
  embedder: EmbeddingEngine | null;
}

// ── DrillDown handler public API ──────────────────────────────────────────────

export interface DrillDownArgs {
  cluster_id: string;
  domain?: string;
  min_heat?: number;
}

export interface DrillDownLeafChild {
  memory_id: number;
  content: string;
  heat: number;
  domain: string;
  tags: string[];
}

export interface DrillDownClusterChild {
  cluster_id: string;
  level: number;
  size: number;
  avg_heat: number;
  memory_ids: number[];
}

export interface DrillDownResponse {
  cluster_id: string;
  children: Array<DrillDownLeafChild | DrillDownClusterChild>;
  child_count: number;
  reason?: string;
}

/**
 * drillDownHandler — navigate into a fractal memory cluster.
 *
 * precondition:  args.cluster_id is a non-empty string matching "L{level}-{index}".
 *                deps.store is a live MemoryStore.
 * postcondition: returns {cluster_id, children, child_count}; children is
 *   [] when the cluster is not found or the candidate pool is empty.
 *   For L1 clusters: children carry full memory content (enriched from store).
 *   For L2 clusters: children are L1 cluster summaries.
 *   Side-effect: updateMemoryAccess + incrementReplayCount called for each
 *   leaf memory returned (drives consolidation cascade).
 *
 * source: cortex@ed33435 mcp_server/handlers/drill_down.py::_handler_impl:159-198
 */
export async function drillDownHandler(
  args: DrillDownArgs,
  deps: DrillDownDeps,
): Promise<DrillDownResponse> {
  const clusterId = args.cluster_id;
  const domain = args.domain ?? "";
  const minHeat = args.min_heat ?? DEFAULT_MIN_HEAT;

  // Fetch candidate memories
  // source: cortex@ed33435 mcp_server/handlers/drill_down.py::_fetch_candidate_memories:87-97
  let memories: MemoryItem[];
  if (domain) {
    memories = await deps.store.getMemoriesForDomain(domain, minHeat, DOMAIN_CANDIDATE_CAP);
  } else {
    // No domain filter — use hot memories (global fallback)
    memories = await deps.store.getHotMemories(minHeat, DOMAIN_CANDIDATE_CAP);
  }

  if (memories.length === 0) {
    return { cluster_id: clusterId, children: [], child_count: 0, reason: "no_memories" };
  }

  const threshold = DEFAULT_CLUSTER_THRESHOLD;
  const hierarchy = buildFractalHierarchy(memories, threshold);

  const rawChildren = fractalDrillDown(clusterId, hierarchy);
  if (rawChildren.length === 0) {
    return {
      cluster_id: clusterId,
      children: [],
      child_count: 0,
      reason: "cluster_not_found_or_empty",
    };
  }

  // Determine type: leaf (has memory_id key) or cluster summary
  const firstChild = rawChildren[0];
  if (firstChild === undefined) {
    return { cluster_id: clusterId, children: [], child_count: 0, reason: "cluster_not_found_or_empty" };
  }
  const isLeafLevel = "memory_id" in firstChild;

  if (isLeafLevel) {
    // Enrich leaves with full memory data
    // source: cortex@ed33435 mcp_server/handlers/drill_down.py::_enrich_leaf_memories:100-119
    const ids = rawChildren.map((c) => c["memory_id"] as number).filter((id) => id != null);
    const mems = await deps.store.getByIds(ids);
    const memMap = new Map<number, MemoryItem>(mems.map((m) => [m.id, m]));

    const enriched: DrillDownLeafChild[] = ids.flatMap((mid) => {
      const mem = memMap.get(mid);
      if (!mem) return [];
      return [{
        memory_id: mid,
        content: mem.content,
        heat: Math.round((mem.heat ?? 0) * ROUND_FACTOR) / ROUND_FACTOR,
        domain: mem.domain ?? "",
        tags: Array.isArray(mem.tags) ? mem.tags : [],
      }];
    });

    // Track replay for drilled-into memories — drives consolidation cascade
    // source: cortex@ed33435 mcp_server/handlers/drill_down.py:183-190
    for (const child of enriched) {
      try {
        await deps.store.updateMemoryAccess(child.memory_id);
        await deps.store.incrementReplayCount(child.memory_id);
      } catch {
        // side-effect failures silenced — store may not support replay
      }
    }

    return { cluster_id: clusterId, children: enriched, child_count: enriched.length };
  }

  // Cluster-summary level
  // source: cortex@ed33435 mcp_server/handlers/drill_down.py::_format_cluster_children:122-133
  const clusterChildren: DrillDownClusterChild[] = rawChildren.map((c) => ({
    cluster_id: c["cluster_id"] as string,
    level: c["level"] as number,
    size: c["size"] as number,
    avg_heat: c["avg_heat"] as number,
    memory_ids: c["memory_ids"] as number[],
  }));

  return { cluster_id: clusterId, children: clusterChildren, child_count: clusterChildren.length };
}
