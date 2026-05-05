/* eslint-disable @typescript-eslint/no-magic-numbers -- all numeric defaults are literal ports from cortex@ed33435; citations on each method */
/**
 * sqlite-store-entities.ts — Entity CRUD mixin for SqliteMemoryStore.
 *
 * Ports: infrastructure/sqlite_store_entities.py (lines 1-167)
 *
 * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_entities.py
 */

import type { Database as DatabaseType } from "better-sqlite3";

export interface EntityRow {
  id: number;
  name: string;
  type: string;
  domain: string;
  created_at: string;
  last_accessed: string;
  heat: number;
  archived: boolean;
}

/**
 * Entity persistence operations on SQLite.
 *
 * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_entities.py:9-167
 */
export class SqliteEntityMixin {
  protected _conn!: { execute: (...args: unknown[]) => unknown; raw: DatabaseType };
  protected _rawConn!: DatabaseType;

  /** Provided by SqliteMemoryStore. */
  protected _normalizeMemoryRow(row: Record<string, unknown>): Record<string, unknown> {
    return row;
  }

  /**
   * Batch-update entity heat via executemany + single commit.
   *
   * precondition:  updates is a list of [entity_id, heat] pairs
   * postcondition: returns count of updated rows; 0 if input is empty
   *
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_entities.py:18-27
   */
  updateEntitiesHeatBatch(updates: Array<[number, number]>): number {
    if (updates.length === 0) return 0;
    const stmt = this._rawConn.prepare(
      "UPDATE entities SET heat = ? WHERE id = ?",
    );
    const runBatch = this._rawConn.transaction((rows: Array<[number, number]>) => {
      for (const [id, heat] of rows) {
        stmt.run(heat, id);
      }
    });
    runBatch(updates.map(([id, h]) => [parseFloat(String(h)), parseInt(String(id), 10)] as [number, number]));
    return updates.length;
  }

  /**
   * Set heat=0 on many entities. Single statement via IN clause.
   *
   * precondition:  entityIds is a list of integer ids
   * postcondition: returns count of entities archived; 0 if input is empty
   *
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_entities.py:29-39
   */
  archiveEntitiesBatch(entityIds: number[]): number {
    if (entityIds.length === 0) return 0;
    const placeholders = entityIds.map(() => "?").join(",");
    this._rawConn
      .prepare(`UPDATE entities SET heat = 0 WHERE id IN (${placeholders})`)
      .run(...entityIds.map((e) => parseInt(String(e), 10)));
    return entityIds.length;
  }

  /**
   * Insert an entity row and return its integer id.
   *
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_entities.py:41-54
   */
  insertEntity(data: Record<string, unknown>): number {
    const stmt = this._rawConn.prepare(
      "INSERT INTO entities (name, type, domain, created_at, last_accessed, heat) " +
        "VALUES (?, ?, ?, COALESCE(?, datetime('now')), datetime('now'), ?)",
    );
    const result = stmt.run(
      data["name"] as string,
      data["type"] as string,
      (data["domain"] as string) ?? "",
      (data["created_at"] as string | null) ?? null,
      (data["heat"] as number) ?? 1.0,
    );
    return result.lastInsertRowid as number;
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_entities.py:56-59
   */
  getEntityByName(name: string): EntityRow | null {
    const row = this._rawConn
      .prepare("SELECT * FROM entities WHERE name = ?")
      .get(name) as Record<string, unknown> | undefined;
    return row ? (row as unknown as EntityRow) : null;
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_entities.py:61-64
   */
  getEntityById(entityId: number): EntityRow | null {
    const row = this._rawConn
      .prepare("SELECT * FROM entities WHERE id = ?")
      .get(entityId) as Record<string, unknown> | undefined;
    return row ? (row as unknown as EntityRow) : null;
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_entities.py:66-78
   */
  // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_entities.py:66 — minHeat default 0.05
  getAllEntities(
    minHeat = 0.05, // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_entities.py:66
    includeArchived = false,
  ): Record<string, unknown>[] {
    if (includeArchived) {
      return this._rawConn
        .prepare("SELECT * FROM entities WHERE heat >= ?")
        .all(minHeat) as Record<string, unknown>[];
    }
    return this._rawConn
      .prepare("SELECT * FROM entities WHERE heat >= ? AND NOT archived")
      .all(minHeat) as Record<string, unknown>[];
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_entities.py:80-83
   */
  countEntities(): number {
    const row = this._rawConn
      .prepare("SELECT COUNT(*) AS c FROM entities")
      .get() as { c: number } | undefined;
    return row?.c ?? 0;
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_entities.py:85-89
   */
  getEntitiesOfType(entityType: string): Record<string, unknown>[] {
    return this._rawConn
      .prepare("SELECT * FROM entities WHERE type = ?")
      .all(entityType) as Record<string, unknown>[];
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_entities.py:91-95
   */
  getDomainEntityCounts(): Record<string, unknown>[] {
    return this._rawConn
      .prepare(
        "SELECT domain, COUNT(*) AS count FROM entities " +
          "WHERE NOT archived GROUP BY domain ORDER BY count DESC",
      )
      .all() as Record<string, unknown>[];
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_entities.py:97-110
   */
  getIsolatedEntities(limit = 20): Record<string, unknown>[] {
    return this._rawConn
      .prepare(
        `SELECT e.*, COALESCE(r.rel_count, 0) AS relationship_count
            FROM entities e
            LEFT JOIN (
                SELECT source_entity_id AS eid, COUNT(*) AS rel_count
                FROM relationships GROUP BY source_entity_id
            ) r ON r.eid = e.id
            WHERE NOT e.archived
            ORDER BY relationship_count ASC, e.heat DESC
            LIMIT ?`,
      )
      .all(limit) as Record<string, unknown>[];
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_entities.py:112-117
   */
  getResolvedEntityIds(): Set<number> {
    const rows = this._rawConn
      .prepare(
        "SELECT DISTINCT source_entity_id FROM relationships " +
          "WHERE relationship_type = 'resolved_by'",
      )
      .all() as Array<{ source_entity_id: number }>;
    return new Set(rows.map((r) => r.source_entity_id));
  }

  /**
   * Link a memory to an entity. Idempotent via PRIMARY KEY.
   *
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_entities.py:119-126
   */
  insertMemoryEntity(memoryId: number, entityId: number): void {
    this._rawConn
      .prepare(
        "INSERT OR IGNORE INTO memory_entities (memory_id, entity_id) " +
          "VALUES (?, ?)",
      )
      .run(memoryId, entityId);
  }

  /**
   * Return all entities linked to a memory via the join table.
   *
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_entities.py:128-136
   */
  getEntitiesForMemory(memoryId: number): Record<string, unknown>[] {
    return this._rawConn
      .prepare(
        "SELECT e.* FROM entities e " +
          "JOIN memory_entities me ON me.entity_id = e.id " +
          "WHERE me.memory_id = ? ORDER BY e.heat DESC",
      )
      .all(memoryId) as Record<string, unknown>[];
  }

  /**
   * Return all memories linked to an entity via the join table.
   *
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_entities.py:138-146
   */
  getMemoriesForEntity(entityId: number): Record<string, unknown>[] {
    const rows = this._rawConn
      .prepare(
        "SELECT m.* FROM memories m " +
          "JOIN memory_entities me ON me.memory_id = m.id " +
          "WHERE me.entity_id = ? ORDER BY m.heat_base DESC",
      )
      .all(entityId) as Record<string, unknown>[];
    return rows.map((r) => this._normalizeMemoryRow(r));
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_entities.py:148-166
   */
  getMemoriesMentioningEntity(entityName: string, limit = 20): Record<string, unknown>[] {
    // Try FTS5 first
    let rows = this._rawConn
      .prepare(
        "SELECT m.* FROM memories m " +
          "JOIN memories_fts f ON f.rowid = m.id " +
          "WHERE memories_fts MATCH ? " +
          "ORDER BY m.heat_base DESC LIMIT ?",
      )
      .all(entityName, limit) as Record<string, unknown>[];
    if (rows.length === 0) {
      // Fallback to LIKE
      rows = this._rawConn
        .prepare(
          "SELECT * FROM memories WHERE content LIKE ? " +
            "AND NOT is_stale ORDER BY heat_base DESC LIMIT ?",
        )
        .all(`%${entityName}%`, limit) as Record<string, unknown>[];
    }
    return rows.map((r) => this._normalizeMemoryRow(r));
  }
}
