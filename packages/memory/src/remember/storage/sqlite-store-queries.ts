/* eslint-disable @typescript-eslint/no-magic-numbers -- all numeric defaults are literal ports from cortex@ed33435 */
/**
 * sqlite-store-queries.ts — Memory query mixin for SqliteMemoryStore.
 *
 * Filtered reads, time-window queries.
 *
 * Ports: infrastructure/sqlite_store_queries.py (lines 1-153)
 *
 * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_queries.py
 */

import type { Database as DatabaseType } from "better-sqlite3";

/**
 * Read-only memory queries on SQLite.
 *
 * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_queries.py:10-153
 */
export class SqliteQueryMixin {
  protected _rawConn!: DatabaseType;

  /** Provided by SqliteMemoryStore. */
  protected _normalizeMemoryRow(row: Record<string, unknown>): Record<string, unknown> {
    return row;
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_queries.py:19-27
   */
  getMemoriesForDomain(
    domain: string,
    minHeat = 0.05, // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_queries.py:21
    limit = 50,
  ): Record<string, unknown>[] {
    const rows = this._rawConn
      .prepare(
        "SELECT * FROM memories WHERE (domain = ? OR is_global = 1) " +
          "AND heat_base >= ? ORDER BY heat_base DESC LIMIT ?",
      )
      .all(domain, minHeat, limit) as Record<string, unknown>[];
    return rows.map((r) => this._normalizeMemoryRow(r));
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_queries.py:29-37
   */
  getMemoriesForDirectory(
    directory: string,
    minHeat = 0.05, // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_queries.py:30
  ): Record<string, unknown>[] {
    const rows = this._rawConn
      .prepare(
        "SELECT * FROM memories WHERE (directory_context = ? OR is_global = 1) " +
          "AND heat_base >= ? ORDER BY heat_base DESC",
      )
      .all(directory, minHeat) as Record<string, unknown>[];
    return rows.map((r) => this._normalizeMemoryRow(r));
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_queries.py:39-57
   */
  getHotMemories(
    minHeat = 0.7,
    limit = 20,
    includeBenchmarks = false,
  ): Record<string, unknown>[] {
    let rows: Record<string, unknown>[];
    if (includeBenchmarks) {
      rows = this._rawConn
        .prepare(
          "SELECT * FROM memories WHERE heat_base >= ? ORDER BY heat_base DESC LIMIT ?",
        )
        .all(minHeat, limit) as Record<string, unknown>[];
    } else {
      rows = this._rawConn
        .prepare(
          "SELECT * FROM memories WHERE heat_base >= ? " +
            "AND NOT COALESCE(is_benchmark, 0) " +
            "ORDER BY heat_base DESC LIMIT ?",
        )
        .all(minHeat, limit) as Record<string, unknown>[];
    }
    return rows.map((r) => this._normalizeMemoryRow(r));
  }

  /**
   * Return memories that have embeddings in the vec table.
   *
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_queries.py:59-76
   */
  getAllMemoriesWithEmbeddings(): Record<string, unknown>[] {
    const rows = this._rawConn
      .prepare("SELECT id, heat_base FROM memories")
      .all() as Array<{ id: number; heat_base: number }>;
    const results: Record<string, unknown>[] = [];
    for (const r of rows) {
      try {
        const vecRow = this._rawConn
          .prepare("SELECT embedding FROM memories_vec WHERE rowid = ?")
          .get(r.id) as { embedding: Buffer | null } | undefined;
        if (vecRow?.embedding != null) {
          results.push({ id: r.id, heat_base: r.heat_base, embedding: vecRow.embedding });
        }
      } catch {
        continue;
      }
    }
    return results;
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_queries.py:78-86
   */
  // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_queries.py:79
  getAllMemoriesForValidation(limit = 1000): Record<string, unknown>[] { // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_queries.py:79
    const rows = this._rawConn
      .prepare(
        "SELECT * FROM memories WHERE NOT is_stale " +
          "ORDER BY last_accessed ASC LIMIT ?",
      )
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => this._normalizeMemoryRow(r));
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_queries.py:88-96
   */
  getMemoriesCreatedAfter(
    isoTimestamp: string,
    limit = 20,
  ): Record<string, unknown>[] {
    const rows = this._rawConn
      .prepare(
        "SELECT * FROM memories WHERE created_at >= ? " +
          "ORDER BY created_at ASC LIMIT ?",
      )
      .all(isoTimestamp, limit) as Record<string, unknown>[];
    return rows.map((r) => this._normalizeMemoryRow(r));
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_queries.py:98-106
   */
  getMemoriesInTimeWindow(
    centerTime: string,
    windowMinutes: number,
  ): Record<string, unknown>[] {
    const rows = this._rawConn
      .prepare(
        "SELECT * FROM memories WHERE " +
          "ABS((julianday(created_at) - julianday(?)) * 1440) <= ?", // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_queries.py:103; 1440 = minutes per day
      )
      .all(centerTime, windowMinutes) as Record<string, unknown>[];
    return rows.map((r) => this._normalizeMemoryRow(r));
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_queries.py:108-112
   */
  getAllMemoriesForDecay(): Record<string, unknown>[] {
    const rows = this._rawConn
      .prepare("SELECT * FROM memories WHERE NOT is_stale")
      .all() as Record<string, unknown>[];
    return rows.map((r) => this._normalizeMemoryRow(r));
  }

  /**
   * Delete all memories containing the given tag.
   *
   * SQLite lacks jsonb operators — filter in Python then delete by ID.
   *
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_queries.py:114-152
   */
  deleteMemoriesByTag(tag: string): number {
    const rows = this._rawConn
      .prepare("SELECT id, tags FROM memories")
      .all() as Array<{ id: number; tags: string }>;

    const idsToDelete: number[] = [];
    for (const r of rows) {
      try {
        const tags: unknown =
          typeof r.tags === "string" ? JSON.parse(r.tags) : r.tags;
        if (Array.isArray(tags) && tags.includes(tag)) {
          idsToDelete.push(r.id);
        }
      } catch {
        continue;
      }
    }

    if (idsToDelete.length === 0) return 0;

    const placeholders = idsToDelete.map(() => "?").join(",");
    // Delete from FTS
    this._rawConn
      .prepare(`DELETE FROM memories_fts WHERE rowid IN (${placeholders})`)
      .run(...idsToDelete);
    // Delete from vec (best effort)
    try {
      this._rawConn
        .prepare(`DELETE FROM memories_vec WHERE rowid IN (${placeholders})`)
        .run(...idsToDelete);
    } catch {
      // best effort
    }
    // Delete from memories
    const result = this._rawConn
      .prepare(`DELETE FROM memories WHERE id IN (${placeholders})`)
      .run(...idsToDelete);
    return result.changes;
  }
}
