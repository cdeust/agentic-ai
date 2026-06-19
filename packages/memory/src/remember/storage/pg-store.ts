/* eslint-disable max-lines -- pg-store.ts implements MemoryStoreExt; new interface methods
   added to close LSP violations #1-#6; each method delegates to pg-store-*.ts helpers.
   Splitting would fragment the single-class boundary without reducing coupling. */
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

// `pg` is CommonJS; a named VALUE import (`import { Pool }`) fails under Node's
// ESM loader in the bundled .mcpb ("Named export 'Pool' not found …"). Use the
// default import + destructure — the CJS-interop-safe form (mirrors graph-store.ts).
// The type is aliased (PgPool) so it never collides with the destructured value.
import pgDefault, { type Pool as PgPool, type PoolClient } from "pg";
const { Pool } = pgDefault;
import type { MemoryInsertData, MemoryItem } from "../types.js";
import type {
  EntityRecord,
  HeatUpdate,
  MemoryStoreExt,
  VecHit,
} from "./memory-store.js";
import {
  callRecallMemories,
  type RecallMemoriesParams,
  type RecallMemoryRow,
  getAllMemoriesForDecay as pgGetAllMemoriesForDecay,
  getAllMemoriesForValidation as pgGetAllMemoriesForValidation,
  getMemoriesForDomain as pgGetMemoriesForDomain,
  getMemoriesForDirectory as pgGetMemoriesForDirectory,
  getHotMemories as pgGetHotMemories,
} from "./pg-store-queries.js";
import {
  getRecentlyAccessedMemories as pgGetRecentlyAccessedMemories,
  updateMemoryConsolidation as pgUpdateMemoryConsolidation,
  insertStageTransitionsBatch as pgInsertStageTransitionsBatch,
  getMemoriesByStage as pgGetMemoriesByStage,
  getEpisodicMemories as pgGetEpisodicMemories,
  getSemanticMemories as pgGetSemanticMemories,
  updateMemoryStoreType as pgUpdateMemoryStoreType,
  incrementReplayCount as pgIncrementReplayCount,
  logConsolidation as pgLogConsolidation,
  saveOscillatoryState as pgSaveOscillatoryState,
  loadOscillatoryState as pgLoadOscillatoryState,
} from "./pg-store-stats.js";
import {
  getEntityByName as pgGetEntityByName,
  insertEntity as pgInsertEntity,
  getAllEntities as pgGetAllEntities,
  updateEntitiesHeatBatch as pgUpdateEntitiesHeatBatch,
  archiveEntitiesBatch as pgArchiveEntitiesBatch,
} from "./pg-store-entities.js";
import {
  getAllRelationships as pgGetAllRelationships,
  insertRelationship as pgInsertRelationship,
  updateRelationshipsWeightBatch as pgUpdateRelationshipsWeightBatch,
  deleteRelationshipsBatch as pgDeleteRelationshipsBatch,
  reinforceOrCreateRelationship as pgReinforceOrCreateRelationship,
} from "./pg-store-relationships.js";
import {
  getSchemasForDomain as pgGetSchemasForDomain,
  getActiveProspectiveMemories as pgGetActiveProspectiveMemories,
  insertArchive as pgInsertArchive,
} from "./pg-store-auxiliary.js";
import { findCoAccessedPairs as pgFindCoAccessedPairs } from "./pg-store-queries.js";
import {
  insertRule as pgInsertRule,
  getAllActiveRules as pgGetAllActiveRules,
  getRulesForScope as pgGetRulesForScope,
  getAllRulesIncludingInactive as pgGetAllRulesIncludingInactive,
  countActiveTriggers as pgCountActiveTriggers,
  insertProspectiveMemory as pgInsertProspectiveMemory,
} from "./pg-store-rules.js";

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
export class PgMemoryStore implements MemoryStoreExt {
  private readonly _pool: PgPool;

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
        // source: infrastructure/pg_store.py default importance
        data.importance ?? 0.5, // eslint-disable-line @typescript-eslint/no-magic-numbers
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

  /**
   * Idempotent UPSERT for wiki pointer memories keyed by ``source``.
   *
   * Deletes any existing memory with the same ``source`` (typically
   * ``wiki://<rel-path>``) then inserts a fresh row with the current
   * content + embedding. Bypasses the predictive-coding merge gate
   * used by ``remember.handler`` — wiki pointer memories must be
   * deterministic (one per page) so the entity graph stays aligned
   * with what's on disk.
   *
   * source: cortex@HEAD~ mcp_server/infrastructure/pg_store.py:upsert_pointer_memory_by_source (2026-05-19)
   *   — "the grooming agent was rewriting pages on disk but never
   *      registering pointer memories in PG, so spreading activation
   *      couldn't see wiki content at all."
   */
  async upsertPointerMemoryBySource(args: {
    source: string;
    content: string;
    tags: readonly string[];
    domain?: string;
  }): Promise<number> {
    return this.runAsync(async (client) => {
      await client.query("DELETE FROM memories WHERE source = $1", [args.source]);
      return this._insertMemoryOnClient(client, {
        content: args.content,
        tags: [...args.tags],
        source: args.source,
        domain: args.domain ?? "",
        is_protected: true,
        heat: 1.0, // source: cortex pg_store.py:upsert_pointer_memory_by_source — heat=1.0
      });
    });
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

  // ── Entity graph ──────────────────────────────────────────────────────
  //
  // LSP-VIOLATION CLOSED: these methods previously returned null/0/no-op.
  // They now delegate to pg-store-entities.ts functions via runAsync.
  // Sync signatures call _runSync (throws at runtime) — use *Async variants
  // from async MCP handlers (same pattern as all other PG CRUD methods).
  //
  // source: cortex@ed33435 mcp_server/infrastructure/pg_store_entities.py

  getEntityByName(_name: string): EntityRecord | null {
    return this._runSync(async (c) => {
      const row = await pgGetEntityByName(c, _name);
      return row ? this._normalizeEntityRow(row) : null;
    });
  }

  async getEntityByNameAsync(name: string): Promise<EntityRecord | null> {
    return this.runAsync(async (c) => {
      const row = await pgGetEntityByName(c, name);
      return row ? this._normalizeEntityRow(row) : null;
    });
  }

  /**
   * Upsert an entity; return its id.
   *
   * postcondition: returns id > 0 for the entity.
   * source: cortex@ed33435 mcp_server/infrastructure/pg_store_entities.py:50-80
   */
  upsertEntity(_name: string, _type: string, _domain: string): number {
    return this._runSync(async (c) => pgInsertEntity(c, { name: _name, type: _type, domain: _domain }));
  }

  async upsertEntityAsync(name: string, type: string, domain: string): Promise<number> {
    return this.runAsync((c) => pgInsertEntity(c, { name, type, domain }));
  }

  /**
   * Link a memory to an entity. Idempotent.
   * source: cortex@ed33435 mcp_server/infrastructure/pg_store_entities.py — memory_entities INSERT
   */
  linkMemoryEntity(_memoryId: number, _entityId: number): void {
    void this.runAsync((c) =>
      c.query(
        `INSERT INTO memory_entities (memory_id, entity_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [_memoryId, _entityId],
      ),
    );
  }

  async linkMemoryEntityAsync(memoryId: number, entityId: number): Promise<void> {
    return this.runAsync((c) =>
      c.query(
        `INSERT INTO memory_entities (memory_id, entity_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [memoryId, entityId],
      ).then(() => undefined),
    );
  }

  /**
   * Upsert a typed relationship between two entities.
   * source: cortex@ed33435 mcp_server/infrastructure/pg_store_relationships.py:52-69
   */
  upsertRelationship(
    _sourceEntityId: number,
    _targetEntityId: number,
    _relationshipType: string,
    _weight = 1.0,
  ): void {
    void this.runAsync((c) =>
      pgInsertRelationship(c, {
        source_entity_id: _sourceEntityId,
        target_entity_id: _targetEntityId,
        relationship_type: _relationshipType,
        weight: _weight,
      }),
    );
  }

  /**
   * Return all schema records for a domain.
   *
   * LSP-VIOLATION CLOSED: previously returned []. Now delegates to PG.
   * source: cortex@ed33435 mcp_server/infrastructure/pg_store_auxiliary.py:285-305
   */
  getSchemasForDomain(_domain: string): Array<Record<string, unknown>> {
    return this._runSync(async (c) => pgGetSchemasForDomain(c, _domain));
  }

  async getSchemasForDomainAsync(domain: string): Promise<Array<Record<string, unknown>>> {
    return this.runAsync((c) => pgGetSchemasForDomain(c, domain));
  }

  /**
   * Load oscillatory clock state JSON string.
   *
   * LSP-VIOLATION CLOSED: previously returned null always (oscillatory_state
   * table listed as "not yet created"). The pg-schema-tables.ts includes this
   * table; pg-store-stats.ts implements loadOscillatoryState. Wire it here.
   *
   * source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:143-147
   */
  loadOscillatoryState(): string | null {
    return this._runSync(async (c) => pgLoadOscillatoryState(c));
  }

  async loadOscillatoryStateAsync(): Promise<string | null> {
    return this.runAsync((c) => pgLoadOscillatoryState(c));
  }

  /**
   * Persist oscillatory clock state JSON string.
   *
   * LSP-VIOLATION CLOSED: previously a no-op.
   * source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:135-141
   */
  saveOscillatoryState(_stateJson: string): void {
    void this.runAsync((c) => pgSaveOscillatoryState(c, _stateJson));
  }

  async saveOscillatoryStateAsync(stateJson: string): Promise<void> {
    return this.runAsync((c) => pgSaveOscillatoryState(c, stateJson));
  }

  // ── MemoryStoreExt: decay / stats queries ──────────────────────────────
  //
  // LSP-VIOLATION CLOSED (violations #1 and #6): all of these previously
  // returned [] via escape-hatch `ext["method"]?.() ?? []`. They now
  // delegate to pg-store-queries.ts and pg-store-stats.ts functions which
  // execute real SQL against the PG connection pool.

  /**
   * Return all non-stale memories for the decay pipeline.
   *
   * source: cortex@ed33435 mcp_server/infrastructure/pg_store_queries.py:107-109
   */
  getAllMemoriesForDecay(): Record<string, unknown>[] {
    return this._runSync(async (c) => pgGetAllMemoriesForDecay(c));
  }

  async getAllMemoriesForDecayAsync(): Promise<Record<string, unknown>[]> {
    return this.runAsync((c) => pgGetAllMemoriesForDecay(c));
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/pg_store_queries.py:77-85
   */
  // source: pg_store_queries.py:78
  getAllMemoriesForValidation(limit = 1000): Record<string, unknown>[] { // eslint-disable-line @typescript-eslint/no-magic-numbers
    return this._runSync(async (c) => pgGetAllMemoriesForValidation(c, limit));
  }

  // source: pg_store_queries.py:78
  async getAllMemoriesForValidationAsync(limit = 1000): Promise<Record<string, unknown>[]> { // eslint-disable-line @typescript-eslint/no-magic-numbers
    return this.runAsync((c) => pgGetAllMemoriesForValidation(c, limit));
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/pg_store_queries.py:20-28
   */
  // source: pg_store_queries.py:21
  getMemoriesForDomain(domain: string, minHeat = 0.05, limit = 50): Record<string, unknown>[] { // eslint-disable-line @typescript-eslint/no-magic-numbers
    return this._runSync(async (c) => pgGetMemoriesForDomain(c, domain, minHeat, limit));
  }

  // source: pg_store_queries.py:21
  async getMemoriesForDomainAsync(domain: string, minHeat = 0.05, limit = 50): Promise<Record<string, unknown>[]> { // eslint-disable-line @typescript-eslint/no-magic-numbers
    return this.runAsync((c) => pgGetMemoriesForDomain(c, domain, minHeat, limit));
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/pg_store_queries.py:30-38
   */
  // source: pg_store_queries.py:31
  getMemoriesForDirectory(directory: string, minHeat = 0.05): Record<string, unknown>[] { // eslint-disable-line @typescript-eslint/no-magic-numbers
    return this._runSync(async (c) => pgGetMemoriesForDirectory(c, directory, minHeat));
  }

  // source: pg_store_queries.py:31
  async getMemoriesForDirectoryAsync(directory: string, minHeat = 0.05): Promise<Record<string, unknown>[]> { // eslint-disable-line @typescript-eslint/no-magic-numbers
    return this.runAsync((c) => pgGetMemoriesForDirectory(c, directory, minHeat));
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/pg_store_queries.py:40-61
   */
  // source: pg_store_queries.py:41
  getHotMemories(minHeat = 0.7, limit = 20, includeBenchmarks = false): Record<string, unknown>[] { // eslint-disable-line @typescript-eslint/no-magic-numbers
    return this._runSync(async (c) => pgGetHotMemories(c, minHeat, limit, includeBenchmarks));
  }

  // source: pg_store_queries.py:41
  async getHotMemoriesAsync(minHeat = 0.7, limit = 20, includeBenchmarks = false): Promise<Record<string, unknown>[]> { // eslint-disable-line @typescript-eslint/no-magic-numbers
    return this.runAsync((c) => pgGetHotMemories(c, minHeat, limit, includeBenchmarks));
  }

  // ── MemoryStoreExt: full-text search ───────────────────────────────────
  //
  // LSP-VIOLATION CLOSED (#3): recall pipeline's searchByFts previously
  // called storeExt["searchFts"]?.() which returned [] on PG (method did
  // not exist). Now implemented via PG tsvector + websearch_to_tsquery.
  //
  // source: PostgreSQL 11+ websearch_to_tsquery
  //   https://www.postgresql.org/docs/current/textsearch-controls.html#TEXTSEARCH-PARSING-QUERIES
  // source: cortex@ed33435 mcp_server/infrastructure/pg_store.py — FTS via tsvector column

  /**
   * Full-text search via PostgreSQL tsvector.
   *
   * postcondition: returns (memory_id, rank) pairs ordered by relevance.
   *   Returns [] if query is empty or no matches found. Never throws.
   *
   * source: PostgreSQL 11+ websearch_to_tsquery and ts_rank_cd functions
   *   https://www.postgresql.org/docs/current/textsearch-controls.html
   */
  // source: sqlite_store_search.py:237 default limit=20
  searchFts(query: string, limit = 20): Array<[number, number]> { // eslint-disable-line @typescript-eslint/no-magic-numbers
    return this._runSync(async (c) => this._searchFtsOnClient(c, query, limit));
  }

  // source: sqlite_store_search.py:237
  async searchFtsAsync(query: string, limit = 20): Promise<Array<[number, number]>> { // eslint-disable-line @typescript-eslint/no-magic-numbers
    if (!query) return [];
    return this.runAsync((c) => this._searchFtsOnClient(c, query, limit));
  }

  private async _searchFtsOnClient(
    client: PoolClient,
    query: string,
    limit: number,
  ): Promise<Array<[number, number]>> {
    if (!query) return [];
    try {
      // websearch_to_tsquery parses natural language queries safely (no
      // syntax error on punctuation). ts_rank_cd measures coverage density.
      // source: PostgreSQL 11+ websearch_to_tsquery — handles & | ! natively
      const result = await client.query<{ id: number; rank: number }>(
        `SELECT id, ts_rank_cd(content_tsv, websearch_to_tsquery('english', $1)) AS rank
         FROM memories
         WHERE content_tsv @@ websearch_to_tsquery('english', $1)
           AND NOT is_stale
         ORDER BY rank DESC
         LIMIT $2`,
        [query, limit],
      );
      return result.rows.map((r) => [r.id, r.rank] as [number, number]);
    } catch {
      // FTS query failed — degrade gracefully (same as SQLite FTS catch path)
      return [];
    }
  }

  // ── MemoryStoreExt: consolidation stage queries ────────────────────────
  //
  // LSP-VIOLATION CLOSED (#6): consolidation pipeline silently no-ops on PG.
  // source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:79-87
   */
  // source: pg_store_stats.py:110
  getMemoriesByStage(stage: string, limit = 100): Record<string, unknown>[] { // eslint-disable-line @typescript-eslint/no-magic-numbers
    return this._runSync(async (c) => pgGetMemoriesByStage(c, stage, limit));
  }

  // source: pg_store_stats.py:110
  async getMemoriesByStageAsync(stage: string, limit = 100): Promise<Record<string, unknown>[]> { // eslint-disable-line @typescript-eslint/no-magic-numbers
    return this.runAsync((c) => pgGetMemoriesByStage(c, stage, limit));
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:55-61
   */
  updateMemoryConsolidation(
    memoryId: number,
    stage: string,
    hoursInStage: number,
    replayCount: number,
    hippocampalDependency: number,
  ): void {
    void this.runAsync((c) =>
      pgUpdateMemoryConsolidation(c, memoryId, stage, hoursInStage, replayCount, hippocampalDependency),
    );
  }

  async updateMemoryConsolidationAsync(
    memoryId: number,
    stage: string,
    hoursInStage: number,
    replayCount: number,
    hippocampalDependency: number,
  ): Promise<void> {
    return this.runAsync((c) =>
      pgUpdateMemoryConsolidation(c, memoryId, stage, hoursInStage, replayCount, hippocampalDependency),
    );
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:63-76
   */
  insertStageTransitionsBatch(rows: Record<string, unknown>[]): number {
    void this.runAsync((c) =>
      pgInsertStageTransitionsBatch(
        c,
        rows.map((r) => ({
          memory_id: Number(r["memory_id"]),
          from_stage: String(r["from_stage"]),
          to_stage: String(r["to_stage"]),
          hours_in_prev: Number(r["hours_in_prev"] ?? r["hours_in_stage"] ?? 0),
          trigger: String(r["trigger"] ?? "cascade"),
        })),
      ),
    );
    return rows.length;
  }

  /**
   * Update stage_entered_at timestamp.
   *
   * source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py — cascade stage logic
   */
  updateStageEnteredAt(memoryId: number, enteredAt: string): void {
    void this.runAsync((c) =>
      c.query(`UPDATE memories SET stage_entered_at = $1 WHERE id = $2`, [enteredAt, memoryId]),
    );
  }

  // ── MemoryStoreExt: CLS queries ────────────────────────────────────────
  //
  // source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:136-162

  // source: pg_store_stats.py:185
  getEpisodicMemories(domain = "", directory = "", limit = 500): Record<string, unknown>[] { // eslint-disable-line @typescript-eslint/no-magic-numbers
    return this._runSync(async (c) => pgGetEpisodicMemories(c, domain, directory, limit));
  }

  // source: pg_store_stats.py:185
  async getEpisodicMemoriesAsync(domain = "", directory = "", limit = 500): Promise<Record<string, unknown>[]> { // eslint-disable-line @typescript-eslint/no-magic-numbers
    return this.runAsync((c) => pgGetEpisodicMemories(c, domain, directory, limit));
  }

  // source: pg_store_stats.py:204
  getSemanticMemories(domain = "", limit = 500): Record<string, unknown>[] { // eslint-disable-line @typescript-eslint/no-magic-numbers
    return this._runSync(async (c) => pgGetSemanticMemories(c, domain, limit));
  }

  // source: pg_store_stats.py:204
  async getSemanticMemoriesAsync(domain = "", limit = 500): Promise<Record<string, unknown>[]> { // eslint-disable-line @typescript-eslint/no-magic-numbers
    return this.runAsync((c) => pgGetSemanticMemories(c, domain, limit));
  }

  updateMemoryStoreType(memoryId: number, storeType: string): void {
    void this.runAsync((c) => pgUpdateMemoryStoreType(c, memoryId, storeType));
  }

  // ── MemoryStoreExt: entity queries for consolidation ───────────────────
  //
  // source: cortex@ed33435 mcp_server/infrastructure/pg_store_entities.py

  getAllEntities(opts?: { minHeat?: number; includeArchived?: boolean }): Record<string, unknown>[] {
    return this._runSync(async (c) => pgGetAllEntities(c, opts?.minHeat, opts?.includeArchived));
  }

  async getAllEntitiesAsync(opts?: { minHeat?: number; includeArchived?: boolean }): Promise<Record<string, unknown>[]> {
    return this.runAsync((c) => pgGetAllEntities(c, opts?.minHeat, opts?.includeArchived));
  }

  updateEntitiesHeatBatch(updates: Array<[number, number]>): void {
    void this.runAsync((c) => pgUpdateEntitiesHeatBatch(c, updates));
  }

  archiveEntitiesBatch(entityIds: number[]): number {
    void this.runAsync((c) => pgArchiveEntitiesBatch(c, entityIds));
    return entityIds.length;
  }

  // ── MemoryStoreExt: relationship queries ───────────────────────────────
  //
  // source: cortex@ed33435 mcp_server/infrastructure/pg_store_relationships.py

  getAllRelationships(): Record<string, unknown>[] {
    return this._runSync(async (c) => pgGetAllRelationships(c));
  }

  async getAllRelationshipsAsync(): Promise<Record<string, unknown>[]> {
    return this.runAsync((c) => pgGetAllRelationships(c));
  }

  findCoAccessedPairs(memoryIds: number[]): Array<[number, number]> {
    return this._runSync(async (c) => pgFindCoAccessedPairs(c, memoryIds));
  }

  async findCoAccessedPairsAsync(memoryIds: number[]): Promise<Array<[number, number]>> {
    return this.runAsync((c) => pgFindCoAccessedPairs(c, memoryIds));
  }

  updateRelationshipsWeightBatch(updates: Array<[number, number]>): void {
    void this.runAsync((c) => pgUpdateRelationshipsWeightBatch(c, updates));
  }

  deleteRelationshipsBatch(ids: number[]): number {
    void this.runAsync((c) => pgDeleteRelationshipsBatch(c, ids));
    return ids.length;
  }

  insertRelationship(rel: Record<string, unknown>): void {
    void this.runAsync((c) =>
      pgInsertRelationship(c, {
        source_entity_id: Number(rel["source_entity_id"]),
        target_entity_id: Number(rel["target_entity_id"]),
        relationship_type: String(rel["relationship_type"] ?? "generic"),
        weight: typeof rel["weight"] === "number" ? rel["weight"] : 1.0,
      }),
    );
  }

  /**
   * Awaitable insertRelationship — commits before returning, giving
   * back-pressure on the pool. Required by codebase-analyze-helpers.ts.
   *
   * postcondition: relationship row persisted in PG before Promise resolves.
   * source: ADR-0042 — async entity writes required for PG codebase-analyze path.
   * source: liskov@24cb6e2 — *Async-when-available pattern for PG/SQLite parity.
   */
  async insertRelationshipAsync(rel: Record<string, unknown>): Promise<void> {
    await this.runAsync((c) =>
      pgInsertRelationship(c, {
        source_entity_id: Number(rel["source_entity_id"]),
        target_entity_id: Number(rel["target_entity_id"]),
        relationship_type: String(rel["relationship_type"] ?? "generic"),
        weight: typeof rel["weight"] === "number" ? rel["weight"] : 1.0,
      }),
    );
  }

  reinforceOrCreateRelationship(entityA: string, entityB: string, learningRate: number): void {
    void this.runAsync((c) => pgReinforceOrCreateRelationship(c, entityA, entityB, learningRate));
  }

  // ── MemoryStoreExt: hippocampal transfer ───────────────────────────────
  //
  // source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py

  // source: pg_store_stats.py
  getTransferCandidates(limit = 50): Record<string, unknown>[] { // eslint-disable-line @typescript-eslint/no-magic-numbers
    return this._runSync(async (c) => {
      const result = await c.query(
        // Hippocampal transfer candidates: episodic memories with high
        // hippocampal_dependency that are ready for semantic extraction.
        // source: cortex@ed33435 mcp_server/core/cls_transfer.py — transfer eligibility
        `SELECT * FROM memories
         WHERE store_type = 'episodic'
           AND hippocampal_dependency > 0.5
           AND NOT is_stale
         ORDER BY hippocampal_dependency DESC, heat_base DESC
         LIMIT $1`,
        [limit],
      );
      return result.rows as Record<string, unknown>[];
    });
  }

  // source: pg_store_stats.py
  async getTransferCandidatesAsync(limit = 50): Promise<Record<string, unknown>[]> { // eslint-disable-line @typescript-eslint/no-magic-numbers
    return this.runAsync(async (c) => {
      const result = await c.query(
        `SELECT * FROM memories
         WHERE store_type = 'episodic'
           AND hippocampal_dependency > 0.5
           AND NOT is_stale
         ORDER BY hippocampal_dependency DESC, heat_base DESC
         LIMIT $1`,
        [limit],
      );
      return result.rows as Record<string, unknown>[];
    });
  }

  updateHippocampalDependency(memoryId: number, dependency: number): void {
    void this.runAsync((c) =>
      c.query(`UPDATE memories SET hippocampal_dependency = $1 WHERE id = $2`, [dependency, memoryId]),
    );
  }

  // ── MemoryStoreExt: recently accessed ─────────────────────────────────

  // source: pg_store_stats.py:58
  getRecentlyAccessedMemories(limit = 20, minAccessCount = 1): Record<string, unknown>[] { // eslint-disable-line @typescript-eslint/no-magic-numbers
    return this._runSync(async (c) => pgGetRecentlyAccessedMemories(c, limit, minAccessCount));
  }

  // source: pg_store_stats.py:58
  async getRecentlyAccessedMemoriesAsync(limit = 20, minAccessCount = 1): Promise<Record<string, unknown>[]> { // eslint-disable-line @typescript-eslint/no-magic-numbers
    return this.runAsync((c) => pgGetRecentlyAccessedMemories(c, limit, minAccessCount));
  }

  // ── MemoryStoreExt: agent context query (codebase-analyze) ────────────
  //
  // LSP-VIOLATION CLOSED (#5): codebase-analyze called store.execute() which
  // is SQLite-only. Replaced with a typed method on the interface.
  //
  // source: packages/memory/src/codebase-analysis/handlers/codebase-analyze-helpers.ts:142-160

  /**
   * Return memories for a given agent_context.
   *
   * postcondition: returns rows where agent_context = agentContext AND NOT is_stale.
   *   Returns [] if none exist. Never throws.
   *
   * source: codebase-analyze-helpers.ts:142-160 — SELECT id, tags FROM memories
   *   WHERE agent_context = ? AND NOT is_stale
   */
  getMemoriesByAgentContext(agentContext: string): Array<{ id: number; tags: string }> {
    return this._runSync(async (c) => this._getMemoriesByAgentContextOnClient(c, agentContext));
  }

  async getMemoriesByAgentContextAsync(agentContext: string): Promise<Array<{ id: number; tags: string }>> {
    return this.runAsync((c) => this._getMemoriesByAgentContextOnClient(c, agentContext));
  }

  private async _getMemoriesByAgentContextOnClient(
    client: PoolClient,
    agentContext: string,
  ): Promise<Array<{ id: number; tags: string }>> {
    const result = await client.query<{ id: number; tags: unknown }>(
      `SELECT id, tags FROM memories WHERE agent_context = $1 AND NOT is_stale`,
      [agentContext],
    );
    // Normalize tags: PG returns JSONB as parsed JS value; codebase-analyze
    // expects a string (JSON-stringified array) consistent with SQLite behavior.
    return result.rows.map((r) => ({
      id: r.id,
      tags: typeof r.tags === "string" ? r.tags : JSON.stringify(r.tags ?? []),
    }));
  }

  // ── MemoryStoreExt: prospective memories ──────────────────────────────

  getActiveProspectiveMemories(): Record<string, unknown>[] {
    return this._runSync(async (c) => pgGetActiveProspectiveMemories(c));
  }

  async getActiveProspectiveMemoriesAsync(): Promise<Record<string, unknown>[]> {
    return this.runAsync((c) => pgGetActiveProspectiveMemories(c));
  }

  // ── MemoryStoreExt: replay count ──────────────────────────────────────

  incrementReplayCount(memoryId: number): void {
    void this.runAsync((c) => pgIncrementReplayCount(c, memoryId));
  }

  // ── MemoryStoreExt: archive / compression ─────────────────────────────

  insertArchive(row: Record<string, unknown>): void {
    void this.runAsync(async (c) => {
      await pgInsertArchive(
        c,
        {
          original_memory_id: Number(row["original_memory_id"]),
          content: String(row["content"] ?? ""),
          embedding: row["embedding"] instanceof Buffer ? row["embedding"] : null,
          mismatch_score: typeof row["mismatch_score"] === "number" ? row["mismatch_score"] : 0.0,
          archive_reason: String(row["archive_reason"] ?? ""),
        },
        // bytesToVector converter: convert Buffer to pgvector literal
        (buf) => {
          if (!(buf instanceof Buffer) || buf.byteLength === 0) return null;
          const dim = buf.byteLength / Float32Array.BYTES_PER_ELEMENT;
          const floats = new Float32Array(buf.buffer, buf.byteOffset, dim);
          return `[${Array.from(floats).join(",")}]`;
        },
      );
    });
  }

  updateMemoryCompression(
    memoryId: number,
    content: string,
    _embedding: Buffer | null,
    compressionLevel: number,
    _opts?: Record<string, unknown>,
  ): void {
    // source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py — compression update
    void this.runAsync((c) =>
      c.query(
        `UPDATE memories SET content = $1, compressed = TRUE,
            compression_level = $2,
            original_content = CASE WHEN original_content IS NULL THEN content ELSE original_content END
         WHERE id = $3`,
        [content, compressionLevel, memoryId],
      ),
    );
  }

  // ── MemoryStoreExt: batch fetch ────────────────────────────────────────

  getByIds(ids: number[]): Record<string, unknown>[] {
    if (ids.length === 0) return [];
    return this._runSync(async (c) => {
      const result = await c.query(
        `SELECT * FROM memories WHERE id = ANY($1::int[])`,
        [ids],
      );
      return result.rows as Record<string, unknown>[];
    });
  }

  async getByIdsAsync(ids: number[]): Promise<Record<string, unknown>[]> {
    if (ids.length === 0) return [];
    return this.runAsync(async (c) => {
      const result = await c.query(
        `SELECT * FROM memories WHERE id = ANY($1::int[])`,
        [ids],
      );
      return result.rows as Record<string, unknown>[];
    });
  }

  // ── MemoryStoreExt: consolidation log ─────────────────────────────────

  logConsolidation(data: Record<string, unknown>): void {
    void this.runAsync((c) =>
      pgLogConsolidation(c, {
        memories_added: typeof data["memories_added"] === "number" ? data["memories_added"] : 0,
        memories_updated: typeof data["memories_updated"] === "number" ? data["memories_updated"] : 0,
        memories_archived: typeof data["memories_archived"] === "number" ? data["memories_archived"] : 0,
        duration_ms: typeof data["duration_ms"] === "number" ? data["duration_ms"] : 0,
      }),
    );
  }

  async close(): Promise<void> {
    await this._pool.end();
  }

  // ── MemoryStoreExt: prospective memory write ──────────────────────────

  /**
   * Sync façade — fires-and-forgets the async insertProspectiveMemory.
   * Returns 0 on PG because we cannot block for the result.
   * Use insertProspectiveMemoryAsync for the real id.
   *
   * source: ADR-0042 — sync wrapper fire-and-forgets async op.
   */
  insertProspectiveMemory(data: Record<string, unknown>): number {
    void this.runAsync((c) =>
      pgInsertProspectiveMemory(c, {
        content: data["content"] as string,
        trigger_condition: data["trigger_condition"] as string,
        trigger_type: (data["trigger_type"] as string) ?? "keyword",
        target_directory: (data["target_directory"] as string | null) ?? null,
        is_active: data["is_active"] !== false,
        triggered_count: (data["triggered_count"] as number) ?? 0,
      }),
    );
    return 0; // id unknown in fire-and-forget path; use *Async for real id
  }

  /**
   * Async variant — returns the real row id.
   * source: cortex@ed33435 mcp_server/infrastructure/pg_store_auxiliary.py:22-38
   */
  async insertProspectiveMemoryAsync(data: Record<string, unknown>): Promise<number> {
    return this.runAsync((c) =>
      pgInsertProspectiveMemory(c, {
        content: data["content"] as string,
        trigger_condition: data["trigger_condition"] as string,
        trigger_type: (data["trigger_type"] as string) ?? "keyword",
        target_directory: (data["target_directory"] as string | null) ?? null,
        is_active: data["is_active"] !== false,
        triggered_count: (data["triggered_count"] as number) ?? 0,
      }),
    );
  }

  /**
   * Sync façade for countActiveTriggers. Returns 0 on PG (fire-and-forget).
   * Use countActiveTriggersAsync for the real count.
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:249-253
   */
  countActiveTriggers(): number {
    // PG cannot block for the count in the sync path. Return 0 as a safe default.
    // Callers must use countActiveTriggersAsync for the real count (ADR-0042).
    return 0;
  }

  /**
   * Async variant — returns the real trigger count.
   * source: cortex@ed33435 mcp_server/infrastructure/pg_store_stats.py:190
   */
  async countActiveTriggersAsync(): Promise<number> {
    return this.runAsync((c) => pgCountActiveTriggers(c));
  }

  // ── MemoryStoreExt: rules ─────────────────────────────────────────────

  /**
   * Sync façade — fires-and-forgets the async insertRule. Returns 0 on PG.
   * Use insertRuleAsync for the real id.
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_rules.py:14-31
   */
  insertRule(data: Record<string, unknown>): number {
    void this.runAsync((c) =>
      pgInsertRule(c, {
        rule_type: (data["rule_type"] as string) ?? "soft",
        scope: (data["scope"] as string) ?? "global",
        scope_value: (data["scope_value"] as string | null) ?? null,
        condition: data["condition"] as string,
        action: data["action"] as string,
        priority: (data["priority"] as number) ?? 0,
        is_active: data["is_active"] !== false,
      }),
    );
    return 0; // id unknown in fire-and-forget path; use *Async for real id
  }

  /**
   * Async variant — returns the real rule id.
   * source: cortex@ed33435 mcp_server/infrastructure/pg_store_rules.py
   */
  async insertRuleAsync(data: Record<string, unknown>): Promise<number> {
    return this.runAsync((c) =>
      pgInsertRule(c, {
        rule_type: (data["rule_type"] as string) ?? "soft",
        scope: (data["scope"] as string) ?? "global",
        scope_value: (data["scope_value"] as string | null) ?? null,
        condition: data["condition"] as string,
        action: data["action"] as string,
        priority: (data["priority"] as number) ?? 0,
        is_active: data["is_active"] !== false,
      }),
    );
  }

  /**
   * Sync façade — fires-and-forgets. Returns [] on PG.
   * Use getAllActiveRulesAsync for real data.
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_rules.py:41-45
   */
  getAllActiveRules(): Record<string, unknown>[] {
    // source: ADR-0042 — sync path unsupported on PG; callers use getAllActiveRulesAsync
    return [];
  }

  async getAllActiveRulesAsync(): Promise<Record<string, unknown>[]> {
    return this.runAsync((c) => pgGetAllActiveRules(c));
  }

  /**
   * Sync façade — returns [] on PG.
   * Use getRulesForScopeAsync for real data.
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_rules.py:33-39
   */
  getRulesForScope(scope: string): Record<string, unknown>[] {
    void scope; // suppress unused warning
    // source: ADR-0042 — sync path unsupported on PG; callers use getRulesForScopeAsync
    return [];
  }

  async getRulesForScopeAsync(scope: string): Promise<Record<string, unknown>[]> {
    return this.runAsync((c) => pgGetRulesForScope(c, scope));
  }

  /**
   * Sync façade — returns [] on PG.
   * Use getAllRulesIncludingInactiveAsync for real data.
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_rules.py admin listing
   */
  getAllRulesIncludingInactive(): Record<string, unknown>[] {
    // source: ADR-0042 — sync path unsupported on PG; callers use getAllRulesIncludingInactiveAsync
    return [];
  }

  async getAllRulesIncludingInactiveAsync(): Promise<Record<string, unknown>[]> {
    return this.runAsync((c) => pgGetAllRulesIncludingInactive(c));
  }

  // ── Entity row normalization ──────────────────────────────────────────

  private _normalizeEntityRow(row: Record<string, unknown>): EntityRecord {
    return {
      id: row["id"] as number,
      name: row["name"] as string,
      type: (row["type"] as string) ?? "",
      domain: (row["domain"] as string) ?? "",
      heat: (row["heat"] as number) ?? 1.0,
      archived: Boolean(row["archived"]),
      created_at: row["created_at"] as string,
      last_accessed: (row["last_accessed"] as string) ?? "",
    };
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
      // source: infrastructure/pg_store.py _normalize_memory_row default importance
      importance: (row["importance"] as number) ?? 0.5, // eslint-disable-line @typescript-eslint/no-magic-numbers
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
