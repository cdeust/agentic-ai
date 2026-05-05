/**
 * pg-store-entities.ts — Entity CRUD for PgMemoryStore.
 * source: cortex@ed33435 mcp_server/infrastructure/pg_store_entities.py
 */
import type { PoolClient } from "pg";

function canonicalize(name: string): string { return name.trim(); }

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_entities.py:19-37
export async function updateEntitiesHeatBatch(client: PoolClient, updates: Array<[number, number]>): Promise<number> {
  if (updates.length === 0) return 0;
  await client.query(
    `UPDATE entities AS e SET heat = v.new_heat FROM (SELECT UNNEST($1::int[]) AS id, UNNEST($2::real[]) AS new_heat) AS v WHERE e.id = v.id`,
    [updates.map((u) => u[0]), updates.map((u) => u[1])],
  );
  return updates.length;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_entities.py:39-48
export async function archiveEntitiesBatch(client: PoolClient, entityIds: number[]): Promise<number> {
  if (entityIds.length === 0) return 0;
  await client.query("UPDATE entities SET heat = 0 WHERE id = ANY($1::int[])", [entityIds]);
  return entityIds.length;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_entities.py:50-80
export async function insertEntity(
  client: PoolClient,
  data: { name: string; type: string; domain?: string; created_at?: string | null; heat?: number },
): Promise<number> {
  const canonical = canonicalize(data.name);
  const existing = await client.query<{ id: number }>(
    "SELECT id FROM entities WHERE LOWER(name) = LOWER($1) LIMIT 1", [canonical]);
  // source: cortex@ed33435 infrastructure/sqlite_store_entities.py — check existing entity
  const existingId = existing.rows[0]?.id;
  if ((existingId ?? 0) > 0) return existingId!;
  const result = await client.query<{ id: number }>(
    `INSERT INTO entities (name, type, domain, created_at, last_accessed, heat)
     VALUES ($1, $2, $3, COALESCE($4, NOW()), NOW(), $5) RETURNING id`,
    [canonical, data.type, data.domain ?? "", data.created_at ?? null, data.heat ?? 1.0],
  );
  const row = result.rows[0];
  if (row == null) throw new Error("insertEntity: no id returned");
  return row.id;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_entities.py:82-91
export async function getEntityByName(client: PoolClient, name: string): Promise<Record<string, unknown> | null> {
  const result = await client.query("SELECT * FROM entities WHERE LOWER(name) = LOWER($1) LIMIT 1", [name]);
  return (result.rows[0] as Record<string, unknown> | undefined) ?? null;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_entities.py:93-97
export async function getEntityById(client: PoolClient, entityId: number): Promise<Record<string, unknown> | null> {
  const result = await client.query("SELECT * FROM entities WHERE id = $1", [entityId]);
  return (result.rows[0] as Record<string, unknown> | undefined) ?? null;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_entities.py:99-111
export async function getAllEntities(client: PoolClient, minHeat = 0.05, includeArchived = false): Promise<Record<string, unknown>[]> {
  const q = includeArchived
    ? "SELECT * FROM entities WHERE heat >= $1"
    : "SELECT * FROM entities WHERE heat >= $1 AND NOT archived";
  return (await client.query(q, [minHeat])).rows as Record<string, unknown>[];
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_entities.py:113-115
export async function countEntities(client: PoolClient): Promise<number> {
  return (await client.query<{ c: number }>("SELECT COUNT(*) AS c FROM entities")).rows[0]?.c ?? 0;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_entities.py:117-121
export async function getEntitiesOfType(client: PoolClient, entityType: string): Promise<Record<string, unknown>[]> {
  return (await client.query("SELECT * FROM entities WHERE type = $1", [entityType])).rows as Record<string, unknown>[];
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_entities.py:123-128
export async function getDomainEntityCounts(client: PoolClient): Promise<Record<string, number>> {
  const result = await client.query<{ domain: string; count: number }>(
    "SELECT domain, COUNT(*) AS count FROM entities WHERE NOT archived GROUP BY domain ORDER BY count DESC");
  const out: Record<string, number> = {};
  for (const row of result.rows) out[row.domain] = row.count;
  return out;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_entities.py:130-143
export async function getIsolatedEntities(client: PoolClient, limit = 20): Promise<Record<string, unknown>[]> {
  return (await client.query(
    `SELECT e.*, COALESCE(r.rel_count, 0) AS relationship_count FROM entities e
     LEFT JOIN (SELECT source_entity_id AS eid, COUNT(*) AS rel_count FROM relationships GROUP BY source_entity_id) r ON r.eid = e.id
     WHERE NOT e.archived ORDER BY relationship_count ASC, e.heat DESC LIMIT $1`,
    [limit],
  )).rows as Record<string, unknown>[];
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_entities.py:145-150
export async function getResolvedEntityIds(client: PoolClient): Promise<Set<number>> {
  const result = await client.query<{ source_entity_id: number }>(
    "SELECT DISTINCT source_entity_id FROM relationships WHERE relationship_type = 'resolved_by'");
  return new Set(result.rows.map((r) => r.source_entity_id));
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_entities.py:152-174
export async function getMemoriesMentioningEntity(client: PoolClient, entityName: string, limit = 20): Promise<Record<string, unknown>[]> {
  let result = await client.query(
    "SELECT * FROM memories WHERE content_tsv @@ phraseto_tsquery('english', $1) ORDER BY heat_base DESC LIMIT $2",
    [entityName, limit]);
  if (result.rows.length === 0) {
    const escaped = entityName.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    result = await client.query(
      "SELECT * FROM memories WHERE content ILIKE $1 AND NOT is_stale ORDER BY heat_base DESC LIMIT $2",
      [`%${escaped}%`, limit]);
  }
  return result.rows as Record<string, unknown>[];
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_entities.py:176-183
export async function insertMemoryEntity(client: PoolClient, memoryId: number, entityId: number): Promise<void> {
  await client.query(
    "INSERT INTO memory_entities (memory_id, entity_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [memoryId, entityId]);
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_entities.py:184-198
export async function listMemoryEntityEdges(client: PoolClient): Promise<Array<{ memory_id: number; entity_id: number }>> {
  const result = await client.query<{ memory_id: number; entity_id: number }>(
    "SELECT memory_id, entity_id FROM memory_entities");
  return result.rows.filter((r) => r.memory_id != null && r.entity_id != null);
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_entities.py:200-208
export async function getEntitiesForMemory(client: PoolClient, memoryId: number): Promise<Record<string, unknown>[]> {
  return (await client.query(
    "SELECT e.* FROM entities e JOIN memory_entities me ON me.entity_id = e.id WHERE me.memory_id = $1 ORDER BY e.heat DESC",
    [memoryId])).rows as Record<string, unknown>[];
}

// Source: Jaccard (1912) set similarity.
// source: cortex@ed33435 mcp_server/infrastructure/pg_store_entities.py:210-235
export async function getEntityIdsForMemories(client: PoolClient, memoryIds: number[]): Promise<Map<number, Set<number>>> {
  if (memoryIds.length === 0) return new Map();
  const result = await client.query<{ memory_id: number; entity_id: number }>(
    "SELECT memory_id, entity_id FROM memory_entities WHERE memory_id = ANY($1::int[])", [memoryIds]);
  const out = new Map<number, Set<number>>();
  for (const row of result.rows) {
    const set = out.get(row.memory_id) ?? new Set<number>();
    set.add(row.entity_id);
    out.set(row.memory_id, set);
  }
  return out;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_entities.py:237-245
export async function getMemoriesForEntity(client: PoolClient, entityId: number): Promise<Record<string, unknown>[]> {
  return (await client.query(
    "SELECT m.* FROM memories m JOIN memory_entities me ON me.memory_id = m.id WHERE me.entity_id = $1 ORDER BY m.heat_base DESC",
    [entityId])).rows as Record<string, unknown>[];
}
