/**
 * pg-store-auxiliary.ts — Auxiliary persistence: prospective memories,
 * checkpoints, archives, engram slots, schemas.
 * source: cortex@ed33435 mcp_server/infrastructure/pg_store_auxiliary.py
 */
import type { PoolClient } from "pg";

export interface ProspectiveMemoryData {
  content: string; trigger_condition: string; trigger_type: string;
  target_directory?: string | null; is_active?: boolean; triggered_count?: number;
}
export interface CheckpointData {
  session_id?: string; directory_context?: string; current_task?: string;
  files_being_edited?: unknown[]; key_decisions?: unknown[]; open_questions?: unknown[];
  next_steps?: unknown[]; active_errors?: unknown[]; custom_context?: string; epoch?: number;
}
export interface ArchiveData {
  original_memory_id: number; content: string;
  embedding?: Buffer | null; mismatch_score?: number; archive_reason?: string;
}
export interface SchemaData {
  schema_id: string; domain?: string; label?: string;
  entity_signature?: Record<string, unknown>; relationship_types?: unknown[];
  tag_signature?: Record<string, unknown>; consistency_threshold?: number;
  formation_count?: number; assimilation_count?: number; violation_count?: number;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_auxiliary.py:22-38
export async function insertProspectiveMemory(client: PoolClient, data: ProspectiveMemoryData): Promise<number> {
  const result = await client.query<{ id: number }>(
    `INSERT INTO prospective_memories (content, trigger_condition, trigger_type, target_directory, is_active, triggered_count)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [data.content, data.trigger_condition, data.trigger_type, data.target_directory ?? null, data.is_active ?? true, data.triggered_count ?? 0],
  );
  const row = result.rows[0];
  if (row == null) throw new Error("insertProspectiveMemory: no id returned");
  return row.id;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_auxiliary.py:40-44
export async function getActiveProspectiveMemories(client: PoolClient): Promise<Record<string, unknown>[]> {
  const result = await client.query("SELECT * FROM prospective_memories WHERE is_active");
  return result.rows as Record<string, unknown>[];
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_auxiliary.py:46-53
export async function triggerProspectiveMemory(client: PoolClient, pmId: number): Promise<void> {
  await client.query(
    `UPDATE prospective_memories SET triggered_at = NOW(), triggered_count = triggered_count + 1 WHERE id = $1`,
    [pmId],
  );
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_auxiliary.py:54-59
export async function deactivateProspectiveMemory(client: PoolClient, pmId: number): Promise<void> {
  await client.query("UPDATE prospective_memories SET is_active = FALSE WHERE id = $1", [pmId]);
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_auxiliary.py:63-86
export async function insertCheckpoint(client: PoolClient, data: CheckpointData): Promise<number> {
  await client.query("UPDATE checkpoints SET is_active = FALSE");
  const result = await client.query<{ id: number }>(
    `INSERT INTO checkpoints (session_id, directory_context, current_task, files_being_edited,
       key_decisions, open_questions, next_steps, active_errors, custom_context, epoch, is_active)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, TRUE) RETURNING id`,
    [
      data.session_id ?? "default", data.directory_context ?? "", data.current_task ?? "",
      JSON.stringify(data.files_being_edited ?? []), JSON.stringify(data.key_decisions ?? []),
      JSON.stringify(data.open_questions ?? []), JSON.stringify(data.next_steps ?? []),
      JSON.stringify(data.active_errors ?? []), data.custom_context ?? "", data.epoch ?? 0,
    ],
  );
  const row = result.rows[0];
  if (row == null) throw new Error("insertCheckpoint: no id returned");
  return row.id;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_auxiliary.py:88-92
export async function getActiveCheckpoint(client: PoolClient): Promise<Record<string, unknown> | null> {
  const result = await client.query("SELECT * FROM checkpoints WHERE is_active ORDER BY created_at DESC LIMIT 1");
  return (result.rows[0] as Record<string, unknown> | undefined) ?? null;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_auxiliary.py:94-96
export async function getCurrentEpoch(client: PoolClient): Promise<number> {
  const result = await client.query<{ e: number | null }>("SELECT MAX(epoch) AS e FROM checkpoints");
  return result.rows[0]?.e ?? 0;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_auxiliary.py:98-110
export async function incrementEpoch(client: PoolClient): Promise<number> {
  const current = await getCurrentEpoch(client);
  const newEpoch = current + 1;
  await client.query(
    `INSERT INTO checkpoints (session_id, directory_context, current_task, files_being_edited,
       key_decisions, open_questions, next_steps, active_errors, custom_context, epoch, is_active)
     VALUES ('epoch-sentinel', '', $1, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '', $2, FALSE)`,
    [`epoch-boundary:${newEpoch}`, newEpoch],
  );
  return newEpoch;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_auxiliary.py:114-132
export async function insertArchive(
  client: PoolClient, data: ArchiveData,
  bytesToVector: (buf: Buffer | null | undefined) => string | null,
): Promise<number> {
  const emb = bytesToVector(data.embedding ?? null);
  const result = await client.query<{ id: number }>(
    `INSERT INTO memory_archives (original_memory_id, content, embedding, mismatch_score, archive_reason)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [data.original_memory_id, data.content, emb, data.mismatch_score ?? 0.0, data.archive_reason ?? ""],
  );
  const row = result.rows[0];
  if (row == null) throw new Error("insertArchive: no id returned");
  return row.id;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_auxiliary.py:134-140
export async function getArchivesForMemory(client: PoolClient, memoryId: number): Promise<Record<string, unknown>[]> {
  const result = await client.query(
    "SELECT * FROM memory_archives WHERE original_memory_id = $1 ORDER BY archived_at DESC",
    [memoryId],
  );
  return result.rows as Record<string, unknown>[];
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_auxiliary.py:144-155
export async function initEngramSlots(client: PoolClient, numSlots: number): Promise<void> {
  const countResult = await client.query<{ c: number }>("SELECT COUNT(*) AS c FROM engram_slots");
  const existing = countResult.rows[0]?.c ?? 0;
  if (existing >= numSlots) return;
  for (let i = existing; i < numSlots; i++) {
    await client.query(
      "INSERT INTO engram_slots (slot_index, excitability) VALUES ($1, 0.5) ON CONFLICT DO NOTHING",
      [i],
    );
  }
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_auxiliary.py:157-161
export async function getAllEngramSlots(client: PoolClient): Promise<Record<string, unknown>[]> {
  return (await client.query("SELECT * FROM engram_slots ORDER BY slot_index")).rows as Record<string, unknown>[];
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_auxiliary.py:163-168
export async function getEngramSlot(client: PoolClient, slotIndex: number): Promise<Record<string, unknown> | null> {
  const result = await client.query("SELECT * FROM engram_slots WHERE slot_index = $1", [slotIndex]);
  return (result.rows[0] as Record<string, unknown> | undefined) ?? null;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_auxiliary.py:170-178
export async function updateEngramSlot(client: PoolClient, slotIndex: number, excitability: number, lastActivated: string): Promise<void> {
  await client.query(
    "UPDATE engram_slots SET excitability = $1, last_activated = $2 WHERE slot_index = $3",
    [excitability, lastActivated, slotIndex],
  );
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_auxiliary.py:180-185
export async function assignMemorySlot(client: PoolClient, memoryId: number, slotIndex: number): Promise<void> {
  await client.query("UPDATE memories SET slot_index = $1 WHERE id = $2", [slotIndex, memoryId]);
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_auxiliary.py:187-192
export async function getMemoriesInSlot(client: PoolClient, slotIndex: number): Promise<Record<string, unknown>[]> {
  return (await client.query("SELECT * FROM memories WHERE slot_index = $1", [slotIndex])).rows as Record<string, unknown>[];
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_auxiliary.py:194-216
export async function countMemoriesInSlot(client: PoolClient, slotIndex: number, excludeId?: number | null): Promise<number> {
  const result = excludeId != null
    ? await client.query<{ c: number }>("SELECT COUNT(*) AS c FROM memories WHERE slot_index = $1 AND id != $2", [slotIndex, excludeId])
    : await client.query<{ c: number }>("SELECT COUNT(*) AS c FROM memories WHERE slot_index = $1", [slotIndex]);
  return result.rows[0]?.c ?? 0;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_auxiliary.py:218-223
export async function getSlotOccupancy(client: PoolClient): Promise<Map<number, number>> {
  const result = await client.query<{ slot_index: number; c: number }>(
    "SELECT slot_index, COUNT(*) AS c FROM memories WHERE slot_index IS NOT NULL GROUP BY slot_index",
  );
  const out = new Map<number, number>();
  for (const row of result.rows) out.set(row.slot_index, row.c);
  return out;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_auxiliary.py:227-283
export async function insertSchema(client: PoolClient, data: SchemaData): Promise<number> {
  try {
    const result = await client.query<{ id: number }>(
      `INSERT INTO schemas (schema_id, domain, label, entity_signature, relationship_types, tag_signature,
         consistency_threshold, formation_count, assimilation_count, violation_count)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8, $9, $10) RETURNING id`,
      [
        data.schema_id, data.domain ?? "", data.label ?? "",
        JSON.stringify(data.entity_signature ?? {}), JSON.stringify(data.relationship_types ?? []),
        JSON.stringify(data.tag_signature ?? {}),
// source: cortex@ed33435 mcp_server/infrastructure/pg_store_auxiliary.py:240
        data.consistency_threshold ?? 0.7, data.formation_count ?? 0, // eslint-disable-line @typescript-eslint/no-magic-numbers
        data.assimilation_count ?? 0, data.violation_count ?? 0,
      ],
    );
    const row = result.rows[0];
    if (row == null) throw new Error("insertSchema: no id returned");
    return row.id;
  } catch (err: unknown) {
    // FAILS_ON: PostgreSQL unique_violation when schema_id already exists.
    // source: PostgreSQL error codes appendix — code 23505 = unique_violation
    // https://www.postgresql.org/docs/current/errcodes-appendix.html
    const code = (err as { code?: string }).code;
    // source: PostgreSQL error codes appendix — https://www.postgresql.org/docs/current/errcodes-appendix.html
    if (code === "23505") return _updateExistingSchema(client, data); // source: 23505 = unique_violation
    throw err;
  }
}

async function _updateExistingSchema(client: PoolClient, data: SchemaData): Promise<number> {
  await client.query(
    `UPDATE schemas SET domain = $1, label = $2, entity_signature = $3::jsonb,
        relationship_types = $4::jsonb, tag_signature = $5::jsonb,
        consistency_threshold = $6, formation_count = $7, assimilation_count = $8,
        violation_count = $9, last_updated = NOW() WHERE schema_id = $10`,
    [
      data.domain ?? "", data.label ?? "",
      JSON.stringify(data.entity_signature ?? {}), JSON.stringify(data.relationship_types ?? []),
      JSON.stringify(data.tag_signature ?? {}),
// source: cortex@ed33435 mcp_server/infrastructure/pg_store_auxiliary.py:265
      data.consistency_threshold ?? 0.7, data.formation_count ?? 0, // eslint-disable-line @typescript-eslint/no-magic-numbers
      data.assimilation_count ?? 0, data.violation_count ?? 0, data.schema_id,
    ],
  );
  const select = await client.query<{ id: number }>("SELECT id FROM schemas WHERE schema_id = $1", [data.schema_id]);
  return select.rows[0]?.id ?? 0;
}

// source: cortex@ed33435 mcp_server/infrastructure/pg_store_auxiliary.py:285-305
export async function getSchemasForDomain(client: PoolClient, domain: string): Promise<Record<string, unknown>[]> {
  return (await client.query("SELECT * FROM schemas WHERE domain = $1 ORDER BY formation_count DESC", [domain])).rows as Record<string, unknown>[];
}
export async function getAllSchemas(client: PoolClient): Promise<Record<string, unknown>[]> {
  return (await client.query("SELECT * FROM schemas ORDER BY formation_count DESC")).rows as Record<string, unknown>[];
}
export async function countSchemas(client: PoolClient): Promise<number> {
  return (await client.query<{ c: number }>("SELECT COUNT(*) AS c FROM schemas")).rows[0]?.c ?? 0;
}
export async function deleteSchema(client: PoolClient, schemaId: string): Promise<boolean> {
  return ((await client.query("DELETE FROM schemas WHERE schema_id = $1", [schemaId])).rowCount ?? 0) > 0;
}
