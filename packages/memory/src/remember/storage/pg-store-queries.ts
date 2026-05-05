/**
 * pg-store-queries.ts — Memory query operations for PgMemoryStore.
 * source: cortex@ed33435 mcp_server/infrastructure/pg_store_queries.py
 */
import type { PoolClient } from "pg";

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_queries.py:20-28
export async function getMemoriesForDomain(
  client: PoolClient, domain: string,
  minHeat = 0.05, // source: cortex@ed33435 mcp_server/infrastructure/pg_store_queries.py:21
  limit = 50,
): Promise<Record<string, unknown>[]> {
  return (await client.query(
    `SELECT * FROM memories WHERE (domain = $1 OR is_global = TRUE) AND heat_base >= $2 ORDER BY heat_base DESC LIMIT $3`,
    [domain, minHeat, limit])).rows as Record<string, unknown>[];
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_queries.py:30-38
export async function getMemoriesForDirectory(
  client: PoolClient, directory: string,
  minHeat = 0.05, // source: cortex@ed33435 mcp_server/infrastructure/pg_store_queries.py:31
): Promise<Record<string, unknown>[]> {
  return (await client.query(
    `SELECT * FROM memories WHERE (directory_context = $1 OR is_global = TRUE) AND heat_base >= $2 ORDER BY heat_base DESC`,
    [directory, minHeat])).rows as Record<string, unknown>[];
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_queries.py:40-61
export async function getHotMemories(
  client: PoolClient, minHeat = 0.7, limit = 20, includeBenchmarks = false,
): Promise<Record<string, unknown>[]> {
  const f = includeBenchmarks ? "" : "AND NOT coalesce(is_benchmark, FALSE) ";
  if (limit > 0) {
    return (await client.query(`SELECT * FROM memories WHERE heat_base >= $1 ${f}ORDER BY heat_base DESC LIMIT $2`, [minHeat, limit])).rows as Record<string, unknown>[];
  }
  return (await client.query(`SELECT * FROM memories WHERE heat_base >= $1 ${f}ORDER BY heat_base DESC`, [minHeat])).rows as Record<string, unknown>[];
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_queries.py:63-75
export async function getAllMemoriesWithEmbeddings(
  client: PoolClient, vectorToBytes: (v: unknown) => Buffer | null,
): Promise<Record<string, unknown>[]> {
  const result = await client.query("SELECT id, heat_base, embedding FROM memories WHERE embedding IS NOT NULL");
  return result.rows.map((row) => {
    const d = { ...(row as Record<string, unknown>) };
    if (d["embedding"] != null) d["embedding"] = vectorToBytes(d["embedding"]);
    return d;
  });
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_queries.py:77-85
export async function getAllMemoriesForValidation(
  client: PoolClient,
  limit = 1000, // source: cortex@ed33435 mcp_server/infrastructure/pg_store_queries.py:78
): Promise<Record<string, unknown>[]> {
  return (await client.query("SELECT * FROM memories WHERE NOT is_stale ORDER BY last_accessed ASC LIMIT $1", [limit])).rows as Record<string, unknown>[];
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_queries.py:87-95
export async function getMemoriesCreatedAfter(client: PoolClient, isoTimestamp: string, limit = 20): Promise<Record<string, unknown>[]> {
  return (await client.query("SELECT * FROM memories WHERE created_at >= $1 ORDER BY created_at ASC LIMIT $2", [isoTimestamp, limit])).rows as Record<string, unknown>[];
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_queries.py:97-105
export async function getMemoriesInTimeWindow(client: PoolClient, centerTime: string, windowMinutes: number): Promise<Record<string, unknown>[]> {
  return (await client.query(
    `SELECT * FROM memories WHERE ABS(EXTRACT(EPOCH FROM (created_at - $1::timestamptz))) / 60 <= $2`,
    [centerTime, windowMinutes])).rows as Record<string, unknown>[];
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_queries.py:107-109
export async function getAllMemoriesForDecay(client: PoolClient): Promise<Record<string, unknown>[]> {
  return (await client.query("SELECT * FROM memories WHERE NOT is_stale")).rows as Record<string, unknown>[];
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_queries.py:111-152
export async function* iterMemoriesForDecay(
  client: PoolClient,
  chunkSize = 1000, // source: cortex@ed33435 mcp_server/infrastructure/pg_store_queries.py:113
): AsyncGenerator<Record<string, unknown>[]> {
  let offset = 0;
  while (true) {
    const result = await client.query("SELECT * FROM memories WHERE NOT is_stale ORDER BY id LIMIT $1 OFFSET $2", [chunkSize, offset]);
    const rows = result.rows as Record<string, unknown>[];
    if (rows.length === 0) break;
    yield rows;
    if (rows.length < chunkSize) break;
    offset += chunkSize;
  }
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_queries.py:154-193
export async function searchByTagVector(
  client: PoolClient, queryEmbedding: Buffer | null, tag: string,
  domain: string | null = null,
  minHeat = 0.01, // source: cortex@ed33435 mcp_server/infrastructure/pg_store_queries.py:156
  limit = 3,
  bufferToVecLiteral: (buf: Buffer) => string,
): Promise<Record<string, unknown>[]> {
  if (queryEmbedding != null) {
    const vecLiteral = bufferToVecLiteral(queryEmbedding);
    return (await client.query(
      `SELECT *, (1.0 - (embedding <=> $1::vector))::REAL AS score FROM memories
       WHERE tags @> $2::jsonb AND heat_base >= $3 AND NOT is_stale AND embedding IS NOT NULL
       AND (($4::TEXT IS NULL) OR domain = $4 OR is_global = TRUE)
       ORDER BY embedding <=> $1::vector LIMIT $5`,
      [vecLiteral, JSON.stringify([tag]), minHeat, domain, limit])).rows as Record<string, unknown>[];
  }
  return (await client.query(
    `SELECT *, heat_base::REAL AS score FROM memories
     WHERE tags @> $1::jsonb AND heat_base >= $2 AND NOT is_stale
     AND (($3::TEXT IS NULL) OR domain = $3 OR is_global = TRUE)
     ORDER BY heat_base DESC LIMIT $4`,
    [JSON.stringify([tag]), minHeat, domain, limit])).rows as Record<string, unknown>[];
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_queries.py:195-202
export async function deleteMemoriesByTag(client: PoolClient, tag: string): Promise<number> {
  return (await client.query("DELETE FROM memories WHERE tags @> $1::jsonb", [JSON.stringify([tag])])).rowCount ?? 0;
}

// Source: docs/program/phase-5-pool-admission-design.md Phase 2 B1.
// source: cortex@ed33435 mcp_server/infrastructure/pg_store_queries.py:206-236
export async function findCoAccessedPairs(client: PoolClient, memoryIds: number[]): Promise<Array<[number, number]>> {
  if (memoryIds.length === 0) return [];
  const result = await client.query<{ a: number; b: number }>(
    `SELECT DISTINCT LEAST(me1.entity_id, me2.entity_id) AS a, GREATEST(me1.entity_id, me2.entity_id) AS b
     FROM memory_entities me1 JOIN memory_entities me2 ON me1.memory_id = me2.memory_id AND me1.entity_id < me2.entity_id
     WHERE me1.memory_id = ANY($1::int[])`, [memoryIds]);
  return result.rows.map((r) => [r.a, r.b] as [number, number]);
}

// Source: Phase 2 B2; Frey & Morris (1997) synaptic tagging.
// source: cortex@ed33435 mcp_server/infrastructure/pg_store_queries.py:238-258
export async function findSharedEntities(client: PoolClient, memoryId: number, entityIds: number[]): Promise<number[]> {
  if (entityIds.length === 0) return [];
  return (await client.query<{ entity_id: number }>(
    "SELECT entity_id FROM memory_entities WHERE memory_id = $1 AND entity_id = ANY($2::int[])",
    [memoryId, entityIds])).rows.map((r) => r.entity_id);
}
