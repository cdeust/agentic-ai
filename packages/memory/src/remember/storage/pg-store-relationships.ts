/**
 * pg-store-relationships.ts — Relationship CRUD for PgMemoryStore.
 * source: cortex@ed33435 mcp_server/infrastructure/pg_store_relationships.py
 */
import type { PoolClient } from "pg";

export interface RelationshipData {
  source_entity_id: number; target_entity_id: number; relationship_type: string;
  weight?: number; is_causal?: boolean; confidence?: number; created_at?: string | null;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_relationships.py:15-35
export async function updateRelationshipsWeightBatch(client: PoolClient, updates: Array<[number, number]>): Promise<number> {
  if (updates.length === 0) return 0;
  await client.query(
    `UPDATE relationships AS r SET weight = v.new_weight FROM (SELECT UNNEST($1::int[]) AS id, UNNEST($2::real[]) AS new_weight) AS v WHERE r.id = v.id`,
    [updates.map((u) => u[0]), updates.map((u) => u[1])]);
  return updates.length;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_relationships.py:37-50
export async function deleteRelationshipsBatch(client: PoolClient, relIds: number[]): Promise<number> {
  if (relIds.length === 0) return 0;
  await client.query("DELETE FROM relationships WHERE id = ANY($1::int[])", [relIds]);
  return relIds.length;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_relationships.py:52-69
export async function insertRelationship(client: PoolClient, data: RelationshipData): Promise<number> {
  const result = await client.query<{ id: number }>(
    `INSERT INTO relationships (source_entity_id, target_entity_id, relationship_type, weight, is_causal, confidence, created_at, last_reinforced)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, NOW()), NOW()) RETURNING id`,
    [data.source_entity_id, data.target_entity_id, data.relationship_type,
     data.weight ?? 1.0, data.is_causal ?? false, data.confidence ?? 1.0, data.created_at ?? null]);
  const row = result.rows[0];
  if (row == null) throw new Error("insertRelationship: no id returned");
  return row.id;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_relationships.py:71-73
export async function countRelationships(client: PoolClient): Promise<number> {
  return (await client.query<{ c: number }>("SELECT COUNT(*) AS c FROM relationships")).rows[0]?.c ?? 0;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_relationships.py:75-103
export async function getRelationshipsForEntity(
  client: PoolClient, entityId: number, direction: "outgoing" | "incoming" | "both" = "both", limit = 50,
): Promise<Record<string, unknown>[]> {
  if (direction === "outgoing") {
    return (await client.query(
      `SELECT r.*, e.name AS target_name, e.type AS target_type FROM relationships r
       JOIN entities e ON e.id = r.target_entity_id WHERE r.source_entity_id = $1 ORDER BY r.weight DESC LIMIT $2`,
      [entityId, limit])).rows as Record<string, unknown>[];
  }
  if (direction === "incoming") {
    return (await client.query(
      `SELECT r.*, e.name AS source_name, e.type AS source_type FROM relationships r
       JOIN entities e ON e.id = r.source_entity_id WHERE r.target_entity_id = $1 ORDER BY r.weight DESC LIMIT $2`,
      [entityId, limit])).rows as Record<string, unknown>[];
  }
  return (await client.query(
    "SELECT r.* FROM relationships r WHERE r.source_entity_id = $1 OR r.target_entity_id = $1 ORDER BY r.weight DESC LIMIT $2",
    [entityId, entityId, limit])).rows as Record<string, unknown>[];
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_relationships.py:105-112
export async function getAllRelationships(client: PoolClient): Promise<Record<string, unknown>[]> {
  return (await client.query(
    `SELECT id, source_entity_id, target_entity_id, relationship_type, weight,
            is_causal, confidence, release_probability, facilitation, depression, last_reinforced
     FROM relationships`)).rows as Record<string, unknown>[];
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_relationships.py:114-122
export async function getRelationshipCounts(client: PoolClient): Promise<Map<number, number>> {
  const result = await client.query<{ entity_id: number; cnt: number }>(
    `SELECT entity_id, COUNT(*) AS cnt FROM (SELECT source_entity_id AS entity_id FROM relationships UNION ALL SELECT target_entity_id AS entity_id FROM relationships) sub GROUP BY entity_id`);
  const out = new Map<number, number>();
  for (const row of result.rows) out.set(row.entity_id, row.cnt);
  return out;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_relationships.py:124-131
export async function getEntityRelationshipPairs(client: PoolClient): Promise<Set<string>> {
  const result = await client.query<{ source_name: string; target_name: string }>(
    `SELECT e1.name AS source_name, e2.name AS target_name FROM relationships r
     JOIN entities e1 ON r.source_entity_id = e1.id JOIN entities e2 ON r.target_entity_id = e2.id`);
  return new Set(result.rows.map((r) => `${r.source_name}\0${r.target_name}`));
}

// Source: docs/program/phase-5-pool-admission-design.md Phase 2 B3.
// source: cortex@ed33435 mcp_server/infrastructure/pg_store_relationships.py:133-207
export async function reinforceOrCreateRelationship(
  client: PoolClient, sourceName: string, targetName: string, deltaWeight = 0.1, relType = "co_retrieval",
): Promise<void> {
  const src = (await client.query<{ id: number }>("SELECT id FROM entities WHERE LOWER(name) = LOWER($1) LIMIT 1", [sourceName])).rows[0];
  const tgt = (await client.query<{ id: number }>("SELECT id FROM entities WHERE LOWER(name) = LOWER($1) LIMIT 1", [targetName])).rows[0];
  if (src == null || tgt == null) return;
  const sid = src.id;
  const tid = tgt.id;

  // source: cortex@ed33435 mcp_server/infrastructure/pg_store_relationships.py:168
  // 0.05 heat bump on co-activation (empirical default from Python source)
  const HEAT_BUMP = 0.05; // source: cortex@ed33435 mcp_server/infrastructure/pg_store_relationships.py:168
  await client.query(`UPDATE entities SET last_accessed = NOW(), heat = LEAST(1.0, heat + $1) WHERE id IN ($2, $3)`, [HEAT_BUMP, sid, tid]);

  if (relType === "co_retrieval") {
    const a = Math.min(sid, tid);
    const b = Math.max(sid, tid);
    // source: cortex@ed33435 mcp_server/infrastructure/pg_store_relationships.py:183
    // 0.05 facilitation increment on co-retrieval reinforcement
    const FAC_STEP = 0.05; // source: cortex@ed33435 mcp_server/infrastructure/pg_store_relationships.py:183
    await client.query(
      `INSERT INTO relationships (source_entity_id, target_entity_id, relationship_type, weight, facilitation, last_reinforced)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (source_entity_id, target_entity_id, relationship_type)
       WHERE relationship_type = 'co_retrieval'
       DO UPDATE SET weight = LEAST(2.0, relationships.weight + EXCLUDED.weight),
         facilitation = LEAST(1.0, relationships.facilitation + $5), last_reinforced = NOW()`,
      [a, b, relType, deltaWeight, FAC_STEP]);
    return;
  }
  // source: cortex@ed33435 mcp_server/infrastructure/pg_store_relationships.py:192-196
  // 0.05 facilitation increment — empirical default from Python source
  const updated = await client.query(
    `UPDATE relationships SET weight = LEAST(2.0, weight + $1), facilitation = LEAST(1.0, facilitation + 0.05), last_reinforced = NOW()
     WHERE source_entity_id = $2 AND target_entity_id = $3 AND relationship_type = $4`,
    [deltaWeight, sid, tid, relType]);
  if ((updated.rowCount ?? 0) === 0) {
    await client.query(
      "INSERT INTO relationships (source_entity_id, target_entity_id, relationship_type, weight) VALUES ($1, $2, $3, $4)",
      [sid, tid, relType, deltaWeight]);
  }
}
