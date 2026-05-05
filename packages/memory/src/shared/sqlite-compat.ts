/**
 * sqlite-compat.ts — SQLite / psycopg compatibility wrapper.
 *
 * Ports: infrastructure/sqlite_compat.py (lines 1-145)
 *
 * Translates PostgreSQL SQL conventions to SQLite equivalents so that
 * handler code using store._conn.execute() with psycopg-style SQL works
 * unchanged on the SQLite fallback backend.
 *
 * Translations:
 *   - %s -> ? (parameter placeholders)
 *   - ::jsonb, ::TEXT, ::REAL, ::INT -> stripped (type casts)
 *   - SERIAL PRIMARY KEY -> INTEGER PRIMARY KEY AUTOINCREMENT
 *   - TIMESTAMPTZ -> TEXT
 *   - DEFAULT NOW() -> DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
 *   - ON CONFLICT ... DO UPDATE SET -> preserved (SQLite 3.24+)
 *   - RETURNING id -> stripped (use lastrowid instead)
 *
 * source: cortex@ed33435 mcp_server/infrastructure/sqlite_compat.py
 */

import type { Database as DatabaseType, RunResult, Statement } from "better-sqlite3";

// ── SQL translation ───────────────────────────────────────────────────────────

/**
 * Translate psycopg-style SQL to SQLite-compatible SQL.
 *
 * precondition:  sql is a non-empty string
 * postcondition: returned string has no %s, no ::type casts, no RETURNING clause,
 *   SERIAL replaced with INTEGER PRIMARY KEY AUTOINCREMENT,
 *   TIMESTAMPTZ replaced with TEXT, NOW() replaced with strftime(...)
 *
 * source: cortex@ed33435 mcp_server/infrastructure/sqlite_compat.py:24-62
 */
export function translateSql(sql: string): string {
  // Parameter placeholders: %s -> ?
  let out = sql.replaceAll("%s", "?");

  // Strip PostgreSQL type casts: ::jsonb, ::TEXT, ::REAL, etc.
  out = out.replace(/::\w+/g, "");

  // SERIAL PRIMARY KEY -> INTEGER PRIMARY KEY AUTOINCREMENT
  out = out.replace(/\bSERIAL\s+PRIMARY\s+KEY\b/gi, "INTEGER PRIMARY KEY AUTOINCREMENT");

  // TIMESTAMPTZ -> TEXT
  out = out.replace(/\bTIMESTAMPTZ\b/gi, "TEXT");

  // DEFAULT NOW() -> DEFAULT (strftime(...))
  out = out.replace(
    /\bDEFAULT\s+NOW\(\)/gi,
    "DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
  );

  // Standalone NOW() in VALUES -> strftime(...)
  out = out.replace(/\bNOW\(\)/gi, "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");

  // RETURNING ... -> stripped (not supported in older SQLite)
  out = out.replace(/\bRETURNING\s+\w+\b/gi, "");

  return out;
}

// ── Compat cursor ─────────────────────────────────────────────────────────────

/**
 * Wraps a better-sqlite3 result to mimic psycopg result access.
 *
 * source: cortex@ed33435 mcp_server/infrastructure/sqlite_compat.py:65-92
 */
export interface CompatCursorResult {
  readonly lastrowid: number;
  readonly rowcount: number;
  readonly hadReturning: boolean;
  fetchone(): Record<string, unknown> | null;
  fetchall(): Record<string, unknown>[];
}

class CompatCursor implements CompatCursorResult {
  readonly lastrowid: number;
  readonly rowcount: number;
  readonly hadReturning: boolean;
  private readonly _rows: Record<string, unknown>[];

  constructor(
    rows: Record<string, unknown>[],
    runResult: RunResult,
    hadReturning: boolean,
  ) {
    this._rows = rows;
    this.lastrowid = runResult.lastInsertRowid as number;
    this.rowcount = runResult.changes;
    this.hadReturning = hadReturning;
  }

  fetchone(): Record<string, unknown> | null {
    if (this._rows.length === 0) {
      // Only fake {"id": lastrowid} when RETURNING was stripped
      if (this.hadReturning && this.lastrowid) {
        return { id: this.lastrowid };
      }
      return null;
    }
    return this._rows[0] ?? null;
  }

  fetchall(): Record<string, unknown>[] {
    return this._rows;
  }
}

// ── PsycopgCompatConnection ───────────────────────────────────────────────────

/**
 * Wraps a better-sqlite3 Database to accept psycopg-style SQL.
 *
 * Handlers that use store._conn.execute("... %s ...", [val])
 * will work transparently with this wrapper.
 *
 * source: cortex@ed33435 mcp_server/infrastructure/sqlite_compat.py:94-145
 */
export class PsycopgCompatConnection {
  private readonly _real: DatabaseType;
  private readonly _stmtCache: Map<string, Statement> = new Map();

  constructor(conn: DatabaseType) {
    this._real = conn;
  }

  /**
   * Execute with automatic SQL translation.
   *
   * precondition:  sql is a non-empty string; params is an array or undefined
   * postcondition: returns a CompatCursorResult reflecting the executed statement
   *
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_compat.py:104-120
   */
  execute(sql: string, params?: unknown[]): CompatCursorResult {
    const hadReturning = /\bRETURNING\s+\w+\b/i.test(sql);
    const translated = translateSql(sql);

    // Prepared statement cache — mirror Python's implicit cursor reuse
    let stmt = this._stmtCache.get(translated);
    if (stmt == null) {
      stmt = this._real.prepare(translated);
      this._stmtCache.set(translated, stmt);
    }

    let rows: Record<string, unknown>[] = [];
    let runResult: RunResult;

    if (params != null && params.length > 0) {
      // Determine if this is a SELECT (returns rows) or mutation (returns RunResult)
      const trimmed = translated.trimStart().toUpperCase();
      if (trimmed.startsWith("SELECT") || trimmed.startsWith("WITH")) {
        rows = stmt.all(...params) as Record<string, unknown>[];
        runResult = { changes: 0, lastInsertRowid: 0 };
      } else {
        runResult = stmt.run(...params);
      }
    } else {
      const trimmed = translated.trimStart().toUpperCase();
      if (trimmed.startsWith("SELECT") || trimmed.startsWith("WITH")) {
        rows = stmt.all() as Record<string, unknown>[];
        runResult = { changes: 0, lastInsertRowid: 0 };
      } else {
        runResult = stmt.run();
      }
    }

    return new CompatCursor(rows, runResult, hadReturning);
  }

  /**
   * Execute multiple statements (DDL). No param translation.
   *
   * source: cortex@ed33435 mcp_server/infrastructure/sqlite_compat.py:122-124
   */
  executescript(sql: string): void {
    this._real.exec(sql);
  }

  commit(): void {
    // better-sqlite3 commits immediately in autocommit mode.
    // This is a no-op to satisfy callers ported from the Python psycopg style.
  }

  rollback(): void {
    // better-sqlite3 synchronous transactions — no async rollback needed.
    // no-op in compat layer
  }

  close(): void {
    this._real.close();
  }

  /** Expose the underlying Database for executemany and transaction use. */
  get raw(): DatabaseType {
    return this._real;
  }
}
