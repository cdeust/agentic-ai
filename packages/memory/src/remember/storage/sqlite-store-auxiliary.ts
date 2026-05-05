/* eslint-disable @typescript-eslint/no-magic-numbers -- all numeric defaults are literal ports from cortex@ed33435 */
/**
 * sqlite-store-auxiliary.ts — Auxiliary persistence mixin.
 *
 * Prospective memories, checkpoints, archives, engrams, schemas.
 *
 * Ports: infrastructure/sqlite_store_auxiliary.py (lines 1-300)
 *
 * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py
 */

import type { Database as DatabaseType } from "better-sqlite3";

/**
 * Prospective memory, checkpoint, archive, engram, schema operations on SQLite.
 *
 * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:10-300
 */
export class SqliteAuxiliaryMixin {
  protected _rawConn!: DatabaseType;

  /** Provided by SqliteMemoryStore. */
  protected _normalizeMemoryRow(row: Record<string, unknown>): Record<string, unknown> {
    return row;
  }

  // ── Prospective Memory ─────────────────────────────────────────────────────

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:21-37
   */
  insertProspectiveMemory(data: Record<string, unknown>): number {
    const result = this._rawConn
      .prepare(
        "INSERT INTO prospective_memories " +
          "(content, trigger_condition, trigger_type, " +
          "target_directory, is_active, triggered_count) " +
          "VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        data["content"] as string,
        data["trigger_condition"] as string,
        data["trigger_type"] as string,
        (data["target_directory"] as string | null) ?? null,
        data["is_active"] !== false && data["is_active"] !== 0 ? 1 : 0,
        (data["triggered_count"] as number) ?? 0,
      );
    return result.lastInsertRowid as number;
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:39-42
   */
  getActiveProspectiveMemories(): Record<string, unknown>[] {
    return this._rawConn
      .prepare("SELECT * FROM prospective_memories WHERE is_active")
      .all() as Record<string, unknown>[];
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:44-50
   */
  triggerProspectiveMemory(pmId: number): void {
    this._rawConn
      .prepare(
        "UPDATE prospective_memories SET triggered_at = datetime('now'), " +
          "triggered_count = triggered_count + 1 WHERE id = ?",
      )
      .run(pmId);
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:52-58
   */
  deactivateProspectiveMemory(pmId: number): void {
    this._rawConn
      .prepare("UPDATE prospective_memories SET is_active = 0 WHERE id = ?")
      .run(pmId);
  }

  // ── Checkpoint ─────────────────────────────────────────────────────────────

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:62-85
   */
  insertCheckpoint(data: Record<string, unknown>): number {
    this._rawConn.prepare("UPDATE checkpoints SET is_active = 0").run();
    const result = this._rawConn
      .prepare(
        "INSERT INTO checkpoints " +
          "(session_id, directory_context, current_task, " +
          "files_being_edited, key_decisions, open_questions, " +
          "next_steps, active_errors, custom_context, epoch, is_active, " +
          "created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))",
      )
      .run(
        (data["session_id"] as string) ?? "default",
        (data["directory_context"] as string) ?? "",
        (data["current_task"] as string) ?? "",
        JSON.stringify((data["files_being_edited"] as unknown[]) ?? []),
        JSON.stringify((data["key_decisions"] as unknown[]) ?? []),
        JSON.stringify((data["open_questions"] as unknown[]) ?? []),
        JSON.stringify((data["next_steps"] as unknown[]) ?? []),
        JSON.stringify((data["active_errors"] as unknown[]) ?? []),
        (data["custom_context"] as string) ?? "",
        (data["epoch"] as number) ?? 0,
      );
    return result.lastInsertRowid as number;
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:87-91
   */
  getActiveCheckpoint(): Record<string, unknown> | null {
    const row = this._rawConn
      .prepare(
        "SELECT * FROM checkpoints WHERE is_active ORDER BY created_at DESC LIMIT 1",
      )
      .get() as Record<string, unknown> | undefined;
    return row ? this._normalizeMemoryRow(row) : null;
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:93-95
   */
  getCurrentEpoch(): number {
    const row = this._rawConn
      .prepare("SELECT MAX(epoch) AS e FROM checkpoints")
      .get() as { e: number | null } | undefined;
    return row?.e ?? 0;
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:97-109
   */
  incrementEpoch(): number {
    const newEpoch = this.getCurrentEpoch() + 1;
    this._rawConn
      .prepare(
        "INSERT INTO checkpoints " +
          "(session_id, directory_context, current_task, " +
          "files_being_edited, key_decisions, open_questions, " +
          "next_steps, active_errors, custom_context, epoch, is_active) " +
          "VALUES ('epoch-sentinel', '', ?, '[]', '[]', " +
          "'[]', '[]', '[]', '', ?, 0)",
      )
      .run(`epoch-boundary:${newEpoch}`, newEpoch);
    return newEpoch;
  }

  // ── Archive ────────────────────────────────────────────────────────────────

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:113-126
   */
  insertArchive(data: Record<string, unknown>): number {
    const result = this._rawConn
      .prepare(
        "INSERT INTO memory_archives " +
          "(original_memory_id, content, mismatch_score, archive_reason) " +
          "VALUES (?, ?, ?, ?)",
      )
      .run(
        data["original_memory_id"] as number,
        data["content"] as string,
        (data["mismatch_score"] as number) ?? 0.0,
        (data["archive_reason"] as string) ?? "",
      );
    return result.lastInsertRowid as number;
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:128-134
   */
  getArchivesForMemory(memoryId: number): Record<string, unknown>[] {
    const rows = this._rawConn
      .prepare(
        "SELECT * FROM memory_archives " +
          "WHERE original_memory_id = ? ORDER BY archived_at DESC",
      )
      .all(memoryId) as Record<string, unknown>[];
    return rows.map((r) => this._normalizeMemoryRow(r));
  }

  // ── Engram Slots ───────────────────────────────────────────────────────────

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:138-149
   */
  initEngramSlots(numSlots: number): void {
    const row = this._rawConn
      .prepare("SELECT COUNT(*) AS c FROM engram_slots")
      .get() as { c: number } | undefined;
    const existing = row?.c ?? 0;
    if (existing >= numSlots) return;
    const stmt = this._rawConn.prepare(
      "INSERT OR IGNORE INTO engram_slots (slot_index, excitability) VALUES (?, 0.5)",
    );
    const runBatch = this._rawConn.transaction((start: number, end: number) => {
      for (let i = start; i < end; i++) {
        stmt.run(i);
      }
    });
    runBatch(existing, numSlots);
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:151-155
   */
  getAllEngramSlots(): Record<string, unknown>[] {
    return this._rawConn
      .prepare("SELECT * FROM engram_slots ORDER BY slot_index")
      .all() as Record<string, unknown>[];
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:157-162
   */
  getEngramSlot(slotIndex: number): Record<string, unknown> | null {
    const row = this._rawConn
      .prepare("SELECT * FROM engram_slots WHERE slot_index = ?")
      .get(slotIndex) as Record<string, unknown> | undefined;
    return row ?? null;
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:164-173
   */
  updateEngramSlot(
    slotIndex: number,
    excitability: number,
    lastActivated: string,
  ): void {
    this._rawConn
      .prepare(
        "UPDATE engram_slots SET excitability = ?, " +
          "last_activated = ? WHERE slot_index = ?",
      )
      .run(excitability, lastActivated, slotIndex);
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:175-180
   */
  assignMemorySlot(memoryId: number, slotIndex: number): void {
    this._rawConn
      .prepare("UPDATE memories SET slot_index = ? WHERE id = ?")
      .run(slotIndex, memoryId);
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:182-186
   */
  getMemoriesInSlot(slotIndex: number): Record<string, unknown>[] {
    const rows = this._rawConn
      .prepare("SELECT * FROM memories WHERE slot_index = ?")
      .all(slotIndex) as Record<string, unknown>[];
    return rows.map((r) => this._normalizeMemoryRow(r));
  }

  /**
   * Return the number of memories assigned to slotIndex.
   * Lightweight alternative to getMemoriesInSlot.
   * excludeId omits a specific memory so the caller doesn't need to
   * guess whether it's committed yet.
   *
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:188-210
   */
  countMemoriesInSlot(slotIndex: number, excludeId?: number | null): number {
    if (excludeId != null) {
      const row = this._rawConn
        .prepare(
          "SELECT COUNT(*) AS c FROM memories WHERE slot_index = ? AND id != ?",
        )
        .get(slotIndex, excludeId) as { c: number } | undefined;
      return row?.c ?? 0;
    }
    const row = this._rawConn
      .prepare("SELECT COUNT(*) AS c FROM memories WHERE slot_index = ?")
      .get(slotIndex) as { c: number } | undefined;
    return row?.c ?? 0;
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:212-217
   */
  getSlotOccupancy(): Map<number, number> {
    const rows = this._rawConn
      .prepare(
        "SELECT slot_index, COUNT(*) AS c FROM memories " +
          "WHERE slot_index IS NOT NULL GROUP BY slot_index",
      )
      .all() as Array<{ slot_index: number; c: number }>;
    return new Map(rows.map((r) => [r.slot_index, r.c]));
  }

  // ── Schemas (cortical structures) ──────────────────────────────────────────

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:221-246
   */
  insertSchema(data: Record<string, unknown>): number {
    try {
      const result = this._rawConn
        .prepare(
          `INSERT INTO schemas (
                    schema_id, domain, label, entity_signature,
                    relationship_types, tag_signature,
                    consistency_threshold, formation_count,
                    assimilation_count, violation_count
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          data["schema_id"] as string,
          (data["domain"] as string) ?? "",
          (data["label"] as string) ?? "",
          JSON.stringify((data["entity_signature"] as object) ?? {}),
          JSON.stringify((data["relationship_types"] as unknown[]) ?? []),
          JSON.stringify((data["tag_signature"] as object) ?? {}),
          (data["consistency_threshold"] as number) ?? 0.7,
          (data["formation_count"] as number) ?? 0,
          (data["assimilation_count"] as number) ?? 0,
          (data["violation_count"] as number) ?? 0,
        );
      return result.lastInsertRowid as number;
    } catch {
      return this._updateExistingSchema(data);
    }
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:248-275
   */
  private _updateExistingSchema(data: Record<string, unknown>): number {
    this._rawConn
      .prepare(
        `UPDATE schemas SET
                domain = ?, label = ?, entity_signature = ?,
                relationship_types = ?, tag_signature = ?,
                consistency_threshold = ?, formation_count = ?,
                assimilation_count = ?, violation_count = ?,
                last_updated = datetime('now')
            WHERE schema_id = ?`,
      )
      .run(
        (data["domain"] as string) ?? "",
        (data["label"] as string) ?? "",
        JSON.stringify((data["entity_signature"] as object) ?? {}),
        JSON.stringify((data["relationship_types"] as unknown[]) ?? []),
        JSON.stringify((data["tag_signature"] as object) ?? {}),
        (data["consistency_threshold"] as number) ?? 0.7,
        (data["formation_count"] as number) ?? 0,
        (data["assimilation_count"] as number) ?? 0,
        (data["violation_count"] as number) ?? 0,
        data["schema_id"] as string,
      );
    const row = this._rawConn
      .prepare("SELECT id FROM schemas WHERE schema_id = ?")
      .get(data["schema_id"] as string) as { id: number } | undefined;
    return row?.id ?? 0;
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:277-282
   */
  getSchemasForDomain(domain: string): Record<string, unknown>[] {
    return this._rawConn
      .prepare(
        "SELECT * FROM schemas WHERE domain = ? ORDER BY formation_count DESC",
      )
      .all(domain) as Record<string, unknown>[];
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:284-288
   */
  getAllSchemas(): Record<string, unknown>[] {
    return this._rawConn
      .prepare("SELECT * FROM schemas ORDER BY formation_count DESC")
      .all() as Record<string, unknown>[];
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:290-293
   */
  countSchemas(): number {
    const row = this._rawConn
      .prepare("SELECT COUNT(*) AS c FROM schemas")
      .get() as { c: number } | undefined;
    return row?.c ?? 0;
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_auxiliary.py:295-299
   */
  deleteSchema(schemaId: string): boolean {
    const result = this._rawConn
      .prepare("DELETE FROM schemas WHERE schema_id = ?")
      .run(schemaId);
    return result.changes > 0;
  }
}
