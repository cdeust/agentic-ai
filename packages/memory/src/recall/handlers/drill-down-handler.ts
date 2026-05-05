/**
 * Handler: drill_down — navigate into a fractal memory cluster.
 *
 * Given a cluster ID (L2-N or L1-N), returns the children of that cluster.
 * L2 -> L1 child clusters.
 * L1 -> individual memory IDs with content.
 *
 * Cluster IDs are returned by recall_hierarchical in the hierarchy response.
 *
 * Port of: mcp_server/handlers/drill_down.py
 * source: cortex@ed33435 mcp_server/handlers/drill_down.py
 */

import { READ_ONLY } from "../../shared/tool-meta.js";

// ── Types ─────────────────────────────────────────────────────────────────

export interface DrillDownArgs {
  cluster_id: string;
  domain?: string;
  min_heat?: number;
}

export interface LeafChild {
  memory_id: number;
  content: string;
  heat: number;
  domain: string;
  tags: string[];
}

export interface ClusterChild {
  cluster_id: string;
  level: number;
  size: number;
  avg_heat: number;
  memory_ids: number[];
}

export interface DrillDownResult {
  cluster_id: string;
  children: Array<LeafChild | ClusterChild>;
  child_count?: number;
  reason?: string;
}

export interface DrillDownStore {
  getMemoriesForDomain(
    domain: string,
    opts: { minHeat: number; limit: number },
  ): Promise<Record<string, unknown>[]>;
  getAllMemoriesForDecay(): Promise<Record<string, unknown>[]>;
  getMemory(id: number): Promise<Record<string, unknown> | null>;
  updateMemoryAccess(id: number): Promise<void>;
  incrementReplayCount(id: number): Promise<void>;
}

export interface EmbeddingSimilarityFn {
  (a: number[], b: number[]): number;
}

export interface FractalHierarchy {
  buildHierarchy(opts: {
    memories: Record<string, unknown>[];
    similarityFn: EmbeddingSimilarityFn;
    embeddingDim: number;
  }): Record<string, unknown>;
  drillDown(clusterId: string, hierarchy: Record<string, unknown>): Record<string, unknown>[];
}

export interface DrillDownSettings {
  EMBEDDING_DIM: number;
}

// ── Schema ─────────────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/drill_down.py:22

export const schema = {
  title: "Drill down",
  annotations: READ_ONLY,
  description:
    "Descend one level into a fractal memory cluster previously " +
    "returned by `recall_hierarchical`: an L2 root cluster expands to " +
    "its L1 sub-clusters; an L1 cluster expands to the individual " +
    "memories it contains (full content, heat, tags). Cluster IDs use " +
    "the form `L<level>-<index>`. Use this for interactive top-down " +
    "exploration — start broad with `recall_hierarchical`, then drill " +
    "the most-relevant cluster repeatedly until you reach memories. " +
    "Distinct from `recall` (flat ranked list, no hierarchy), " +
    "`navigate_memory` (graph BFS via co-access edges, not cluster " +
    "tree), and `recall_hierarchical` (entry point that builds the " +
    "tree). Mutates access_count on surfaced memories (drives " +
    "consolidation cascade). Latency <100ms. Returns {cluster_id, " +
    "level, children: [{id, label, members?, content?}]}.",
  inputSchema: {
    type: "object",
    required: ["cluster_id"],
    properties: {
      cluster_id: {
        type: "string",
        description:
          "Cluster identifier returned by recall_hierarchical. " +
          "Format: 'L<level>-<index>'.",
        pattern: "^L[0-9]+-[0-9]+$",
        examples: ["L2-0", "L1-3", "L1-12"],
      },
      domain: {
        type: "string",
        description: "Cognitive domain to build the underlying hierarchy from. Omit for global.",
        examples: ["cortex", "auth-service"],
      },
      min_heat: {
        type: "number",
        description: "Minimum heat (0.0-1.0) for a memory to be eligible for the hierarchy.",
        default: 0.05, // source: cortex@ed33435 mcp_server/handlers/drill_down.py:64
        minimum: 0.0,
        maximum: 1.0,
        examples: [0.0, 0.05, 0.3],
      },
    },
  },
} as const;

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Fetch memories eligible for hierarchy building.
 * Port of: mcp_server/handlers/drill_down.py::_fetch_candidate_memories
 * source: cortex@ed33435 mcp_server/handlers/drill_down.py:87
 */
export async function fetchCandidateMemories(
  store: DrillDownStore,
  domain: string,
  minHeat: number,
): Promise<Record<string, unknown>[]> {
  if (domain) {
    return store.getMemoriesForDomain(domain, { minHeat, limit: 500 }); // source: cortex@ed33435 drill_down.py:94
  }
  const allMems = await store.getAllMemoriesForDecay();
  return allMems.filter((m) => Number(m["heat"] ?? 0) >= minHeat);
}

/**
 * Enrich L1 leaf children with full memory data.
 * Port of: mcp_server/handlers/drill_down.py::_enrich_leaf_memories
 * source: cortex@ed33435 mcp_server/handlers/drill_down.py:100
 */
export async function enrichLeafMemories(
  childrenRaw: Record<string, unknown>[],
  store: DrillDownStore,
): Promise<LeafChild[]> {
  const children: LeafChild[] = [];
  for (const item of childrenRaw) {
    const mid = item["memory_id"] as number | undefined;
    const mem = mid != null ? await store.getMemory(mid) : null;
    if (mem) {
      children.push({
        memory_id: mid!,
        content: String(mem["content"] ?? ""),
        heat: Math.round(Number(mem["heat"] ?? 0) * 10000) / 10000,
        domain: String(mem["domain"] ?? ""),
        tags: (mem["tags"] as string[] | null) ?? [],
      });
    }
  }
  return children;
}

/**
 * Format L2 -> L1 cluster children.
 * Port of: mcp_server/handlers/drill_down.py::_format_cluster_children
 * source: cortex@ed33435 mcp_server/handlers/drill_down.py:122
 */
export function formatClusterChildren(
  childrenRaw: Record<string, unknown>[],
): ClusterChild[] {
  return childrenRaw.map((cluster) => ({
    cluster_id: String(cluster["cluster_id"] ?? ""),
    level: Number(cluster["level"] ?? 0),
    size: Number(cluster["size"] ?? 0),
    avg_heat: Math.round(Number(cluster["avg_heat"] ?? 0) * 10000) / 10000,
    memory_ids: (cluster["memory_ids"] as number[] | null) ?? [],
  }));
}

// ── Handler ────────────────────────────────────────────────────────────────

/**
 * Drill into a fractal memory cluster.
 *
 * precondition: args.cluster_id matches /^L[0-9]+-[0-9]+$/.
 * postcondition: returns cluster_id + children (leaf or sub-cluster)
 *   + child_count; access_count incremented for drilled leaf memories.
 *
 * Port of: mcp_server/handlers/drill_down.py::_handler_impl
 * source: cortex@ed33435 mcp_server/handlers/drill_down.py:159
 */
export async function handler(
  args: DrillDownArgs | null | undefined,
  store: DrillDownStore,
  settings: DrillDownSettings,
  similarityFn: EmbeddingSimilarityFn,
  fractal: FractalHierarchy,
): Promise<DrillDownResult> {
  if (!args?.cluster_id) {
    return { cluster_id: "", children: [] };
  }

  const clusterId = args.cluster_id;
  const domain = args.domain ?? "";
  const minHeat = Number(args.min_heat ?? 0.05); // source: cortex@ed33435 drill_down.py:165

  const memories = await fetchCandidateMemories(store, domain, minHeat);
  if (memories.length === 0) {
    return { cluster_id: clusterId, children: [], reason: "no_memories" };
  }

  const hierarchy = fractal.buildHierarchy({
    memories,
    similarityFn,
    embeddingDim: settings.EMBEDDING_DIM,
  });
  if (!hierarchy || Object.keys(hierarchy).length === 0) {
    return { cluster_id: clusterId, children: [], reason: "no_memories" };
  }

  const childrenRaw = fractal.drillDown(clusterId, hierarchy);
  if (!childrenRaw || childrenRaw.length === 0) {
    return {
      cluster_id: clusterId,
      children: [],
      reason: "cluster_not_found_or_empty",
    };
  }

  let children: Array<LeafChild | ClusterChild>;

  if (childrenRaw[0] && "memory_id" in childrenRaw[0]) {
    // L1 → leaf memories
    children = await enrichLeafMemories(childrenRaw, store);
    // Track replay for drilled-into memories
    for (const child of children as LeafChild[]) {
      const mid = child.memory_id;
      if (mid != null) {
        try {
          await store.updateMemoryAccess(mid);
          await store.incrementReplayCount(mid);
        } catch {
          // best-effort
        }
      }
    }
  } else {
    // L2 → sub-clusters
    children = formatClusterChildren(childrenRaw);
  }

  return { cluster_id: clusterId, children, child_count: children.length };
}
