/**
 * sqlite-store.ts — SQLite (better-sqlite3) adapter for MemoryStore.
 *
 * Ports: infrastructure/sqlite_store.py (~480 LOC)
 *
 * Uses better-sqlite3 which is synchronous — all operations complete
 * without async. This is a strict parity with the Python source which
 * uses aiosqlite but exposes a synchronous-style API internally.
 *
 * ADR-0007: better-sqlite3 must be in pnpm.onlyBuiltDependencies.
 * ADR-0003: preconditions here MUST NOT be stronger than MemoryStore's.
 *
 * Atomicity proofs (per task spec):
 *   1. insertMemory: wrapped in a single BEGIN/COMMIT covering memories +
 *      memories_fts rows. If either INSERT fails, the transaction rolls
 *      back and no id is returned.
 *   2. deleteMemory: single transaction deletes memories_fts + memories.
 *   3. bumpHeatRaw: single UPDATE (cannot partially succeed).
 *   4. Read-your-writes: better-sqlite3 uses a single connection; there
 *      is no pool interleaving. A getMemory call after insertMemory on
 *      the same Database instance always sees the committed row.
 *   5. No duplicate inserts: the caller (write gate) is responsible.
 *      The store does NOT check for content duplicates here.
 *
 * Known race condition in the Python source (noted for TS port):
 *   sqlite_store.py insert_memory uses two separate execute() calls —
 *   one for memories and one for memories_fts. Between the two calls
 *   there is no explicit transaction, relying on autocommit mode.
 *   If the FTS INSERT fails, the main row is committed without an FTS
 *   entry, breaking full-text search on that row.
 *   FIX in this port: wrap both INSERTs in an explicit transaction
 *   (BEGIN/COMMIT). This is the correctness obligation noted in the task spec.
 *
 * Source: infrastructure/sqlite_store.py
 */

import Database from "better-sqlite3";
import type { Database as DatabaseType, Statement } from "better-sqlite3";
import type { MemoryInsertData, MemoryItem } from "../types.js";
import type {
  EntityRecord,
  HeatUpdate,
  MemoryStore,
  RelationshipRecord,
  VecHit,
} from "./memory-store.js";

// ── Schema SQL ──────────────────────────────────────────────────────────────
// Verbatim column layout from SCHEMA.md §memories table.
// source: infrastructure/sqlite_schema.py:MEMORIES_DDL
// NOTE: stage_entered_at added by v3_13_0_a3_migration.sql (must be present).

const MEMORIES_DDL = `
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT '',
  domain TEXT NOT NULL DEFAULT '',
  directory_context TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_accessed TEXT NOT NULL DEFAULT (datetime('now')),
  heat_base REAL NOT NULL DEFAULT 1.0 CHECK (heat_base >= 0.0 AND heat_base <= 1.0),
  heat_base_set_at TEXT NOT NULL DEFAULT '',
  no_decay INTEGER NOT NULL DEFAULT 0,
  surprise_score REAL DEFAULT 0.0,
  importance REAL DEFAULT 0.5,
  emotional_valence REAL DEFAULT 0.0,
  confidence REAL DEFAULT 1.0,
  access_count INTEGER DEFAULT 0,
  useful_count INTEGER DEFAULT 0,
  plasticity REAL DEFAULT 1.0,
  stability REAL DEFAULT 0.0,
  reconsolidation_count INTEGER DEFAULT 0,
  last_reconsolidated TEXT,
  store_type TEXT DEFAULT 'episodic',
  compressed INTEGER DEFAULT 0,
  compression_level INTEGER DEFAULT 0,
  original_content TEXT,
  is_protected INTEGER DEFAULT 0,
  is_stale INTEGER DEFAULT 0,
  slot_index INTEGER,
  excitability REAL DEFAULT 1.0,
  consolidation_stage TEXT DEFAULT 'labile',
  hours_in_stage REAL DEFAULT 0.0,
  stage_entered_at TEXT,
  replay_count INTEGER DEFAULT 0,
  theta_phase_at_encoding REAL DEFAULT 0.0,
  encoding_strength REAL DEFAULT 1.0,
  separation_index REAL DEFAULT 0.0,
  interference_score REAL DEFAULT 0.0,
  schema_match_score REAL DEFAULT 0.0,
  schema_id TEXT,
  hippocampal_dependency REAL DEFAULT 1.0,
  is_benchmark INTEGER DEFAULT 0,
  agent_context TEXT DEFAULT '',
  is_global INTEGER DEFAULT 0,
  arousal REAL DEFAULT 0.0,
  dominant_emotion TEXT DEFAULT 'neutral'
)`;

// FTS5 with content table: content='memories' means we own the FTS index
// and insert manually. We keep a shadow FTS table for full-text search.
// Note: content_rowid tells FTS5 which rowid column to use in the content table.
// source: infrastructure/sqlite_schema.py:MEMORIES_FTS_DDL
const MEMORIES_FTS_DDL = `
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts
  USING fts5(content, content='memories', content_rowid='id', tokenize='porter ascii')`;

const ENTITIES_DDL = `
CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT '',
  domain TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_accessed TEXT NOT NULL DEFAULT (datetime('now')),
  heat REAL DEFAULT 1.0,
  archived INTEGER DEFAULT 0
)`;

const RELATIONSHIPS_DDL = `
CREATE TABLE IF NOT EXISTS relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_entity_id INTEGER NOT NULL REFERENCES entities(id),
  target_entity_id INTEGER NOT NULL REFERENCES entities(id),
  relationship_type TEXT NOT NULL,
  weight REAL DEFAULT 1.0,
  is_causal INTEGER DEFAULT 0,
  confidence REAL DEFAULT 1.0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_reinforced TEXT NOT NULL DEFAULT (datetime('now'))
)`;

const MEMORY_ENTITIES_DDL = `
CREATE TABLE IF NOT EXISTS memory_entities (
  memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  PRIMARY KEY (memory_id, entity_id)
)`;

const HOMEOSTATIC_STATE_DDL = `
CREATE TABLE IF NOT EXISTS homeostatic_state (
  domain TEXT PRIMARY KEY,
  factor REAL NOT NULL DEFAULT 1.0 CHECK (factor > 0.0 AND factor < 10.0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

const SCHEMAS_DDL = `
CREATE TABLE IF NOT EXISTS schemas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schema_id TEXT UNIQUE NOT NULL,
  domain TEXT DEFAULT '',
  label TEXT DEFAULT '',
  entity_signature TEXT DEFAULT '{}',
  tag_signature TEXT DEFAULT '{}',
  consistency_threshold REAL DEFAULT 0.7,
  formation_count INTEGER DEFAULT 0,
  last_updated TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;

const OSCILLATORY_STATE_DDL = `
CREATE TABLE IF NOT EXISTS oscillatory_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state_json TEXT NOT NULL DEFAULT '{}'
)`;

// ── Indexes ──────────────────────────────────────────────────────────────────

const INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_memories_heat_base ON memories(heat_base)`,
  `CREATE INDEX IF NOT EXISTS idx_memories_domain ON memories(domain)`,
  `CREATE INDEX IF NOT EXISTS idx_memories_store_type ON memories(store_type)`,
  `CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_memories_agent_context ON memories(agent_context)`,
  `CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_entities_entity ON memory_entities(entity_id)`,
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function clampHeat(h: number): number {
  return Math.max(0.0, Math.min(1.0, h));
}

function boolToInt(v: boolean | undefined | null): number {
  return v ? 1 : 0;
}

function parseJsonArray(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[];
  if (typeof v === "string") {
    try {
      const parsed: unknown = JSON.parse(v);
      return Array.isArray(parsed) ? (parsed as string[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

// ── SqliteMemoryStore ────────────────────────────────────────────────────────

export class SqliteMemoryStore implements MemoryStore {
  private readonly _db: DatabaseType;

  // Prepared statements: built once, reused many times.
  // Invariant: these are always prepared against the current schema.
  private _stmtInsertMemory!: Statement;
  private _stmtInsertFts!: Statement;
  private _stmtGetMemory!: Statement;
  private _stmtDeleteMemory!: Statement;
  private _stmtDeleteFts!: Statement;
  private _stmtBumpHeat!: Statement;
  private _stmtGetHomeostatic!: Statement;
  private _stmtUpsertHomeostatic!: Statement;
  private _stmtGetEntityByName!: Statement;
  private _stmtUpsertEntity!: Statement;
  private _stmtLinkMemoryEntity!: Statement;
  private _stmtUpsertRelationship!: Statement;
  private _stmtGetSchemas!: Statement;
  private _stmtLoadOscillatory!: Statement;
  private _stmtSaveOscillatory!: Statement;
  private _stmtUpdateImportance!: Statement;
  private _stmtUpdateAccess!: Statement;
  private _stmtUpdateMetamemory!: Statement;
  private _stmtSetProtected!: Statement;
  private _stmtMarkStale!: Statement;

  /**
   * Create an SqliteMemoryStore.
   *
   * precondition:  dbPath is a valid filesystem path or ':memory:'.
   * postcondition: schema is initialised; all prepared statements are ready.
   *
   * source: infrastructure/sqlite_store.py:SqliteMemoryStore.__init__
   */
  constructor(dbPath = ":memory:") {
    this._db = new Database(dbPath);
    // WAL mode: allows concurrent readers while a writer is active.
    // Foreign keys: enforce referential integrity.
    this._db.pragma("journal_mode = WAL");
    this._db.pragma("foreign_keys = ON");
    this._initSchema();
    this._runMigrations();
    this._prepareStatements();
  }

  // ── Schema initialization ──────────────────────────────────────────────

  private _initSchema(): void {
    const ddls = [
      MEMORIES_DDL,
      MEMORIES_FTS_DDL,
      ENTITIES_DDL,
      RELATIONSHIPS_DDL,
      MEMORY_ENTITIES_DDL,
      HOMEOSTATIC_STATE_DDL,
      SCHEMAS_DDL,
      OSCILLATORY_STATE_DDL,
      ...INDEXES,
    ];
    for (const ddl of ddls) {
      try {
        this._db.exec(ddl);
      } catch {
        // Tolerate IF NOT EXISTS errors from concurrent or duplicate init.
      }
    }
  }

  /**
   * Add columns that may be missing from older databases.
   * Idempotent: ALTER TABLE fails silently if the column already exists.
   *
   * source: infrastructure/sqlite_store.py:_run_migrations
   */
  private _runMigrations(): void {
    const migrations: Array<[string, string, string]> = [
      ["memories", "stage_entered_at", "TEXT"],
      ["memories", "arousal", "REAL DEFAULT 0.0"],
      ["memories", "dominant_emotion", "TEXT DEFAULT 'neutral'"],
      ["memories", "heat_base_set_at", "TEXT NOT NULL DEFAULT ''"],
      ["memories", "no_decay", "INTEGER NOT NULL DEFAULT 0"],
    ];
    for (const [table, col, def] of migrations) {
      try {
        this._db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
      } catch {
        // Column already exists — expected on re-init.
      }
    }
  }

  // ── Prepared statements ────────────────────────────────────────────────

  private _prepareStatements(): void {
    this._stmtInsertMemory = this._db.prepare(`
      INSERT INTO memories (
        content, tags, source, domain, directory_context, created_at,
        last_accessed, heat_base, heat_base_set_at, surprise_score, importance,
        emotional_valence, confidence, store_type, is_protected,
        consolidation_stage, theta_phase_at_encoding, encoding_strength,
        separation_index, interference_score, schema_match_score, schema_id,
        hippocampal_dependency, is_benchmark, agent_context, is_global,
        stage_entered_at, arousal, dominant_emotion
      ) VALUES (
        @content, @tags, @source, @domain, @directory_context, @created_at,
        @last_accessed, @heat_base, @heat_base_set_at, @surprise_score,
        @importance, @emotional_valence, @confidence, @store_type, @is_protected,
        @consolidation_stage, @theta_phase_at_encoding, @encoding_strength,
        @separation_index, @interference_score, @schema_match_score, @schema_id,
        @hippocampal_dependency, @is_benchmark, @agent_context, @is_global,
        @stage_entered_at, @arousal, @dominant_emotion
      )`);

    this._stmtInsertFts = this._db.prepare(
      `INSERT INTO memories_fts(rowid, content) VALUES (?, ?)`,
    );

    this._stmtGetMemory = this._db.prepare(
      `SELECT * FROM memories WHERE id = ?`,
    );

    this._stmtDeleteMemory = this._db.prepare(
      `DELETE FROM memories WHERE id = ?`,
    );

    this._stmtDeleteFts = this._db.prepare(
      `DELETE FROM memories_fts WHERE rowid = ?`,
    );

    this._stmtBumpHeat = this._db.prepare(
      `UPDATE memories SET heat_base = ?, heat_base_set_at = ? WHERE id = ?`,
    );

    this._stmtGetHomeostatic = this._db.prepare(
      `SELECT COALESCE(MAX(factor), 1.0) AS factor FROM homeostatic_state WHERE domain = ?`,
    );

    this._stmtUpsertHomeostatic = this._db.prepare(`
      INSERT INTO homeostatic_state (domain, factor, updated_at)
        VALUES (?, ?, ?)
      ON CONFLICT(domain) DO UPDATE
        SET factor = excluded.factor, updated_at = excluded.updated_at`);

    this._stmtGetEntityByName = this._db.prepare(
      `SELECT * FROM entities WHERE name = ? LIMIT 1`,
    );

    this._stmtUpsertEntity = this._db.prepare(`
      INSERT INTO entities (name, type, domain, created_at, last_accessed)
        VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE
        SET last_accessed = excluded.last_accessed
      RETURNING id`);

    this._stmtLinkMemoryEntity = this._db.prepare(`
      INSERT OR IGNORE INTO memory_entities (memory_id, entity_id)
        VALUES (?, ?)`);

    this._stmtUpsertRelationship = this._db.prepare(`
      INSERT INTO relationships
        (source_entity_id, target_entity_id, relationship_type, weight, created_at, last_reinforced)
        VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING`);

    this._stmtGetSchemas = this._db.prepare(
      `SELECT * FROM schemas WHERE domain = ?`,
    );

    this._stmtLoadOscillatory = this._db.prepare(
      `SELECT state_json FROM oscillatory_state WHERE id = 1`,
    );

    this._stmtSaveOscillatory = this._db.prepare(`
      INSERT INTO oscillatory_state (id, state_json) VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json`);

    this._stmtUpdateImportance = this._db.prepare(
      `UPDATE memories SET importance = ? WHERE id = ?`,
    );

    this._stmtUpdateAccess = this._db.prepare(`
      UPDATE memories SET last_accessed = ?, access_count = access_count + 1
        WHERE id = ?`);

    this._stmtUpdateMetamemory = this._db.prepare(`
      UPDATE memories SET access_count = ?, useful_count = ?, confidence = ?
        WHERE id = ?`);

    this._stmtSetProtected = this._db.prepare(
      `UPDATE memories SET is_protected = ? WHERE id = ?`,
    );

    this._stmtMarkStale = this._db.prepare(
      `UPDATE memories SET is_stale = ? WHERE id = ?`,
    );
  }

  // ── Memory CRUD ────────────────────────────────────────────────────────

  /**
   * Insert a memory and return its integer ID.
   *
   * precondition:  data.content is non-empty.
   * postcondition: returned id > 0; row exists in memories AND memories_fts.
   *
   * Atomicity: both INSERTs happen in a single transaction (fixes the race
   * condition present in sqlite_store.py where they ran in autocommit).
   * source: infrastructure/sqlite_store.py:insert_memory
   */
  insertMemory(data: MemoryInsertData): number {
    const now = nowIso();
    const params = {
      content: data.content,
      tags: JSON.stringify(data.tags ?? []),
      source: data.source ?? "",
      domain: data.domain ?? "",
      directory_context: data.directory_context ?? "",
      created_at: data.created_at ?? now,
      last_accessed: now,
      heat_base: clampHeat(data.heat ?? 1.0),
      heat_base_set_at: now,
      surprise_score: data.surprise_score ?? 0.0,
      importance: data.importance ?? 0.5,
      emotional_valence: data.emotional_valence ?? 0.0,
      confidence: data.confidence ?? 1.0,
      store_type: data.store_type ?? "episodic",
      is_protected: boolToInt(data.is_protected),
      consolidation_stage: data.consolidation_stage ?? "labile",
      theta_phase_at_encoding: data.theta_phase_at_encoding ?? 0.0,
      encoding_strength: data.encoding_strength ?? 1.0,
      separation_index: data.separation_index ?? 0.0,
      interference_score: data.interference_score ?? 0.0,
      schema_match_score: data.schema_match_score ?? 0.0,
      schema_id: data.schema_id ?? null,
      hippocampal_dependency: data.hippocampal_dependency ?? 1.0,
      is_benchmark: boolToInt(data.is_benchmark),
      agent_context: data.agent_context ?? "",
      is_global: boolToInt(data.is_global),
      stage_entered_at: data.stage_entered_at ?? data.created_at ?? now,
      arousal: data.arousal ?? 0.0,
      dominant_emotion: data.dominant_emotion ?? "neutral",
    };

    // Wrap in a transaction: if FTS insert fails the main row rolls back.
    const insertTx = this._db.transaction(() => {
      const info = this._stmtInsertMemory.run(params);
      const memoryId = info.lastInsertRowid as number;
      this._stmtInsertFts.run(memoryId, data.content);
      return memoryId;
    });

    return insertTx();
  }

  /**
   * Retrieve a memory by id.
   *
   * postcondition: returns null iff id not found.
   * source: infrastructure/sqlite_store.py:get_memory
   */
  getMemory(memoryId: number): MemoryItem | null {
    const row = this._stmtGetMemory.get(memoryId) as
      | Record<string, unknown>
      | undefined;
    if (row == null) return null;
    return this._normalizeRow(row);
  }

  /**
   * Hard-delete a memory row and its FTS entry.
   *
   * postcondition: returns true iff a row was actually deleted.
   * Atomicity: FTS + main row in one transaction.
   * source: infrastructure/sqlite_store.py:delete_memory
   */
  deleteMemory(memoryId: number): boolean {
    const deleteTx = this._db.transaction(() => {
      this._stmtDeleteFts.run(memoryId);
      const info = this._stmtDeleteMemory.run(memoryId);
      return info.changes > 0;
    });
    return deleteTx();
  }

  /**
   * Canonical A3 heat writer.
   *
   * Writes heat_base AND refreshes heat_base_set_at so effective_heat()
   * computes decay from the bump timestamp.
   * source: docs/program/phase-3-a3-migration-design.md §3.1
   * source: infrastructure/sqlite_store.py:bump_heat_raw
   */
  bumpHeatRaw(memoryId: number, newHeatBase: number): void {
    this._stmtBumpHeat.run(clampHeat(newHeatBase), nowIso(), memoryId);
  }

  /** Thin wrapper: calls bumpHeatRaw. */
  updateMemoryHeat(memoryId: number, heat: number): void {
    this.bumpHeatRaw(memoryId, heat);
  }

  /**
   * Batch heat writer. Single transaction for all rows.
   *
   * source: issue #13; phase-3-a3-migration-design.md §3.8
   * source: infrastructure/sqlite_store.py:update_memories_heat_batch
   */
  updateMemoriesHeatBatch(updates: HeatUpdate[]): number {
    if (updates.length === 0) return 0;
    const now = nowIso();
    const batchTx = this._db.transaction((rows: HeatUpdate[]) => {
      for (const [id, heat] of rows) {
        this._stmtBumpHeat.run(clampHeat(heat), now, id);
      }
      return rows.length;
    });
    return batchTx(updates);
  }

  /** Update importance for a single memory row. */
  updateMemoryImportance(memoryId: number, importance: number): void {
    this._stmtUpdateImportance.run(importance, memoryId);
  }

  /** Increment access_count and refresh last_accessed. */
  updateMemoryAccess(memoryId: number): void {
    this._stmtUpdateAccess.run(nowIso(), memoryId);
  }

  /**
   * Update metamemory fields atomically.
   *
   * postcondition: access_count, useful_count, confidence are all written
   *   in a single UPDATE statement.
   * source: infrastructure/sqlite_store.py:update_memory_metamemory
   */
  updateMemoryMetamemory(
    memoryId: number,
    accessCount: number,
    usefulCount: number,
    confidence: number,
  ): void {
    this._stmtUpdateMetamemory.run(accessCount, usefulCount, confidence, memoryId);
  }

  setMemoryProtected(memoryId: number, protected_: boolean): void {
    this._stmtSetProtected.run(boolToInt(protected_), memoryId);
  }

  markMemoryStale(memoryId: number, stale: boolean): void {
    this._stmtMarkStale.run(boolToInt(stale), memoryId);
  }

  // ── Homeostatic state ──────────────────────────────────────────────────

  getHomeostaticFactor(domain: string): number {
    const row = this._stmtGetHomeostatic.get(domain || "") as
      | { factor: number }
      | undefined;
    return row?.factor ?? 1.0;
  }

  setHomeostaticFactor(domain: string, factor: number): void {
    const clamped = Math.max(0.01, Math.min(9.99, factor));
    this._stmtUpsertHomeostatic.run(domain || "", clamped, nowIso());
  }

  // ── Vector search (stub — sqlite-vec extension is optional) ───────────

  /**
   * Return top-k nearest memories by embedding cosine distance.
   *
   * port-pending: sqlite-vec extension not loaded automatically.
   * Returns [] when the extension is not available (graceful degradation).
   * source: infrastructure/sqlite_store_search.py:vec_search
   */
  searchVectors(
    _embedding: Buffer,
    _topK: number,
    _minHeat?: number,
  ): VecHit[] {
    // port-pending: sqlite-vec extension load is not implemented yet.
    // When ported, check this._hasVec and query memories_vec virtual table.
    return [];
  }

  // ── Entity graph ───────────────────────────────────────────────────────

  getEntityByName(name: string): EntityRecord | null {
    const row = this._stmtGetEntityByName.get(name) as
      | Record<string, unknown>
      | undefined;
    if (row == null) return null;
    return {
      id: row["id"] as number,
      name: row["name"] as string,
      type: row["type"] as string,
      domain: (row["domain"] as string) ?? "",
      heat: (row["heat"] as number) ?? 1.0,
      archived: Boolean(row["archived"]),
      created_at: row["created_at"] as string,
      last_accessed: row["last_accessed"] as string,
    };
  }

  upsertEntity(name: string, type: string, domain: string): number {
    const now = nowIso();
    const row = this._stmtUpsertEntity.get(name, type, domain, now, now) as
      | { id: number }
      | undefined;
    return row?.id ?? 0;
  }

  linkMemoryEntity(memoryId: number, entityId: number): void {
    this._stmtLinkMemoryEntity.run(memoryId, entityId);
  }

  upsertRelationship(
    sourceEntityId: number,
    targetEntityId: number,
    relationshipType: string,
    weight = 1.0,
  ): void {
    const now = nowIso();
    this._stmtUpsertRelationship.run(
      sourceEntityId,
      targetEntityId,
      relationshipType,
      weight,
      now,
      now,
    );
  }

  // ── Schema matching ────────────────────────────────────────────────────

  getSchemasForDomain(domain: string): Array<Record<string, unknown>> {
    const rows = this._db
      .prepare(`SELECT * FROM schemas WHERE domain = ?`)
      .all(domain || "") as Array<Record<string, unknown>>;
    return rows;
  }

  // ── Oscillatory state ──────────────────────────────────────────────────

  loadOscillatoryState(): string | null {
    const row = this._stmtLoadOscillatory.get() as
      | { state_json: string }
      | undefined;
    return row?.state_json ?? null;
  }

  saveOscillatoryState(stateJson: string): void {
    this._stmtSaveOscillatory.run(stateJson);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  close(): void {
    this._db.close();
  }

  // ── Row normalization ──────────────────────────────────────────────────

  /**
   * Normalize a raw SQLite row into a MemoryItem.
   *
   * A3: expose heat_base as heat for callers that predate A3.
   * source: infrastructure/sqlite_store.py:_normalize_memory_row
   */
  private _normalizeRow(row: Record<string, unknown>): MemoryItem {
    const tags = parseJsonArray(row["tags"]);
    const heatBase = (row["heat_base"] as number) ?? 1.0;
    return {
      id: row["id"] as number,
      content: row["content"] as string,
      tags,
      source: (row["source"] as string) ?? "",
      domain: (row["domain"] as string) ?? "",
      directory_context: (row["directory_context"] as string) ?? "",
      created_at: row["created_at"] as string,
      last_accessed: row["last_accessed"] as string,
      heat_base: heatBase,
      heat: heatBase, // A3 alias
      heat_base_set_at: (row["heat_base_set_at"] as string) ?? "",
      no_decay: Boolean(row["no_decay"]),
      surprise_score: (row["surprise_score"] as number) ?? 0.0,
      importance: (row["importance"] as number) ?? 0.5,
      emotional_valence: (row["emotional_valence"] as number) ?? 0.0,
      confidence: (row["confidence"] as number) ?? 1.0,
      access_count: (row["access_count"] as number) ?? 0,
      useful_count: (row["useful_count"] as number) ?? 0,
      plasticity: (row["plasticity"] as number) ?? 1.0,
      stability: (row["stability"] as number) ?? 0.0,
      reconsolidation_count: (row["reconsolidation_count"] as number) ?? 0,
      last_reconsolidated:
        (row["last_reconsolidated"] as string | null) ?? null,
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

  // ── Relationship query (used by graph navigation, not part of core contract) ──

  getRelationshipsForEntity(_entityId: number): RelationshipRecord[] {
    // port-pending: full relationship query belongs in graph navigation module.
    return [];
  }
}
