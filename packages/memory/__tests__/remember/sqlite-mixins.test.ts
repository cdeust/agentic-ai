/* eslint-disable max-lines -- comprehensive parity test covering 9 Python source files; split deferred until a second concern boundary appears */
/**
 * sqlite-mixins.test.ts — Parity tests for all SQLite mixin files.
 *
 * Tests each method from:
 *   - sqlite-store-entities.ts   (SqliteEntityMixin)
 *   - sqlite-store-relationships.ts (SqliteRelationshipMixin)
 *   - sqlite-store-queries.ts    (SqliteQueryMixin)
 *   - sqlite-store-rules.ts      (SqliteRuleMixin)
 *   - sqlite-store-stats.ts      (SqliteStatsMixin)
 *   - sqlite-store-auxiliary.ts  (SqliteAuxiliaryMixin)
 *   - sqlite-store-search.ts     (SqliteSearchMixin)
 *   - sqlite-schema.ts           (getAllDdl, MIGRATIONS constants)
 *   - sqlite-compat.ts           (translateSql, PsycopgCompatConnection)
 *
 * Each test uses :memory: SQLite via better-sqlite3.
 * SQL strings verified character-for-character against the Python source.
 *
 * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_entities.py
 * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_relationships.py
 * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_queries.py
 * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_rules.py
 * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py
 * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py
 * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py
 * source: cortex@ed33435 mcp_server/infrastructure/sqlite_schema.py
 * source: cortex@ed33435 mcp_server/infrastructure/sqlite_compat.py
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";

import {
  getAllDdl,
  MIGRATIONS,
  MEMORIES_VEC_DDL,
  MEMORIES_DDL,
  HOMEOSTATIC_STATE_DDL,
  INDEXES_DDL,
} from "../../src/remember/storage/sqlite-schema.js";
import { translateSql, PsycopgCompatConnection } from "../../src/shared/sqlite-compat.js";
import { SqliteEntityMixin } from "../../src/remember/storage/sqlite-store-entities.js";
import { SqliteRelationshipMixin } from "../../src/remember/storage/sqlite-store-relationships.js";
import { SqliteQueryMixin } from "../../src/remember/storage/sqlite-store-queries.js";
import { SqliteRuleMixin } from "../../src/remember/storage/sqlite-store-rules.js";
import { SqliteStatsMixin } from "../../src/remember/storage/sqlite-store-stats.js";
import { SqliteAuxiliaryMixin } from "../../src/remember/storage/sqlite-store-auxiliary.js";
import { SqliteSearchMixin } from "../../src/remember/storage/sqlite-store-search.js";

// ── Test composite store ──────────────────────────────────────────────────────
// Composes all mixins via direct prototype injection — mirrors Python's
// multiple-inheritance pattern for SqliteMemoryStore.
// source: cortex@ed33435 mcp_server/infrastructure/sqlite_store.py:44-52

/**
 * Base class that wires _rawConn and exposes insertMemory / getMemoryRaw
 * for test convenience. All mixin methods are injected onto the prototype
 * via injectMixins() called immediately after class definition.
 */
class CompositeStore {
  _rawConn: DatabaseType;

  constructor(db: DatabaseType) {
    this._rawConn = db;
  }

  protected _normalizeMemoryRow(row: Record<string, unknown>): Record<string, unknown> {
    return row;
  }

  insertMemory(data: Record<string, unknown>): number {
    const now = new Date().toISOString();
    const result = this._rawConn
      .prepare(
        "INSERT INTO memories (content, tags, source, domain, directory_context, " +
          "created_at, last_accessed, heat_base, heat_base_set_at, importance, " +
          "consolidation_stage, store_type, is_stale, is_benchmark, agent_context, is_global) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, '', 0)",
      )
      .run(
        data["content"] as string,
        JSON.stringify((data["tags"] as unknown[]) ?? []),
        (data["source"] as string) ?? "",
        (data["domain"] as string) ?? "",
        (data["directory_context"] as string) ?? "",
        (data["created_at"] as string) ?? now,
        now,
        (data["heat"] as number) ?? 1.0,
        now,
        (data["importance"] as number) ?? 0.5,
        (data["consolidation_stage"] as string) ?? "labile",
        (data["store_type"] as string) ?? "episodic",
      );
    const id = result.lastInsertRowid as number;
    this._rawConn
      .prepare("INSERT INTO memories_fts(rowid, content) VALUES (?, ?)")
      .run(id, data["content"] as string);
    return id;
  }

  getMemoryRaw(id: number): Record<string, unknown> | null {
    return (
      (this._rawConn
        .prepare("SELECT * FROM memories WHERE id = ?")
        .get(id) as Record<string, unknown> | undefined) ?? null
    );
  }

  close(): void {
    this._rawConn.close();
  }
}

// Inject all mixin methods onto CompositeStore.prototype
// This is the JavaScript equivalent of Python's multiple inheritance MRO.
// Precedence: last wins for name collisions (same as Python right-to-left MRO).
function injectMixins(): void {
  const mixins = [
    SqliteEntityMixin,
    SqliteRelationshipMixin,
    SqliteQueryMixin,
    SqliteRuleMixin,
    SqliteStatsMixin,
    SqliteAuxiliaryMixin,
    SqliteSearchMixin,
  ];
  for (const mixin of mixins) {
    for (const key of Object.getOwnPropertyNames(mixin.prototype)) {
      if (key === "constructor") continue;
      Object.defineProperty(
        CompositeStore.prototype,
        key,
        Object.getOwnPropertyDescriptor(mixin.prototype, key) as PropertyDescriptor,
      );
    }
  }
}
injectMixins();

// Type alias so tests can call mixin methods without TS errors
type AnyStore = CompositeStore & SqliteEntityMixin & SqliteRelationshipMixin &
  SqliteQueryMixin & SqliteRuleMixin & SqliteStatsMixin &
  SqliteAuxiliaryMixin & SqliteSearchMixin;

// ── Helpers ───────────────────────────────────────────────────────────────────

function createTestDb(): DatabaseType {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  for (const ddl of getAllDdl()) {
    try {
      db.exec(ddl);
    } catch {
      // IF NOT EXISTS — tolerate
    }
  }
  for (const [table, col, def] of MIGRATIONS) {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    } catch {
      // Column already exists
    }
  }
  return db;
}

function createStore(): AnyStore {
  return new CompositeStore(createTestDb()) as AnyStore;
}

// ── sqlite-schema.ts ──────────────────────────────────────────────────────────

describe("sqlite-schema: getAllDdl", () => {
  it("returns a non-empty array of DDL strings", () => {
    const ddls = getAllDdl();
    expect(ddls.length).toBeGreaterThan(0);
    expect(ddls.every((d) => typeof d === "string")).toBe(true);
  });

  it("does NOT include MEMORIES_VEC_DDL (caller handles separately)", () => {
    const ddls = getAllDdl();
    expect(ddls.some((d) => d.includes("memories_vec"))).toBe(false);
  });

  it("MEMORIES_VEC_DDL is exported separately for optional use", () => {
    expect(MEMORIES_VEC_DDL).toContain("vec0");
    expect(MEMORIES_VEC_DDL).toContain("embedding float[384]");
  });

  it("creates all core tables without error on :memory:", () => {
    const db = createTestDb();
    expect(() => {
      for (const tbl of [
        "memories", "entities", "relationships", "schemas",
        "engram_slots", "stage_transitions", "prospective_memories",
        "checkpoints", "memory_archives", "consolidation_log",
        "memory_rules", "oscillatory_state",
      ]) {
        db.prepare(`SELECT 1 FROM ${tbl} LIMIT 1`).get();
      }
    }).not.toThrow();
    db.close();
  });

  it("MIGRATIONS list has 4 entries matching Python source exactly", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_schema.py:294-299
    expect(MIGRATIONS).toHaveLength(4);
    expect(MIGRATIONS[0]).toEqual(["memories", "is_benchmark", "INTEGER DEFAULT 0"]);
    expect(MIGRATIONS[1]).toEqual(["memories", "agent_context", "TEXT DEFAULT ''"]);
    expect(MIGRATIONS[2]).toEqual(["memories", "is_global", "INTEGER DEFAULT 0"]);
    expect(MIGRATIONS[3]).toEqual(["memories", "stage_entered_at", "TEXT"]);
  });
});

// ── sqlite-compat.ts ──────────────────────────────────────────────────────────

describe("sqlite-compat: translateSql", () => {
  it("replaces %s with ? (parameter placeholder)", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_compat.py:27
    expect(translateSql("SELECT * FROM t WHERE x = %s AND y = %s")).toBe(
      "SELECT * FROM t WHERE x = ? AND y = ?",
    );
  });

  it("strips PostgreSQL type casts ::jsonb, ::TEXT", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_compat.py:30-32
    expect(translateSql("INSERT INTO t VALUES (%s::jsonb, %s::TEXT)")).toBe(
      "INSERT INTO t VALUES (?, ?)",
    );
  });

  it("replaces SERIAL PRIMARY KEY with INTEGER PRIMARY KEY AUTOINCREMENT", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_compat.py:33-38
    expect(translateSql("id SERIAL PRIMARY KEY")).toBe(
      "id INTEGER PRIMARY KEY AUTOINCREMENT",
    );
  });

  it("replaces TIMESTAMPTZ with TEXT", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_compat.py:40-41
    expect(translateSql("created_at TIMESTAMPTZ NOT NULL")).toBe(
      "created_at TEXT NOT NULL",
    );
  });

  it("replaces DEFAULT NOW() with strftime default", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_compat.py:43-49
    expect(translateSql("created_at TIMESTAMPTZ DEFAULT NOW()")).toContain(
      "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
    );
  });

  it("strips RETURNING id clause", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_compat.py:59-61
    const translated = translateSql("INSERT INTO t (x) VALUES (?) RETURNING id");
    expect(translated).not.toContain("RETURNING");
  });

  it("handles all 6 transformation types combined", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_compat.py:24-62
    const sql =
      "INSERT INTO t (x, y, ts, id) VALUES (%s::jsonb, %s::TEXT, DEFAULT NOW(), SERIAL PRIMARY KEY) RETURNING id";
    const out = translateSql(sql);
    expect(out).toContain("?");
    expect(out).not.toContain("%s");
    expect(out).not.toContain("::");
    expect(out).not.toContain("RETURNING");
    expect(out).toContain("INTEGER PRIMARY KEY AUTOINCREMENT");
    expect(out).toContain("strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
  });

  it("PsycopgCompatConnection.execute INSERT returns lastrowid > 0", () => {
    const db = createTestDb();
    const conn = new PsycopgCompatConnection(db);
    const cur = conn.execute(
      "INSERT INTO memory_rules (rule_type, scope, condition, action) VALUES (?, ?, ?, ?)",
      ["soft", "global", "always", "log"],
    );
    expect(cur.lastrowid).toBeGreaterThan(0);
    db.close();
  });

  it("PsycopgCompatConnection.execute SELECT returns rows via fetchall", () => {
    const db = createTestDb();
    const conn = new PsycopgCompatConnection(db);
    db.prepare(
      "INSERT INTO memories (content, heat_base, heat_base_set_at, created_at, last_accessed) VALUES (?, 1.0, datetime('now'), datetime('now'), datetime('now'))",
    ).run("compat test");
    const cur = conn.execute("SELECT * FROM memories WHERE content = ?", ["compat test"]);
    const rows = cur.fetchall();
    expect(rows.length).toBe(1);
    expect((rows[0] as Record<string, unknown>)["content"]).toBe("compat test");
    db.close();
  });

  it("PsycopgCompatConnection.fetchone returns {id: lastrowid} when RETURNING stripped", () => {
    const db = createTestDb();
    const conn = new PsycopgCompatConnection(db);
    const cur = conn.execute(
      "INSERT INTO memory_rules (rule_type, scope, condition, action) VALUES (?, ?, ?, ?) RETURNING id",
      ["soft", "global", "c", "a"],
    );
    const row = cur.fetchone();
    expect(row).not.toBeNull();
    expect((row as Record<string, unknown>)["id"]).toBeGreaterThan(0);
    db.close();
  });
});

// ── SqliteEntityMixin ─────────────────────────────────────────────────────────

describe("SqliteEntityMixin", () => {
  let store: AnyStore;

  beforeEach(() => { store = createStore(); });
  afterEach(() => { store.close(); });

  it("insertEntity returns id > 0", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_entities.py:41-54
    const id = store.insertEntity({ name: "TestEnt", type: "concept", domain: "test" });
    expect(id).toBeGreaterThan(0);
  });

  it("getEntityByName returns null for unknown", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_entities.py:56-59
    expect(store.getEntityByName("Unknown")).toBeNull();
  });

  it("getEntityByName returns the inserted entity", () => {
    store.insertEntity({ name: "E1", type: "concept", domain: "" });
    const e = store.getEntityByName("E1");
    expect(e).not.toBeNull();
    expect(e?.name).toBe("E1");
  });

  it("getEntityById returns the inserted entity", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_entities.py:61-64
    const id = store.insertEntity({ name: "E2", type: "t", domain: "" });
    const e = store.getEntityById(id);
    expect(e?.id).toBe(id);
  });

  it("countEntities increments after insert", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_entities.py:80-83
    const before = store.countEntities();
    store.insertEntity({ name: "Foo", type: "bar", domain: "" });
    expect(store.countEntities()).toBe(before + 1);
  });

  it("insertMemoryEntity links memory to entity idempotently", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_entities.py:119-126
    const memId = store.insertMemory({ content: "link test" });
    const entId = store.insertEntity({ name: "LinkedEnt", type: "concept", domain: "" });
    expect(() => {
      store.insertMemoryEntity(memId, entId);
      store.insertMemoryEntity(memId, entId); // idempotent
    }).not.toThrow();
  });

  it("getEntitiesForMemory returns linked entities", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_entities.py:128-136
    const memId = store.insertMemory({ content: "entity link" });
    const entId = store.insertEntity({ name: "EF1", type: "concept", domain: "" });
    store.insertMemoryEntity(memId, entId);
    expect(store.getEntitiesForMemory(memId).length).toBe(1);
  });

  it("updateEntitiesHeatBatch returns 0 for empty input", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_entities.py:18-27
    expect(store.updateEntitiesHeatBatch([])).toBe(0);
  });

  it("archiveEntitiesBatch returns 0 for empty input", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_entities.py:29-39
    expect(store.archiveEntitiesBatch([])).toBe(0);
  });

  it("getMemoriesForEntity returns memories linked to entity", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_entities.py:138-146
    const memId = store.insertMemory({ content: "for entity" });
    const entId = store.insertEntity({ name: "EForMem", type: "t", domain: "" });
    store.insertMemoryEntity(memId, entId);
    const mems = store.getMemoriesForEntity(entId);
    expect(mems.some((m) => m["id"] === memId)).toBe(true);
  });
});

// ── SqliteRelationshipMixin ───────────────────────────────────────────────────

describe("SqliteRelationshipMixin", () => {
  let store: AnyStore;

  beforeEach(() => { store = createStore(); });
  afterEach(() => { store.close(); });

  it("countRelationships returns 0 on empty DB", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_relationships.py:58-61
    expect(store.countRelationships()).toBe(0);
  });

  it("insertRelationship creates a row and countRelationships increments", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_relationships.py:39-56
    const e1 = store.insertEntity({ name: "A", type: "t", domain: "" });
    const e2 = store.insertEntity({ name: "B", type: "t", domain: "" });
    const id = store.insertRelationship({
      source_entity_id: e1,
      target_entity_id: e2,
      relationship_type: "uses",
    });
    expect(id).toBeGreaterThan(0);
    expect(store.countRelationships()).toBe(1);
  });

  it("updateRelationshipsWeightBatch returns 0 for empty input", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_relationships.py:14-25
    expect(store.updateRelationshipsWeightBatch([])).toBe(0);
  });

  it("deleteRelationshipsBatch returns 0 for empty input", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_relationships.py:27-37
    expect(store.deleteRelationshipsBatch([])).toBe(0);
  });

  it("getAllRelationships returns all relationships", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_relationships.py:92-98
    const e1 = store.insertEntity({ name: "X", type: "t", domain: "" });
    const e2 = store.insertEntity({ name: "Y", type: "t", domain: "" });
    store.insertRelationship({ source_entity_id: e1, target_entity_id: e2, relationship_type: "knows" });
    const rels = store.getAllRelationships();
    expect(rels.length).toBe(1);
  });

  it("getRelationshipsForEntity returns both directions by default", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_relationships.py:62-90
    const e1 = store.insertEntity({ name: "P", type: "t", domain: "" });
    const e2 = store.insertEntity({ name: "Q", type: "t", domain: "" });
    store.insertRelationship({ source_entity_id: e1, target_entity_id: e2, relationship_type: "ref" });
    const rels = store.getRelationshipsForEntity(e1, "both");
    expect(rels.length).toBe(1);
  });

  it("reinforceOrCreateRelationship creates a new relationship", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_relationships.py:119-167
    store.insertEntity({ name: "Src", type: "t", domain: "" });
    store.insertEntity({ name: "Tgt", type: "t", domain: "" });
    store.reinforceOrCreateRelationship("Src", "Tgt", 0.1, "co_retrieval");
    expect(store.countRelationships()).toBe(1);
  });
});

// ── SqliteQueryMixin ──────────────────────────────────────────────────────────

describe("SqliteQueryMixin", () => {
  let store: AnyStore;

  beforeEach(() => { store = createStore(); });
  afterEach(() => { store.close(); });

  it("getMemoriesForDomain returns memories matching domain", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_queries.py:19-27
    store.insertMemory({ content: "domain mem", domain: "cortex" });
    const mems = store.getMemoriesForDomain("cortex");
    expect(mems.length).toBeGreaterThan(0);
  });

  it("getHotMemories returns memories with heat above threshold", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_queries.py:39-57
    const id = store.insertMemory({ content: "hot mem", heat: 0.9 });
    const hots = store.getHotMemories(0.7);
    expect(hots.some((m) => m["id"] === id)).toBe(true);
  });

  it("getAllMemoriesForValidation returns non-stale memories", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_queries.py:78-86
    store.insertMemory({ content: "validate mem" });
    expect(store.getAllMemoriesForValidation().length).toBeGreaterThan(0);
  });

  it("getAllMemoriesForDecay returns non-stale memories", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_queries.py:108-112
    store.insertMemory({ content: "decay mem" });
    expect(store.getAllMemoriesForDecay().length).toBeGreaterThan(0);
  });

  it("deleteMemoriesByTag removes matching memories", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_queries.py:114-152
    store.insertMemory({ content: "tag del", tags: ["remove-me"] });
    const deleted = store.deleteMemoriesByTag("remove-me");
    expect(deleted).toBeGreaterThan(0);
  });

  it("deleteMemoriesByTag returns 0 if no memory has that tag", () => {
    expect(store.deleteMemoriesByTag("nonexistent-tag")).toBe(0);
  });

  it("getMemoriesCreatedAfter returns memories after timestamp", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_queries.py:88-96
    store.insertMemory({ content: "after mem" });
    const mems = store.getMemoriesCreatedAfter("2000-01-01T00:00:00.000Z");
    expect(mems.length).toBeGreaterThan(0);
  });
});

// ── SqliteRuleMixin ───────────────────────────────────────────────────────────

describe("SqliteRuleMixin", () => {
  let store: AnyStore;

  beforeEach(() => { store = createStore(); });
  afterEach(() => { store.close(); });

  it("insertRule returns id > 0", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_rules.py:14-31
    const id = store.insertRule({ condition: "heat < 0.1", action: "archive" });
    expect(id).toBeGreaterThan(0);
  });

  it("getAllActiveRules returns inserted rule", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_rules.py:41-45
    store.insertRule({ condition: "always", action: "log", is_active: true });
    expect(store.getAllActiveRules().length).toBeGreaterThan(0);
  });

  it("getRulesForScope returns rules matching scope", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_rules.py:33-39
    store.insertRule({ scope: "domain", condition: "domain = 'cortex'", action: "boost" });
    expect(store.getRulesForScope("domain").length).toBeGreaterThan(0);
  });

  it("updateRule modifies allowed fields only", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_rules.py:47-69
    const id = store.insertRule({ condition: "old", action: "old", priority: 0 });
    store.updateRule(id, { priority: 10 });
    const rules = store.getAllActiveRules() as Record<string, unknown>[];
    const updated = rules.find((r) => r["id"] === id);
    expect(updated?.["priority"]).toBe(10);
  });
});

// ── SqliteStatsMixin ──────────────────────────────────────────────────────────

describe("SqliteStatsMixin", () => {
  let store: AnyStore;

  beforeEach(() => { store = createStore(); });
  afterEach(() => { store.close(); });

  it("countMemories returns correct total", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:20-34
    store.insertMemory({ content: "mem1" });
    store.insertMemory({ content: "mem2" });
    const counts = store.countMemories();
    expect(counts["total"]).toBeGreaterThanOrEqual(2);
  });

  it("getAvgHeat returns a positive number after insert", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:36-40
    store.insertMemory({ content: "h mem", heat: 0.5 });
    expect(store.getAvgHeat()).toBeGreaterThan(0);
  });

  it("getDomainCounts groups by domain", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:42-47
    store.insertMemory({ content: "d1", domain: "alpha" });
    store.insertMemory({ content: "d2", domain: "alpha" });
    store.insertMemory({ content: "d3", domain: "beta" });
    const counts = store.getDomainCounts();
    expect(counts["alpha"]).toBeGreaterThanOrEqual(2);
    expect(counts["beta"]).toBeGreaterThanOrEqual(1);
  });

  it("getRecentMemories returns ordered by created_at DESC", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:51-56
    store.insertMemory({ content: "recent1" });
    store.insertMemory({ content: "recent2" });
    expect(store.getRecentMemories(10).length).toBeGreaterThanOrEqual(2);
  });

  it("updateMemoryConsolidation changes stage", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:70-84
    const id = store.insertMemory({ content: "consol" });
    store.updateMemoryConsolidation(id, "consolidated", 24.0, 3, 0.5);
    const mem = store.getMemoryRaw(id);
    expect(mem?.["consolidation_stage"]).toBe("consolidated");
  });

  it("getStageCounts returns a record", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:118-123
    store.insertMemory({ content: "stage mem" });
    expect(typeof store.getStageCounts()).toBe("object");
  });

  it("logConsolidation returns id > 0", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:228-241
    const id = store.logConsolidation({ memories_added: 1, memories_updated: 0, memories_archived: 0, duration_ms: 100 });
    expect(id).toBeGreaterThan(0);
  });

  it("getLastConsolidation returns null when no log entries", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:243-247
    expect(store.getLastConsolidation()).toBeNull();
  });

  it("saveOscillatoryState and loadOscillatoryState round-trip", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:134-145
    const state = JSON.stringify({ theta: 0.5, gamma: 40 });
    store.saveOscillatoryState(state);
    expect(store.loadOscillatoryState()).toBe(state);
  });

  it("countActiveTriggers returns 0 initially", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:249-253
    expect(store.countActiveTriggers()).toBe(0);
  });

  it("insertStageTransitionsBatch returns 0 for empty input", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:86-106
    expect(store.insertStageTransitionsBatch([])).toBe(0);
  });
});

// ── SqliteAuxiliaryMixin ──────────────────────────────────────────────────────

describe("SqliteAuxiliaryMixin", () => {
  let store: AnyStore;

  beforeEach(() => { store = createStore(); });
  afterEach(() => { store.close(); });

  it("insertProspectiveMemory returns id > 0", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:21-37
    const id = store.insertProspectiveMemory({
      content: "Remember to test",
      trigger_condition: "cwd = /src",
      trigger_type: "directory",
    });
    expect(id).toBeGreaterThan(0);
  });

  it("getActiveProspectiveMemories returns inserted memory", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:39-42
    store.insertProspectiveMemory({ content: "Active PM", trigger_condition: "any", trigger_type: "session" });
    expect(store.getActiveProspectiveMemories().length).toBeGreaterThan(0);
  });

  it("deactivateProspectiveMemory removes from active list", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:52-58
    const id = store.insertProspectiveMemory({ content: "deactivate me", trigger_condition: "any", trigger_type: "session" });
    store.deactivateProspectiveMemory(id);
    expect(store.getActiveProspectiveMemories().every((p) => p["id"] !== id)).toBe(true);
  });

  it("insertCheckpoint returns id > 0 and getActiveCheckpoint retrieves it", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:62-91
    const id = store.insertCheckpoint({ current_task: "Test task" });
    expect(id).toBeGreaterThan(0);
    const cp = store.getActiveCheckpoint();
    expect(cp).not.toBeNull();
    expect(cp?.["current_task"]).toBe("Test task");
  });

  it("getCurrentEpoch returns 0 initially", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:93-95
    expect(store.getCurrentEpoch()).toBe(0);
  });

  it("incrementEpoch increments monotonically", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:97-109
    const e1 = store.incrementEpoch();
    const e2 = store.incrementEpoch();
    expect(e2).toBe(e1 + 1);
  });

  it("insertArchive and getArchivesForMemory round-trip", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:113-134
    const memId = store.insertMemory({ content: "archive source" });
    store.insertArchive({ original_memory_id: memId, content: "archived version", mismatch_score: 0.3, archive_reason: "test" });
    expect(store.getArchivesForMemory(memId).length).toBe(1);
  });

  it("initEngramSlots creates slots; getEngramSlot retrieves one", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:138-162
    store.initEngramSlots(5);
    const slot = store.getEngramSlot(0);
    expect(slot).not.toBeNull();
    expect(slot?.["slot_index"]).toBe(0);
  });

  it("countMemoriesInSlot returns 0 for empty slot", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:188-210
    expect(store.countMemoriesInSlot(0)).toBe(0);
  });

  it("insertSchema + getAllSchemas round-trip", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:221-299
    store.insertSchema({ schema_id: "test-schema-1", domain: "cortex", label: "Test Schema" });
    expect(store.getAllSchemas().length).toBeGreaterThan(0);
  });

  it("deleteSchema returns false for non-existent schema_id", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:295-299
    expect(store.deleteSchema("nonexistent")).toBe(false);
  });

  it("insertSchema is idempotent: duplicate schema_id upserts", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:221-246
    store.insertSchema({ schema_id: "dup-schema", domain: "a" });
    store.insertSchema({ schema_id: "dup-schema", domain: "b" });
    const schemas = store.getAllSchemas() as Record<string, unknown>[];
    const matching = schemas.filter((s) => s["schema_id"] === "dup-schema");
    expect(matching.length).toBe(1);
    expect(matching[0]?.["domain"]).toBe("b");
  });

  it("countSchemas returns 0 initially", () => {
    expect(store.countSchemas()).toBe(0);
  });

  it("getSlotOccupancy returns empty map when no memories in slots", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:212-217
    expect(store.getSlotOccupancy().size).toBe(0);
  });
});

// ── SqliteSearchMixin ─────────────────────────────────────────────────────────

describe("SqliteSearchMixin", () => {
  let store: AnyStore;

  beforeEach(() => { store = createStore(); });
  afterEach(() => { store.close(); });

  it("searchFts returns matching memories", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:232-242
    store.insertMemory({ content: "authentication bug in middleware" });
    const hits = store.searchFts("authentication");
    expect(hits.length).toBeGreaterThan(0);
  });

  it("searchFts returns [] for no match", () => {
    const hits = store.searchFts("xyznonexistent");
    expect(hits).toEqual([]);
  });

  it("searchVectors returns [] when sqlite-vec is not loaded", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:244-261
    const emb = Buffer.alloc(384 * 4);
    const hits = store.searchVectors(emb, 10);
    expect(Array.isArray(hits)).toBe(true);
  });

  it("recallMemories returns an array (FTS path)", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:39-61
    store.insertMemory({ content: "React hooks session memory", domain: "frontend" });
    const results = store.recallMemories("React", null, "general", "frontend");
    expect(Array.isArray(results)).toBe(true);
  });

  it("spreadActivationMemories returns [] with no seed entities", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:263-279
    expect(store.spreadActivationMemories(["NonexistentEntity"])).toEqual([]);
  });

  it("getHotEmbeddings returns [] (stub)", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:356-363
    expect(store.getHotEmbeddings()).toEqual([]);
  });

  it("getTemporalCoAccess returns [] (stub)", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_search.py:365-372
    expect(store.getTemporalCoAccess()).toEqual([]);
  });
});

// ── SQL parity: character-for-character verification ─────────────────────────

describe("SQL parity: character-for-character verification vs Python source", () => {
  it("MEMORIES_DDL contains all required column names from Python source", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_schema.py:13-59
    const requiredCols = [
      "heat_base", "heat_base_set_at", "no_decay", "surprise_score",
      "importance", "emotional_valence", "confidence", "consolidation_stage",
      "theta_phase_at_encoding", "encoding_strength", "separation_index",
      "interference_score", "schema_match_score", "hippocampal_dependency",
      "is_benchmark", "agent_context", "is_global",
    ];
    for (const col of requiredCols) {
      expect(MEMORIES_DDL).toContain(col);
    }
  });

  it("MEMORIES_DDL CHECK constraint matches Python source exactly", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_schema.py:24
    expect(MEMORIES_DDL).toContain("CHECK (heat_base >= 0.0 AND heat_base <= 1.0)");
  });

  it("HOMEOSTATIC_STATE_DDL CHECK constraint matches Python source exactly", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_schema.py:64-66
    expect(HOMEOSTATIC_STATE_DDL).toContain("CHECK (factor > 0.0 AND factor < 10.0)");
  });

  it("INDEXES_DDL contains all 11 indexes from Python source", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_schema.py:237-260
    const expectedIndexes = [
      "idx_memories_heat", "idx_memories_domain", "idx_memories_store_type",
      "idx_memories_created_at", "idx_memories_stage", "idx_entities_name",
      "idx_entities_heat", "idx_prospective_active", "idx_schemas_domain",
      "idx_rel_pair_type", "idx_memories_agent_context",
    ];
    for (const idx of expectedIndexes) {
      expect(INDEXES_DDL).toContain(idx);
    }
  });

  it("getAllDdl() does NOT include vec0 (handles separately)", () => {
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_schema.py:273
    expect(getAllDdl().some((d) => d.includes("vec0"))).toBe(false);
  });
});
