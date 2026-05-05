/**
 * sqlite-store-rules.ts — Rule CRUD mixin for SqliteMemoryStore.
 *
 * Ports: infrastructure/sqlite_store_rules.py (lines 1-70)
 *
 * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_rules.py
 */

import type { Database as DatabaseType } from "better-sqlite3";

/**
 * Memory rule persistence operations on SQLite.
 *
 * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_rules.py:9-70
 */
export class SqliteRuleMixin {
  protected _rawConn!: DatabaseType;

  /**
   * Insert a memory rule and return its id.
   *
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_rules.py:14-31
   */
  insertRule(data: Record<string, unknown>): number {
    const result = this._rawConn
      .prepare(
        "INSERT INTO memory_rules " +
          "(rule_type, scope, scope_value, condition, action, priority, " +
          "is_active, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))",
      )
      .run(
        (data["rule_type"] as string) ?? "soft",
        (data["scope"] as string) ?? "global",
        (data["scope_value"] as string | null) ?? null,
        data["condition"] as string,
        data["action"] as string,
        (data["priority"] as number) ?? 0,
        data["is_active"] !== false && data["is_active"] !== 0 ? 1 : 0,
      );
    return result.lastInsertRowid as number;
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_rules.py:33-39
   */
  getRulesForScope(scope: string): Record<string, unknown>[] {
    return this._rawConn
      .prepare(
        "SELECT * FROM memory_rules WHERE scope = ? AND is_active " +
          "ORDER BY priority DESC",
      )
      .all(scope) as Record<string, unknown>[];
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_rules.py:41-45
   */
  getAllActiveRules(): Record<string, unknown>[] {
    return this._rawConn
      .prepare(
        "SELECT * FROM memory_rules WHERE is_active ORDER BY scope, priority DESC",
      )
      .all() as Record<string, unknown>[];
  }

  /**
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_store_rules.py:47-69
   */
  updateRule(ruleId: number, updates: Record<string, unknown>): void {
    const allowed = new Set([
      "rule_type",
      "scope",
      "scope_value",
      "condition",
      "action",
      "priority",
      "is_active",
    ]);
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(updates)) {
      if (allowed.has(k)) {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
    }
    if (sets.length > 0) {
      vals.push(ruleId);
      this._rawConn
        .prepare(`UPDATE memory_rules SET ${sets.join(", ")} WHERE id = ?`)
        .run(...vals);
    }
  }
}
