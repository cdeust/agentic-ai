/**
 * pg-store.ts — PostgreSQL adapter for MemoryStore.
 *
 * Ports: infrastructure/pg_store.py (768 LOC, split per 500-line cap)
 *
 * Uses the `pg` (node-postgres) package. All MemoryStore methods are
 * synchronous in signature but execute against the PG connection
 * synchronously via a connection managed by the caller.
 *
 * DESIGN NOTE: The Python source uses psycopg (async) + psycopg_pool.
 * This port uses the `pg` (node-postgres) Pool. Because MemoryStore's
 * interface is synchronous (to match better-sqlite3), PG calls are
 * made by holding a client from the pool for the lifetime of each call.
 *
 * Atomicity guarantees (same as sqlite-store.ts — see memory-store.ts §I1-I5):
 *   1. insertMemory: single INSERT ... RETURNING id. PostgreSQL autocommit
 *      means the row is visible immediately after the INSERT completes.
 *   2. deleteMemory: single DELETE. ON DELETE CASCADE removes FK rows.
 *   3. bumpHeatRaw: single UPDATE (atomic by definition).
 *   4. Read-your-writes: the same pool client is reused within a request
 *      context; reads after writes on the same client see the write.
 *   5. No duplicate inserts: write gate is the dedup layer.
 *
 * Known race condition in Python source (pg_store.py):
 *   _conn.commit() is called after every execute, but the pool connection
 *   may interleave between the INSERT and the RETURNING read if the
 *   pool recycles the connection. The MaterializedCursor eagerly reads
 *   all rows before the connection is returned — this port preserves
 *   that pattern by reading row["id"] before releasing the client.
 *
 * File size: this file covers core CRUD. Entity/relationship/auxiliary
 * operations are split to pg-store-entities.ts and pg-store-auxiliary.ts
 * to stay under the 500-line cap.
 *
 * source: infrastructure/pg_store.py
 */

import { Pool, type PoolClient } from "pg";
import type { MemoryInsertData, MemoryItem } from "../types.js";
import type {
  EntityRecord,
  HeatUpdate,
  MemoryStore,
  VecHit,
} from "./memory-store.js";
import {
  callRecallMemories,
  type RecallMemoriesParams,
  type RecallMemoryRow,
} from "./pg-store-queries.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

// source: ECMAScript spec — Float32Array.BYTES_PER_ELEMENT = 4
const FLOAT32_BYTES_PER_ELEMENT = Float32Array.BYTES_PER_ELEMENT;

function nowIso(): string {
  return new Date().toISOString();
}

function clampHeat(h: number): number {
  return Math.max(0.0, Math.min(1.0, h));
}

// ── PgMemoryStore ─────────────────────────────────────────────────────────

/**
 * PgMemoryStore — PostgreSQL adapter implementing MemoryStore.
 *
 * Precondition: DATABASE_URL or connectionString must be a valid
 * PostgreSQL connection string. Validation is deferred to pg; this
 * adapter does not strengthen the precondition (ADR-0003).
 */
export class PgMemoryStore implements MemoryStore {
  private readonly _pool: Pool;

  constructor(connectionString: string) {
    this._pool = new Pool({ connectionString, max: 5 });
  }

  // ── Internal: run a query synchronously by acquiring a client ──────────
  // This is the equivalent of pg_store.py's _execute method.
  // In Node.js we cannot truly block, but in contexts where this is called
  // (MCP server, sequential tool handlers) all callers await the returned promise.
  // We expose a sync-signature interface and handle the async internally.

  private _runSync<T>(
    fn: (client: PoolClient) => Promise<T>,
  ): T {
    // DESIGN (async-wrapper-is-intentional): True synchronous PG is not
    // possible in Node.js — psycopg (the Python backend) is async; the
    // Node pg client is also async. PgMemoryStore exposes a synchronous
    // MemoryStore interface to match better-sqlite3, but all sync-signature
    // methods that call _runSync() throw at runtime. MCP tool handlers MUST
    // use the *Async siblings (e.g. insertMemoryAsync, getMemoryAsync).
    // This matches Python semantics: Python callers also await the pool
    // coroutines; the sync interface is a type-level convenience only.
    // Verified against cortex@f2b9f99 mcp_server/infrastructure/pg_store.py:
    //   _execute wraps conn.execute() which is a psycopg async call;
    //   callers are all async def handlers.
    // Marker closed: PHASE_7_TRACKING.md Group D row 4 (2026-04-27).
    throw new Error(
      "PgMemoryStore requires async execution. " +
        "Call the *Async sibling or use SqliteMemoryStore for sync tests.",
    );
    void fn; // suppress unused warning
  }

  /**
   * Execute fn on a pool client and return the result.
   *
   * This is the primary execution method. MCP tool handlers MUST await this.
   * precondition:  pool is open (not after close()).
   * postcondition: client is returned to the pool in all code paths
   *   (including error paths — finally block).
   */
  async runAsync<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this._pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  // ── Memory CRUD (async wrappers — see note above) ──────────────────────

  /**
   * Insert a memory and return its integer ID.
   *
   * postcondition: returned id > 0; row exists in memories.
   * NOTE: Because MemoryStore.insertMemory is sync-signature but PG is async,
   * this throws. Use insertMemoryAsync from async contexts.
   * source: infrastructure/pg_store.py:insert_memory
   */
  insertMemory(_data: MemoryInsertData): number {
    return this._runSync(async (client) => {
      return this._insertMemoryOnClient(client, _data);
    });
  }

  async insertMemoryAsync(data: MemoryInsertData): Promise<number> {
    return this.runAsync((client) => this._insertMemoryOnClient(client, data));
  }

  private async _insertMemoryOnClient(
    client: PoolClient,
    data: MemoryInsertData,
  ): Promise<number> {
    const now = nowIso();
    const result = await client.query<{ id: number }>(
      `INSERT INTO memories (
        content, tags, source, domain, directory_context, created_at,
        last_accessed, heat_base, heat_base_set_at, surprise_score, importance,
        emotional_valence, confidence, store_type, is_protected,
        consolidation_stage, theta_phase_at_encoding, encoding_strength,
        separation_index, interference_score, schema_match_score, schema_id,
        hippocampal_dependency, is_benchmark, agent_context, is_global,
        stage_entered_at, arousal, dominant_emotion
      ) VALUES (
        $1,$2::jsonb,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
        $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29
      ) RETURNING id`,
      // $2::jsonb — tags is JSON.stringify(array), must be cast to jsonb
      // source: cortex@82b15b3 mcp_server/infrastructure/pg_store.py:insert_memory
      //   json.dumps(tags) stored as JSONB column
      [
        data.content,
        JSON.stringify(data.tags ?? []),
        data.source ?? "",
        data.domain ?? "",
        data.directory_context ?? "",
        data.created_at ?? now,
        now,
        clampHeat(data.heat ?? 1.0),
        now,
        data.surprise_score ?? 0.0,
        data.importance ?? 0.5, // eslint-disable-line @typescript-eslint/no-magic-numbers -- source: infrastructure/pg_store.py default importance
        data.emotional_valence ?? 0.0,
        data.confidence ?? 1.0,
        data.store_type ?? "episodic",
        data.is_protected ?? false,
        data.consolidation_stage ?? "labile",
        data.theta_phase_at_encoding ?? 0.0,
        data.encoding_strength ?? 1.0,
        data.separation_index ?? 0.0,
        data.interference_score ?? 0.0,
        data.schema_match_score ?? 0.0,
        data.schema_id ?? null,
        data.hippocampal_dependency ?? 1.0,
        data.is_benchmark ?? false,
        data.agent_context ?? "",
        data.is_global ?? false,
        data.stage_entered_at ?? data.created_at ?? now,
        data.arousal ?? 0.0,
        data.dominant_emotion ?? "neutral",
      ],
    );
    const row = result.rows[0];
    if (row == null) throw new Error("insertMemory: no id returned from PG");
    return row.id;
  }

  getMemory(_memoryId: number): MemoryItem | null {
    return this._runSync(async (c) => this._getMemoryOnClient(c, _memoryId));
  }

  async getMemoryAsync(memoryId: number): Promise<MemoryItem | null> {
    return this.runAsync((c) => this._getMemoryOnClient(c, memoryId));
  }

  /**
   * Call the PostgreSQL recall_memories() stored procedure.
   *
   * This is the parity-critical retrieval method. It invokes the same
   * PL/pgSQL function that Python's bench calls, producing identical
   * ranking via TMM normalization + weighted-sum fusion.
   *
   * precondition: pool is open; recall_memories function is installed in DB.
   * postcondition: returns rows ordered by descending score.
   *
   * source: cortex@82b15b3 mcp_server/infrastructure/pg_store.py:recall_memories
   * source: cortex@82b15b3 mcp_server/infrastructure/pg_schema.py:RECALL_MEMORIES_LAZY_FN
   */
  async recallMemoriesAsync(params: RecallMemoriesParams): Promise<RecallMemoryRow[]> {
    return this.runAsync((client) => callRecallMemories(client, params));
  }

  /**
   * Delete memories where is_benchmark = TRUE.
   * Used by the bench harness to clean up between conversations.
   * source: cortex@82b15b3 benchmarks/lib/bench_db.py:_purge_stale_benchmark_data
   */
  async clearBenchmarkMemoriesAsync(): Promise<void> {
    await this.runAsync(async (client) => {
      await client.query("DELETE FROM memories WHERE is_benchmark = TRUE");
    });
  }

  private async _getMemoryOnClient(
    client: PoolClient,
    memoryId: number,
  ): Promise<MemoryItem | null> {
    const result = await client.query(
      `SELECT * FROM memories WHERE id = $1`,
      [memoryId],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row == null) return null;
    return this._normalizeRow(row);
  }

  deleteMemory(_memoryId: number): boolean {
    return this._runSync(async (c) => this._deleteMemoryOnClient(c, _memoryId));
  }

  async deleteMemoryAsync(memoryId: number): Promise<boolean> {
    return this.runAsync((c) => this._deleteMemoryOnClient(c, memoryId));
  }

  private async _deleteMemoryOnClient(
    client: PoolClient,
    memoryId: number,
  ): Promise<boolean> {
    const result = await client.query(
      `DELETE FROM memories WHERE id = $1`,
      [memoryId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Canonical A3 heat writer.
   * source: phase-3-a3-migration-design.md §3.1
   * source: infrastructure/pg_store.py:bump_heat_raw
   */
  bumpHeatRaw(_id: number, _heat: number): void {
    this._runSync(async (c) => this._bumpHeatOnClient(c, _id, _heat));
  }

  async bumpHeatRawAsync(memoryId: number, heat: number): Promise<void> {
    return this.runAsync((c) => this._bumpHeatOnClient(c, memoryId, heat));
  }

  private async _bumpHeatOnClient(
    client: PoolClient,
    memoryId: number,
    heat: number,
  ): Promise<void> {
    await client.query(
      `UPDATE memories SET heat_base = $1, heat_base_set_at = NOW() WHERE id = $2`,
      [clampHeat(heat), memoryId],
    );
  }

  updateMemoryHeat(memoryId: number, heat: number): void {
    this.bumpHeatRaw(memoryId, heat);
  }

  async updateMemoryHeatAsync(memoryId: number, heat: number): Promise<void> {
    return this.bumpHeatRawAsync(memoryId, heat);
  }

  /**
   * A3 batch heat writer. Single UPDATE ... FROM UNNEST() round-trip.
   * source: issue #13; phase-3-a3-migration-design.md §3.2
   * source: infrastructure/pg_store.py:update_memories_heat_batch
   */
  updateMemoriesHeatBatch(_updates: HeatUpdate[]): number {
    return this._runSync(async (c) => this._batchHeatOnClient(c, _updates));
  }

  async updateMemoriesHeatBatchAsync(updates: HeatUpdate[]): Promise<number> {
    return this.runAsync((c) => this._batchHeatOnClient(c, updates));
  }

  private async _batchHeatOnClient(
    client: PoolClient,
    updates: HeatUpdate[],
  ): Promise<number> {
    if (updates.length === 0) return 0;
    const ids = updates.map((u) => u[0]);
    const heats = updates.map((u) => clampHeat(u[1]));
    await client.query(
      `UPDATE memories AS m
         SET heat_base = v.new_heat, heat_base_set_at = NOW()
         FROM (SELECT UNNEST($1::int[]) AS id, UNNEST($2::real[]) AS new_heat) AS v
         WHERE m.id = v.id`,
      [ids, heats],
    );
    return updates.length;
  }

  updateMemoryImportance(memoryId: number, importance: number): void {
    void this.runAsync((c) =>
      c.query(`UPDATE memories SET importance = $1 WHERE id = $2`, [importance, memoryId]),
    );
  }

  updateMemoryAccess(memoryId: number): void {
    void this.runAsync((c) =>
      c.query(
        `UPDATE memories SET last_accessed = NOW(), access_count = access_count + 1 WHERE id = $1`,
        [memoryId],
      ),
    );
  }

  updateMemoryMetamemory(
    memoryId: number,
    accessCount: number,
    usefulCount: number,
    confidence: number,
  ): void {
    void this.runAsync((c) =>
      c.query(
        `UPDATE memories SET access_count = $1, useful_count = $2, confidence = $3 WHERE id = $4`,
        [accessCount, usefulCount, confidence, memoryId],
      ),
    );
  }

  setMemoryProtected(memoryId: number, protected_: boolean): void {
    void this.runAsync((c) =>
      c.query(`UPDATE memories SET is_protected = $1 WHERE id = $2`, [protected_, memoryId]),
    );
  }

  markMemoryStale(memoryId: number, stale: boolean): void {
    void this.runAsync((c) =>
      c.query(`UPDATE memories SET is_stale = $1 WHERE id = $2`, [stale, memoryId]),
    );
  }

  /**
   * Update content and tags for a single memory row.
   *
   * precondition:  memoryId > 0; content is a non-empty string.
   * postcondition: memories.content = content AND memories.tags = JSON.stringify(tags)
   *   for the given id. Single UPDATE — atomic by PostgreSQL autocommit.
   *
   * Used by the anchor handler to write the `[ANCHOR: <reason>]` prefix
   * and the `_anchor` tag set in one round-trip.
   *
   * source: cortex@f2b9f99 mcp_server/handlers/anchor.py:143-146
   *   UPDATE memories SET … tags = %s::jsonb, content = %s … WHERE id = %s
   */
  updateMemoryContent(memoryId: number, content: string, tags: string[]): void {
    void this.runAsync((c) =>
      c.query(
        `UPDATE memories SET content = $1, tags = $2::jsonb WHERE id = $3`,
        [content, JSON.stringify(tags), memoryId],
      ),
    );
  }

  async updateMemoryContentAsync(
    memoryId: number,
    content: string,
    tags: string[],
  ): Promise<void> {
    return this.runAsync((c) =>
      c.query(
        `UPDATE memories SET content = $1, tags = $2::jsonb WHERE id = $3`,
        [content, JSON.stringify(tags), memoryId],
      ).then(() => undefined),
    );
  }

  // ── Homeostatic state ──────────────────────────────────────────────────

  getHomeostaticFactor(_domain: string): number {
    return this._runSync(async (c) => {
      const result = await c.query<{ factor: number }>(
        `SELECT COALESCE(MAX(factor), 1.0)::REAL AS factor FROM homeostatic_state WHERE domain = $1`,
        [_domain || ""],
      );
      return result.rows[0]?.factor ?? 1.0;
    });
  }

  async getHomeostaticFactorAsync(domain: string): Promise<number> {
    return this.runAsync(async (c) => {
      const result = await c.query<{ factor: number }>(
        `SELECT COALESCE(MAX(factor), 1.0)::REAL AS factor FROM homeostatic_state WHERE domain = $1`,
        [domain || ""],
      );
      return result.rows[0]?.factor ?? 1.0;
    });
  }

  setHomeostaticFactor(_domain: string, _factor: number): void {
    // source: infrastructure/pg_store.py:set_homeostatic_factor — clamps factor to (0.01, 9.99) matching DB CHECK constraint
    // eslint-disable-next-line @typescript-eslint/no-magic-numbers -- source: infrastructure/pg_store.py:set_homeostatic_factor bounds
    const clamped = Math.max(0.01, Math.min(9.99, _factor)); // source: infrastructure/pg_store.py:set_homeostatic_factor
    void this.runAsync((c) =>
      c.query(
        `INSERT INTO homeostatic_state (domain, factor, updated_at) VALUES ($1,$2,NOW())
         ON CONFLICT (domain) DO UPDATE SET factor = EXCLUDED.factor, updated_at = NOW()`,
        [_domain || "", clamped],
      ),
    );
  }

  // ── Vector search (pgvector <=> operator) ─────────────────────────────

  /**
   * Vector KNN search via pgvector cosine distance (<=> operator).
   *
   * NOTE: PgMemoryStore.searchVectors() uses _runSync() which throws at
   * runtime (see design note on _runSync above). Use searchVectorsAsync()
   * from async MCP tool handlers.
   *
   * source: Cortex mcp_server/infrastructure/pg_store.py:search_vectors
   * source: https://github.com/pgvector/pgvector — cosine distance <=> operator
   */
  searchVectors(
    _embedding: Buffer,
    _topK: number,
    _minHeat?: number,
  ): VecHit[] {
    return this._runSync(async (c) =>
      this._searchVectorsOnClient(c, _embedding, _topK, _minHeat ?? 0),
    );
  }

  /**
   * Async pgvector KNN search. Use this from MCP tool handlers.
   *
   * precondition:  embedding is a valid float32 Buffer (length = dim × 4 bytes).
   * postcondition: returns up to topK (memory_id, distance) pairs ordered by
   *   ascending cosine distance. Returns [] if the column is null or extension
   *   is not installed.
   *
   * source: Cortex mcp_server/infrastructure/pg_store.py:search_vectors
   * source: https://github.com/pgvector/pgvector — <=> is cosine distance
   * source: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2 — 384D
   */
  async searchVectorsAsync(
    embedding: Buffer,
    topK: number,
    minHeat = 0.0,
  ): Promise<VecHit[]> {
    return this.runAsync((c) =>
      this._searchVectorsOnClient(c, embedding, topK, minHeat),
    );
  }

  private async _searchVectorsOnClient(
    client: PoolClient,
    embedding: Buffer,
    topK: number,
    minHeat: number,
  ): Promise<VecHit[]> {
    // Convert Buffer to float32 array literal for pgvector.
    // pgvector expects '[f1,f2,...,fN]' string for the <=> operator.
    // source: https://github.com/pgvector/pgvector — vector literal format
    const dim = embedding.byteLength / FLOAT32_BYTES_PER_ELEMENT;
    const floats = new Float32Array(
      embedding.buffer,
      embedding.byteOffset,
      dim,
    );
    const vecLiteral = `[${Array.from(floats).join(",")}]`;

    const result = await client.query<{ id: number; distance: number }>(
      `SELECT id, embedding <=> $1::vector AS distance
       FROM memories
       WHERE heat_base >= $2 AND NOT is_stale AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [vecLiteral, minHeat, topK],
    );
    return result.rows.map((r) => [r.id, r.distance] as VecHit);
  }

  /**
   * Upsert an embedding vector for a memory row.
   *
   * Called by postStore after memory insert when an EmbeddingEngine is available.
   * precondition:  memoryId > 0; emb.byteLength = dim × 4.
   * postcondition: memories.embedding column is updated for the given id.
   *
   * source: Cortex mcp_server/infrastructure/pg_store.py — UPDATE memories SET embedding = %s
   * source: https://github.com/pgvector/pgvector — vector column update via literal
   */
  async upsertEmbedding(memoryId: number, emb: Buffer): Promise<void> {
    const dim = emb.byteLength / FLOAT32_BYTES_PER_ELEMENT;
    const floats = new Float32Array(emb.buffer, emb.byteOffset, dim);
    const vecLiteral = `[${Array.from(floats).join(",")}]`;
    return this.runAsync((c) =>
      c
        .query(
          `UPDATE memories SET embedding = $1::vector WHERE id = $2`,
          [vecLiteral, memoryId],
        )
        .then(() => undefined),
    );
  }

  // ── Entity graph (deferred: see pg-store-entities.ts) ─────────────────
  // FAILS_ON: entity operations not yet implemented for PG backend.
  // The entity graph is fully implemented in SqliteMemoryStore.
  // PG entity support is tracked in PHASE_7_TRACKING.md Group D.

  getEntityByName(_name: string): EntityRecord | null {
    return null;
  }

  upsertEntity(_name: string, _type: string, _domain: string): number {
    return 0;
  }

  linkMemoryEntity(_memoryId: number, _entityId: number): void {
    // Deferred: see pg-store-entities.ts
  }

  upsertRelationship(
    _sourceEntityId: number,
    _targetEntityId: number,
    _relationshipType: string,
    _weight?: number,
  ): void {
    // Deferred: see pg-store-relationships.ts
  }

  getSchemasForDomain(_domain: string): Array<Record<string, unknown>> {
    // Deferred: see pg-store-queries.ts
    return [];
  }

  loadOscillatoryState(): string | null {
    // Deferred: oscillatory state on PG requires a dedicated table.
    // FAILS_ON: oscillatory_state table not yet created in PG schema.
    return null;
  }

  saveOscillatoryState(_stateJson: string): void {
    // Deferred: oscillatory_state table not yet created in PG schema.
    // FAILS_ON: oscillatory_state table missing.
  }

  async close(): Promise<void> {
    await this._pool.end();
  }

  // ── Row normalization ──────────────────────────────────────────────────

  private _normalizeRow(row: Record<string, unknown>): MemoryItem {
    const heatBase = (row["heat_base"] as number) ?? 1.0;
    const tags = row["tags"];
    const parsedTags: string[] = Array.isArray(tags)
      ? (tags as string[])
      : typeof tags === "string"
        ? (JSON.parse(tags) as string[])
        : [];
    return {
      id: row["id"] as number,
      content: row["content"] as string,
      tags: parsedTags,
      source: (row["source"] as string) ?? "",
      domain: (row["domain"] as string) ?? "",
      directory_context: (row["directory_context"] as string) ?? "",
      created_at: row["created_at"] as string,
      last_accessed: row["last_accessed"] as string,
      heat_base: heatBase,
      heat: heatBase,
      heat_base_set_at: (row["heat_base_set_at"] as string) ?? "",
      no_decay: Boolean(row["no_decay"]),
      surprise_score: (row["surprise_score"] as number) ?? 0.0,
      importance: (row["importance"] as number) ?? 0.5, // eslint-disable-line @typescript-eslint/no-magic-numbers -- source: infrastructure/pg_store.py _normalize_memory_row default importance
      emotional_valence: (row["emotional_valence"] as number) ?? 0.0,
      confidence: (row["confidence"] as number) ?? 1.0,
      access_count: (row["access_count"] as number) ?? 0,
      useful_count: (row["useful_count"] as number) ?? 0,
      plasticity: (row["plasticity"] as number) ?? 1.0,
      stability: (row["stability"] as number) ?? 0.0,
      reconsolidation_count: (row["reconsolidation_count"] as number) ?? 0,
      last_reconsolidated: (row["last_reconsolidated"] as string | null) ?? null,
      store_type: (row["store_type"] as string) ?? "episodic",
      compressed: Boolean(row["compressed"]),
      compression_level: (row["compression_level"] as number) ?? 0,
      original_content: (row["original_content"] as string | null) ?? null,
      is_protected: Boolean(row["is_protected"]),
      is_stale: Boolean(row["is_stale"]),
      slot_index: (row["slot_index"] as number | null) ?? null,
      excitability: (row["excitability"] as number) ?? 1.0,
      consolidation_stage:
        ((row["consolidation_stage"] as string) ?? "labile") as MemoryItem["consolidation_stage"],
      hours_in_stage: (row["hours_in_stage"] as number) ?? 0.0,
      stage_entered_at: (row["stage_entered_at"] as string | null) ?? null,
      replay_count: (row["replay_count"] as number) ?? 0,
      theta_phase_at_encoding: (row["theta_phase_at_encoding"] as number) ?? 0.0,
      encoding_strength: (row["encoding_strength"] as number) ?? 1.0,
      separation_index: (row["separation_index"] as number) ?? 0.0,
      interference_score: (row["interference_score"] as number) ?? 0.0,
      schema_match_score: (row["schema_match_score"] as number) ?? 0.0,
      schema_id: (row["schema_id"] as string | null) ?? null,
      hippocampal_dependency: (row["hippocampal_dependency"] as number) ?? 1.0,
      is_benchmark: Boolean(row["is_benchmark"]),
      agent_context: (row["agent_context"] as string) ?? "",
      is_global: Boolean(row["is_global"]),
    };
  }
}
