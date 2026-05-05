/* eslint-disable @typescript-eslint/no-magic-numbers -- all numeric defaults are literal ports from cortex@ed33435 */
/**
 * sqlite-store-relationships.ts — Relationship CRUD mixin for SqliteMemoryStore.
 *
 * Ports: infrastructure/sqlite_store_relationships.py (lines 1-167)
 *
 * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_relationships.py
 */

import type { Database as DatabaseType } from "better-sqlite3";

/**
 * Relationship persistence operations on SQLite.
 *
 * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_relationships.py:9-167
 */
export class SqliteRelationshipMixin {
  protected _rawConn!: DatabaseType;

  /**
   * Batch-update relationship weights via executemany + single commit.
   *
   * precondition:  updates is a list of [rel_id, weight] pairs
   * postcondition: returns count of updated rows; 0 if input is empty
   *
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_relationships.py:14-25
   */
  updateRelationshipsWeightBatch(updates: Array<[number, number]>): number {
    if (updates.length === 0) return 0;
    const stmt = this._rawConn.prepare(
      "UPDATE relationships SET weight = ? WHERE id = ?",
    );
    const runBatch = this._rawConn.transaction(
      (rows: Array<[number, number]>) => {
        for (const [id, weight] of rows) {
          stmt.run(weight, id);
        }
      },
    );
    runBatch(
      updates.map(([id, w]) => [
        parseFloat(String(w)),
        parseInt(String(id), 10),
      ] as [number, number]),
    );
    return updates.length;
  }

  /**
   * Batch-delete relationships by id. Single statement via IN clause.
   *
   * precondition:  relIds is a list of integer ids
   * postcondition: returns count of deleted rows; 0 if input is empty
   *
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_relationships.py:27-37
   */
  deleteRelationshipsBatch(relIds: number[]): number {
    if (relIds.length === 0) return 0;
    const placeholders = relIds.map(() => "?").join(",");
    this._rawConn
      .prepare(`DELETE FROM relationships WHERE id IN (${placeholders})`)
      .run(...relIds.map((r) => parseInt(String(r), 10)));
    return relIds.length;
  }

  /**
   * Insert a relationship row and return its integer id.
   *
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_relationships.py:39-56
   */
  insertRelationship(data: Record<string, unknown>): number {
    const result = this._rawConn
      .prepare(
        "INSERT INTO relationships " +
          "(source_entity_id, target_entity_id, relationship_type, weight, " +
          "is_causal, confidence, created_at, last_reinforced) " +
          "VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), datetime('now'))",
      )
      .run(
        data["source_entity_id"] as number,
        data["target_entity_id"] as number,
        data["relationship_type"] as string,
        (data["weight"] as number) ?? 1.0,
        data["is_causal"] ? 1 : 0,
        (data["confidence"] as number) ?? 1.0,
        (data["created_at"] as string | null) ?? null,
      );
    return result.lastInsertRowid as number;
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_relationships.py:58-61
   */
  countRelationships(): number {
    const row = this._rawConn
      .prepare("SELECT COUNT(*) AS c FROM relationships")
      .get() as { c: number } | undefined;
    return row?.c ?? 0;
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_relationships.py:62-90
   */
  getRelationshipsForEntity(
    entityId: number,
    direction = "both",
    limit = 50,
  ): Record<string, unknown>[] {
    if (direction === "outgoing") {
      return this._rawConn
        .prepare(
          "SELECT r.*, e.name AS target_name, e.type AS target_type " +
            "FROM relationships r " +
            "JOIN entities e ON e.id = r.target_entity_id " +
            "WHERE r.source_entity_id = ? " +
            "ORDER BY r.weight DESC LIMIT ?",
        )
        .all(entityId, limit) as Record<string, unknown>[];
    }
    if (direction === "incoming") {
      return this._rawConn
        .prepare(
          "SELECT r.*, e.name AS source_name, e.type AS source_type " +
            "FROM relationships r " +
            "JOIN entities e ON e.id = r.source_entity_id " +
            "WHERE r.target_entity_id = ? " +
            "ORDER BY r.weight DESC LIMIT ?",
        )
        .all(entityId, limit) as Record<string, unknown>[];
    }
    return this._rawConn
      .prepare(
        "SELECT r.* FROM relationships r " +
          "WHERE r.source_entity_id = ? OR r.target_entity_id = ? " +
          "ORDER BY r.weight DESC LIMIT ?",
      )
      .all(entityId, entityId, limit) as Record<string, unknown>[];
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_relationships.py:92-98
   */
  getAllRelationships(): Record<string, unknown>[] {
    return this._rawConn
      .prepare(
        "SELECT id, source_entity_id, target_entity_id, " +
          "relationship_type, weight, is_causal, confidence " +
          "FROM relationships",
      )
      .all() as Record<string, unknown>[];
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_relationships.py:100-108
   */
  getRelationshipCounts(): Map<number, number> {
    const rows = this._rawConn
      .prepare(
        "SELECT entity_id, COUNT(*) AS cnt FROM (" +
          "  SELECT source_entity_id AS entity_id FROM relationships " +
          "  UNION ALL " +
          "  SELECT target_entity_id AS entity_id FROM relationships" +
          ") sub GROUP BY entity_id",
      )
      .all() as Array<{ entity_id: number; cnt: number }>;
    return new Map(rows.map((r) => [r.entity_id, r.cnt]));
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_relationships.py:110-117
   */
  getEntityRelationshipPairs(): Set<string> {
    const rows = this._rawConn
      .prepare(
        "SELECT e1.name AS source_name, e2.name AS target_name " +
          "FROM relationships r " +
          "JOIN entities e1 ON r.source_entity_id = e1.id " +
          "JOIN entities e2 ON r.target_entity_id = e2.id",
      )
      .all() as Array<{ source_name: string; target_name: string }>;
    // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_relationships.py:117
    // Python returns set of 2-tuples; TS returns Set of "source|target" strings
    return new Set(rows.map((r) => `${r.source_name}|${r.target_name}`));
  }

  /**
   * Hebbian update: co-activation strengthens edges.
   *
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_relationships.py:119-167
   */
  reinforceOrCreateRelationship(
    sourceName: string,
    targetName: string,
    deltaWeight = 0.1,
    relType = "co_retrieval",
  ): void {
    const src = this._rawConn
      .prepare(
        "SELECT id FROM entities WHERE LOWER(name) = LOWER(?) LIMIT 1",
      )
      .get(sourceName) as { id: number } | undefined;
    const tgt = this._rawConn
      .prepare(
        "SELECT id FROM entities WHERE LOWER(name) = LOWER(?) LIMIT 1",
      )
      .get(targetName) as { id: number } | undefined;
    if (src == null || tgt == null) return;
    const sid = src.id;
    const tid = tgt.id;

    // Try to reinforce existing relationship
    const updFwd = this._rawConn
      .prepare(
        "UPDATE relationships SET " +
          "weight = MIN(2.0, weight + ?), " +
          "facilitation = MIN(1.0, facilitation + 0.05), " + // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_relationships.py:142,155
          "last_reinforced = datetime('now') " +
          "WHERE source_entity_id = ? AND target_entity_id = ? " +
          "AND relationship_type = ?",
      )
      .run(deltaWeight, sid, tid, relType);
    if (updFwd.changes > 0) return;

    // Check reverse direction
    const updRev = this._rawConn
      .prepare(
        "UPDATE relationships SET " +
          "weight = MIN(2.0, weight + ?), " +
          "facilitation = MIN(1.0, facilitation + 0.05), " + // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_relationships.py:142,155
          "last_reinforced = datetime('now') " +
          "WHERE source_entity_id = ? AND target_entity_id = ? " +
          "AND relationship_type = ?",
      )
      .run(deltaWeight, tid, sid, relType);
    if (updRev.changes > 0) return;

    // Create new relationship
    this._rawConn
      .prepare(
        "INSERT INTO relationships " +
          "(source_entity_id, target_entity_id, relationship_type, weight) " +
          "VALUES (?, ?, ?, ?)",
      )
      .run(sid, tid, relType, deltaWeight);
  }
}
