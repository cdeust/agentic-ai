/**
 * pg-store-stats.ts — Stats, diagnostics, consolidation, oscillatory state.
 * source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py
 */
import type { PoolClient } from "pg";

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:17-18
// 0.05 = minimum heat threshold for active vs archived classification
const HEAT_ACTIVE_THRESHOLD = 0.05; // source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:17

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:21-33
export async function countMemories(client: PoolClient): Promise<Record<string, number>> {
  const result = await client.query(`
    SELECT COUNT(*) AS total,
        COUNT(*) FILTER (WHERE store_type = 'episodic') AS episodic,
        COUNT(*) FILTER (WHERE store_type = 'semantic') AS semantic,
        COUNT(*) FILTER (WHERE heat_base >= ${HEAT_ACTIVE_THRESHOLD}) AS active,
        COUNT(*) FILTER (WHERE heat_base < ${HEAT_ACTIVE_THRESHOLD}) AS archived,
        COUNT(*) FILTER (WHERE is_stale) AS stale,
        COUNT(*) FILTER (WHERE is_protected) AS protected
    FROM memories
  `);
  return (result.rows[0] as Record<string, number> | undefined) ?? {};
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:35-39
export async function getAvgHeat(client: PoolClient): Promise<number> {
  return (await client.query<{ avg_heat: number | null }>("SELECT AVG(heat_base) AS avg_heat FROM memories")).rows[0]?.avg_heat ?? 0.0;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:41-46
export async function getDomainCounts(client: PoolClient): Promise<Record<string, number>> {
  const result = await client.query<{ d: string; c: number }>(
    `SELECT COALESCE(domain, 'unclassified') AS d, COUNT(*) AS c FROM memories WHERE NOT is_stale GROUP BY domain`);
  const out: Record<string, number> = {};
  for (const row of result.rows) out[row.d] = row.c;
  return out;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:50-55
// eslint-disable-next-line @typescript-eslint/no-magic-numbers -- source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:51
export async function getRecentMemories(client: PoolClient, limit = 20): Promise<Record<string, unknown>[]> {
  return (await client.query("SELECT * FROM memories ORDER BY created_at DESC LIMIT $1", [limit])).rows as Record<string, unknown>[];
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:57-65
// eslint-disable-next-line @typescript-eslint/no-magic-numbers -- source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:58
export async function getRecentlyAccessedMemories(client: PoolClient, limit = 20, minAccessCount = 1): Promise<Record<string, unknown>[]> {
  return (await client.query(
    "SELECT * FROM memories WHERE access_count >= $1 AND NOT is_stale ORDER BY last_accessed DESC LIMIT $2",
    [minAccessCount, limit])).rows as Record<string, unknown>[];
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:69-83
export async function updateMemoryConsolidation(
  client: PoolClient, memoryId: number, stage: string, hoursInStage: number, replayCount: number, hippocampalDependency: number,
): Promise<void> {
  await client.query(
    "UPDATE memories SET consolidation_stage = $1, hours_in_stage = $2, replay_count = $3, hippocampal_dependency = $4 WHERE id = $5",
    [stage, hoursInStage, replayCount, hippocampalDependency, memoryId]);
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:85-107
export async function insertStageTransitionsBatch(
  client: PoolClient,
  rows: Array<{ memory_id: number; from_stage: string; to_stage: string; hours_in_prev: number; trigger?: string }>,
): Promise<number> {
  if (rows.length === 0) return 0;
  await client.query(
    `INSERT INTO stage_transitions (memory_id, from_stage, to_stage, hours_in_prev_stage, trigger)
     SELECT * FROM UNNEST($1::int[], $2::text[], $3::text[], $4::real[], $5::text[])`,
    [rows.map((r) => r.memory_id), rows.map((r) => r.from_stage),
     rows.map((r) => r.to_stage), rows.map((r) => r.hours_in_prev),
     rows.map((r) => r.trigger ?? "cascade")]);
  return rows.length;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:109-117
export async function getMemoriesByStage(
  client: PoolClient, stage: string,
// source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:110
  limit = 100, // eslint-disable-line @typescript-eslint/no-magic-numbers
): Promise<Record<string, unknown>[]> {
  return (await client.query(
    "SELECT * FROM memories WHERE consolidation_stage = $1 ORDER BY hours_in_stage DESC LIMIT $2",
    [stage, limit])).rows as Record<string, unknown>[];
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:119-124
export async function getStageCounts(client: PoolClient): Promise<Record<string, number>> {
  const result = await client.query<{ consolidation_stage: string; c: number }>(
    "SELECT consolidation_stage, COUNT(*) AS c FROM memories GROUP BY consolidation_stage");
  const out: Record<string, number> = {};
  for (const row of result.rows) out[row.consolidation_stage] = row.c;
  return out;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:126-131
export async function incrementReplayCount(client: PoolClient, memoryId: number): Promise<void> {
  await client.query("UPDATE memories SET replay_count = replay_count + 1 WHERE id = $1", [memoryId]);
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:135-141
export async function saveOscillatoryState(client: PoolClient, stateJson: string): Promise<void> {
  await client.query(
    "INSERT INTO oscillatory_state (id, state_json) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET state_json = EXCLUDED.state_json",
    [stateJson]);
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:143-147
export async function loadOscillatoryState(client: PoolClient): Promise<string | null> {
  return (await client.query<{ state_json: string }>("SELECT state_json FROM oscillatory_state WHERE id = 1")).rows[0]?.state_json ?? null;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:151-161
// eslint-disable-next-line @typescript-eslint/no-magic-numbers -- source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:152
export async function getSimilarMemoriesForInterference(client: PoolClient, domain: string, limit = 50): Promise<Record<string, unknown>[]> {
  return (await client.query(
    `SELECT id, embedding, heat, importance, consolidation_stage, directory_context, interference_score
     FROM memories WHERE domain = $1 AND embedding IS NOT NULL AND NOT is_stale ORDER BY heat DESC LIMIT $2`,
    [domain, limit])).rows as Record<string, unknown>[];
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:163-180
export async function updateMemoryInterference(
  client: PoolClient, memoryId: number, interferenceScore: number, separationIndex?: number | null,
): Promise<void> {
  if (separationIndex != null) {
    await client.query("UPDATE memories SET interference_score = $1, separation_index = $2 WHERE id = $3", [interferenceScore, separationIndex, memoryId]);
  } else {
    await client.query("UPDATE memories SET interference_score = $1 WHERE id = $2", [interferenceScore, memoryId]);
  }
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:184-201
export async function getEpisodicMemories(
  client: PoolClient, domain = "", directory = "",
// source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:185
  limit = 500, // eslint-disable-line @typescript-eslint/no-magic-numbers
): Promise<Record<string, unknown>[]> {
  const conditions = ["store_type = 'episodic'", "NOT is_stale"];
  const params: unknown[] = [];
  if (domain) { conditions.push(`domain = $${params.length + 1}`); params.push(domain); }
  if (directory) { conditions.push(`directory_context = $${params.length + 1}`); params.push(directory); }
  params.push(limit);
  return (await client.query(`SELECT * FROM memories WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT $${params.length}`, params)).rows as Record<string, unknown>[];
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:203-219
export async function getSemanticMemories(
  client: PoolClient, domain = "",
// source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:204
  limit = 500, // eslint-disable-line @typescript-eslint/no-magic-numbers
): Promise<Record<string, unknown>[]> {
  if (domain) {
    return (await client.query(
      "SELECT * FROM memories WHERE store_type = 'semantic' AND domain = $1 AND NOT is_stale ORDER BY created_at DESC LIMIT $2",
      [domain, limit])).rows as Record<string, unknown>[];
  }
  return (await client.query(
    "SELECT * FROM memories WHERE store_type = 'semantic' AND NOT is_stale ORDER BY created_at DESC LIMIT $1", [limit])).rows as Record<string, unknown>[];
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:221-226
export async function updateMemoryStoreType(client: PoolClient, memoryId: number, storeType: string): Promise<void> {
  await client.query("UPDATE memories SET store_type = $1 WHERE id = $2", [storeType, memoryId]);
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:230-243
export async function logConsolidation(
  client: PoolClient,
  data: { memories_added?: number; memories_updated?: number; memories_archived?: number; duration_ms?: number },
): Promise<number> {
  const result = await client.query<{ id: number }>(
    "INSERT INTO consolidation_log (memories_added, memories_updated, memories_archived, duration_ms) VALUES ($1, $2, $3, $4) RETURNING id",
    [data.memories_added ?? 0, data.memories_updated ?? 0, data.memories_archived ?? 0, data.duration_ms ?? 0]);
  const row = result.rows[0];
  if (row == null) throw new Error("logConsolidation: no id returned");
  return row.id;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:245-249
export async function getLastConsolidation(client: PoolClient): Promise<string | null> {
  const result = await client.query<{ timestamp: Date }>(
    "SELECT timestamp FROM consolidation_log ORDER BY timestamp DESC LIMIT 1");
  return result.rows[0]?.timestamp?.toISOString() ?? null;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:251-256
export async function countActiveTriggers(client: PoolClient): Promise<number> {
  return (await client.query<{ c: number }>("SELECT COUNT(*) AS c FROM prospective_memories WHERE is_active")).rows[0]?.c ?? 0;
}
