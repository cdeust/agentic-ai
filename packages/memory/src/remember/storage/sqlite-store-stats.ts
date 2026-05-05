/* eslint-disable @typescript-eslint/no-magic-numbers -- all numeric defaults are literal ports from cortex@ed33435 */
/**
 * sqlite-store-stats.ts — Stats, diagnostics, consolidation, oscillatory state mixin.
 *
 * Ports: infrastructure/sqlite_store_stats.py (lines 1-254)
 *
 * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py
 */

import type { Database as DatabaseType } from "better-sqlite3";

/**
 * Diagnostics, consolidation stages, CLS queries on SQLite.
 *
 * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:9-254
 */
export class SqliteStatsMixin {
  protected _rawConn!: DatabaseType;

  /** Provided by SqliteMemoryStore. */
  protected _normalizeMemoryRow(row: Record<string, unknown>): Record<string, unknown> {
    return row;
  }

  // ── Counts ─────────────────────────────────────────────────────────────────

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:20-34
   */
  countMemories(): Record<string, number> {
    const row = this._rawConn
      .prepare(`
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN store_type = 'episodic' THEN 1 ELSE 0 END) AS episodic,
                SUM(CASE WHEN store_type = 'semantic' THEN 1 ELSE 0 END) AS semantic,
                -- // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:26 — 0.05 heat threshold
                SUM(CASE WHEN heat_base >= 0.05 THEN 1 ELSE 0 END) AS active,
                -- // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:27 — 0.05 heat threshold
                SUM(CASE WHEN heat_base < 0.05 THEN 1 ELSE 0 END) AS archived,
                SUM(CASE WHEN is_stale THEN 1 ELSE 0 END) AS stale,
                SUM(CASE WHEN is_protected THEN 1 ELSE 0 END) AS protected
            FROM memories
        `)
      .get() as Record<string, number | null> | undefined;
    if (row == null) return {};
    return Object.fromEntries(
      Object.entries(row).map(([k, v]) => [k, (v as number | null) ?? 0]),
    );
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:36-40
   */
  getAvgHeat(): number {
    const row = this._rawConn
      .prepare("SELECT AVG(heat_base) AS avg_heat FROM memories")
      .get() as { avg_heat: number | null } | undefined;
    return row?.avg_heat ?? 0.0;
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:42-47
   */
  getDomainCounts(): Record<string, number> {
    const rows = this._rawConn
      .prepare(
        "SELECT COALESCE(domain, 'unclassified') AS d, COUNT(*) AS c " +
          "FROM memories WHERE NOT is_stale GROUP BY domain",
      )
      .all() as Array<{ d: string; c: number }>;
    return Object.fromEntries(rows.map((r) => [r.d, r.c]));
  }

  // ── Dashboard ──────────────────────────────────────────────────────────────

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:51-56
   */
  getRecentMemories(limit = 20): Record<string, unknown>[] {
    const rows = this._rawConn
      .prepare("SELECT * FROM memories ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => this._normalizeMemoryRow(r));
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:58-66
   */
  getRecentlyAccessedMemories(
    limit = 20,
    minAccessCount = 1,
  ): Record<string, unknown>[] {
    const rows = this._rawConn
      .prepare(
        "SELECT * FROM memories WHERE access_count >= ? " +
          "AND NOT is_stale ORDER BY last_accessed DESC LIMIT ?",
      )
      .all(minAccessCount, limit) as Record<string, unknown>[];
    return rows.map((r) => this._normalizeMemoryRow(r));
  }

  // ── Consolidation ──────────────────────────────────────────────────────────

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:70-84
   */
  updateMemoryConsolidation(
    memoryId: number,
    stage: string,
    hoursInStage: number,
    replayCount: number,
    hippocampalDependency: number,
  ): void {
    this._rawConn
      .prepare(
        "UPDATE memories SET consolidation_stage = ?, " +
          "hours_in_stage = ?, replay_count = ?, " +
          "hippocampal_dependency = ? WHERE id = ?",
      )
      .run(stage, hoursInStage, replayCount, hippocampalDependency, memoryId);
  }

  /**
   * Batch-insert cascade stage-transition rows via executemany.
   *
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:86-106
   */
  insertStageTransitionsBatch(rows: Record<string, unknown>[]): number {
    if (rows.length === 0) return 0;
    const stmt = this._rawConn.prepare(
      "INSERT INTO stage_transitions " +
        "(memory_id, from_stage, to_stage, hours_in_prev_stage, trigger) " +
        "VALUES (?, ?, ?, ?, ?)",
    );
    const runBatch = this._rawConn.transaction(
      (batchRows: Record<string, unknown>[]) => {
        for (const r of batchRows) {
          stmt.run(
            parseInt(String(r["memory_id"]), 10),
            String(r["from_stage"]),
            String(r["to_stage"]),
            parseFloat(String(r["hours_in_prev"])),
            String(r["trigger"] ?? "cascade"),
          );
        }
      },
    );
    runBatch(rows);
    return rows.length;
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:108-116
   */
  // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:108
  getMemoriesByStage(stage: string, limit = 100): Record<string, unknown>[] { // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:108
    const rows = this._rawConn
      .prepare(
        "SELECT * FROM memories WHERE consolidation_stage = ? " +
          "ORDER BY hours_in_stage DESC LIMIT ?",
      )
      .all(stage, limit) as Record<string, unknown>[];
    return rows.map((r) => this._normalizeMemoryRow(r));
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:118-123
   */
  getStageCounts(): Record<string, number> {
    const rows = this._rawConn
      .prepare(
        "SELECT consolidation_stage, COUNT(*) AS c FROM memories " +
          "GROUP BY consolidation_stage",
      )
      .all() as Array<{ consolidation_stage: string; c: number }>;
    return Object.fromEntries(rows.map((r) => [r.consolidation_stage, r.c]));
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:125-130
   */
  incrementReplayCount(memoryId: number): void {
    this._rawConn
      .prepare(
        "UPDATE memories SET replay_count = replay_count + 1 WHERE id = ?",
      )
      .run(memoryId);
  }

  // ── Oscillatory State ──────────────────────────────────────────────────────

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:134-139
   */
  saveOscillatoryState(stateJson: string): void {
    this._rawConn
      .prepare(
        "INSERT OR REPLACE INTO oscillatory_state (id, state_json) VALUES (1, ?)",
      )
      .run(stateJson);
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:141-145
   */
  loadOscillatoryState(): string | null {
    const row = this._rawConn
      .prepare("SELECT state_json FROM oscillatory_state WHERE id = 1")
      .get() as { state_json: string } | undefined;
    return row?.state_json ?? null;
  }

  // ── Interference ───────────────────────────────────────────────────────────

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:149-159
   */
  getSimilarMemoriesForInterference(
    domain: string,
    limit = 50,
  ): Record<string, unknown>[] {
    return this._rawConn
      .prepare(
        "SELECT id, heat_base, importance, " +
          "consolidation_stage, directory_context, interference_score " +
          "FROM memories WHERE domain = ? " +
          "AND NOT is_stale ORDER BY heat_base DESC LIMIT ?",
      )
      .all(domain, limit) as Record<string, unknown>[];
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:161-178
   */
  updateMemoryInterference(
    memoryId: number,
    interferenceScore: number,
    separationIndex?: number | null,
  ): void {
    if (separationIndex != null) {
      this._rawConn
        .prepare(
          "UPDATE memories SET interference_score = ?, " +
            "separation_index = ? WHERE id = ?",
        )
        .run(interferenceScore, separationIndex, memoryId);
    } else {
      this._rawConn
        .prepare("UPDATE memories SET interference_score = ? WHERE id = ?")
        .run(interferenceScore, memoryId);
    }
  }

  // ── CLS Queries ────────────────────────────────────────────────────────────

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:183-199
   */
  getEpisodicMemories(
    domain = "",
    directory = "",
    limit = 500, // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:184
  ): Record<string, unknown>[] {
    const conditions = ["store_type = 'episodic'", "NOT is_stale"];
    const params: unknown[] = [];
    if (domain) {
      conditions.push("domain = ?");
      params.push(domain);
    }
    if (directory) {
      conditions.push("directory_context = ?");
      params.push(directory);
    }
    params.push(limit);
    const where = conditions.join(" AND ");
    const rows = this._rawConn
      .prepare(
        `SELECT * FROM memories WHERE ${where} ORDER BY created_at DESC LIMIT ?`,
      )
      .all(...params) as Record<string, unknown>[];
    return rows.map((r) => this._normalizeMemoryRow(r));
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:201-217
   */
  // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:201
  getSemanticMemories(domain = "", limit = 500): Record<string, unknown>[] { // source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:201
    let rows: Record<string, unknown>[];
    if (domain) {
      rows = this._rawConn
        .prepare(
          "SELECT * FROM memories WHERE store_type = 'semantic' " +
            "AND domain = ? AND NOT is_stale " +
            "ORDER BY created_at DESC LIMIT ?",
        )
        .all(domain, limit) as Record<string, unknown>[];
    } else {
      rows = this._rawConn
        .prepare(
          "SELECT * FROM memories WHERE store_type = 'semantic' " +
            "AND NOT is_stale ORDER BY created_at DESC LIMIT ?",
        )
        .all(limit) as Record<string, unknown>[];
    }
    return rows.map((r) => this._normalizeMemoryRow(r));
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:219-224
   */
  updateMemoryStoreType(memoryId: number, storeType: string): void {
    this._rawConn
      .prepare("UPDATE memories SET store_type = ? WHERE id = ?")
      .run(storeType, memoryId);
  }

  // ── Consolidation Log ──────────────────────────────────────────────────────

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:228-241
   */
  logConsolidation(data: Record<string, unknown>): number {
    const result = this._rawConn
      .prepare(
        "INSERT INTO consolidation_log " +
          "(memories_added, memories_updated, memories_archived, duration_ms) " +
          "VALUES (?, ?, ?, ?)",
      )
      .run(
        (data["memories_added"] as number) ?? 0,
        (data["memories_updated"] as number) ?? 0,
        (data["memories_archived"] as number) ?? 0,
        (data["duration_ms"] as number) ?? 0,
      );
    return result.lastInsertRowid as number;
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:243-247
   */
  getLastConsolidation(): string | null {
    const row = this._rawConn
      .prepare(
        "SELECT timestamp FROM consolidation_log ORDER BY timestamp DESC LIMIT 1",
      )
      .get() as { timestamp: string } | undefined;
    return row?.timestamp ?? null;
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_stats.py:249-253
   */
  countActiveTriggers(): number {
    const row = this._rawConn
      .prepare("SELECT COUNT(*) AS c FROM prospective_memories WHERE is_active")
      .get() as { c: number } | undefined;
    return row?.c ?? 0;
  }
}
