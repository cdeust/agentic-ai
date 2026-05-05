/**
 * memory-stats.ts — Memory system diagnostics handler.
 *
 * Ports: handlers/memory_stats.py (81 LOC, 2 functions)
 *
 * Returns aggregate statistics about the memory system state:
 * counts, heat distribution, entity/relationship counts, trigger status.
 *
 * Read-only. No arguments. Latency ~50ms.
 *
 * source: cortex@ed33435 mcp_server/handlers/memory_stats.py
 */

import type { MemoryStore } from "../storage/memory-store.js";

// ── Constants ──────────────────────────────────────────────────────────────

// source: cortex@ed33435 mcp_server/handlers/memory_stats.py — round(avg_heat, 4)
const ROUND_FACTOR = 1e4;

// ── Schema ────────────────────────────────────────────────────────────────

export const schema = {
  title: "Memory stats",
  description:
    "Aggregate population diagnostics for the memory system: " +
    "total / episodic / semantic / active / archived / stale / " +
    "protected memory counts, average heat, entity and relationship " +
    "totals, active prospective triggers, last consolidation " +
    "timestamp, and vector-search availability (pgvector). " +
    "Read-only. Takes no arguments. Latency ~50ms.",
  inputSchema: {
    type: "object",
    required: [],
    properties: {},
    additionalProperties: false,
  },
};

// ── Memory stats interface ────────────────────────────────────────────────

export interface MemoryStatsResult {
  total_memories: number;
  episodic_count: number;
  semantic_count: number;
  active_count: number;
  archived_count: number;
  stale_count: number;
  protected_count: number;
  avg_heat: number;
  total_entities: number;
  total_relationships: number;
  active_triggers: number;
  last_consolidation: string | null;
  has_vector_search: boolean;
}

// ── Extended store interface ──────────────────────────────────────────────

interface StatsStore extends MemoryStore {
  countMemories?: () => Record<string, number>;
  getAvgHeat?: () => number;
  countEntities?: () => number;
  countRelationships?: () => number;
  countActiveTriggers?: () => number;
  getLastConsolidation?: () => string | null;
  hasVec?: boolean;
}

// ── Handler ───────────────────────────────────────────────────────────────

/**
 * Return memory system statistics.
 *
 * pre:  store is a live MemoryStore with stat-querying methods.
 * post: all counts are non-negative integers; avg_heat is in [0,1];
 *       last_consolidation is an ISO-8601 string or null.
 *
 * source: cortex@ed33435 mcp_server/handlers/memory_stats.py:handler
 */
export async function memoryStatsHandler(
  store: MemoryStore,
): Promise<MemoryStatsResult> {
  const s = store as StatsStore;

  // count_memories returns {total, episodic, semantic, active, archived, stale, protected}
  const counts: Record<string, number> = s.countMemories?.() ?? {};
  const avgHeat = s.getAvgHeat?.() ?? 0;
  const entityCount = s.countEntities?.() ?? 0;
  const relCount = s.countRelationships?.() ?? 0;
  const triggerCount = s.countActiveTriggers?.() ?? 0;
  const lastConsolidation = s.getLastConsolidation?.() ?? null;
  const hasVec = s.hasVec ?? false;

  return {
    total_memories: counts["total"] ?? 0,
    episodic_count: counts["episodic"] ?? 0,
    semantic_count: counts["semantic"] ?? 0,
    active_count: counts["active"] ?? 0,
    archived_count: counts["archived"] ?? 0,
    stale_count: counts["stale"] ?? 0,
    protected_count: counts["protected"] ?? 0,
    avg_heat: Math.round(avgHeat * ROUND_FACTOR) / ROUND_FACTOR,
    total_entities: entityCount,
    total_relationships: relCount,
    active_triggers: triggerCount,
    last_consolidation: lastConsolidation,
    has_vector_search: hasVec,
  };
}
