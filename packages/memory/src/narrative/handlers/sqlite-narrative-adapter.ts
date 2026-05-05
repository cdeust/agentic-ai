/**
 * SqliteNarrativeAdapter — adapts a better-sqlite3 Database to the
 * MemoryPort interface required by narrative and unified-search handlers.
 *
 * Layer: infrastructure — wraps raw DB access; injected at composition root.
 *
 * This adapter is extracted from the composition root so narrative handlers
 * stay in the application layer (no DB import) per Clean Architecture §2.1.
 *
 * source: Cortex mcp_server/infrastructure/sqlite_store.py — query patterns
 * source: Martin, R. C. (2017). Clean Architecture, Ch. 22 — composition root
 *   is the only layer that wires core + infrastructure.
 */

import type { Database as DatabaseType } from "better-sqlite3";
import type { MemoryPort } from "./narrative.js";
import type { MemoryRecord } from "../types.js";

// ── Row shape from the memories table ────────────────────────────────────────
// source: packages/memory/src/remember/storage/sqlite-store.ts MEMORIES_DDL

interface MemoryRow {
  content: string;
  tags: string;
  importance: number;
  heat_base: number;
  created_at: string;
}

function rowToRecord(row: MemoryRow): MemoryRecord {
  let tags: string[];
  try {
    tags = JSON.parse(row.tags) as string[];
  } catch {
    tags = [];
  }
  return {
    content:    row.content,
    tags,
    importance: row.importance,
    heat:       row.heat_base,
    timestamp:  row.created_at,
    session_id: "",
  };
}

/**
 * Adapts a better-sqlite3 Database connection to the MemoryPort interface.
 *
 * Precondition:  db is an open better-sqlite3 Database with the memories schema.
 * Postcondition: all MemoryPort methods execute synchronously against the DB.
 *
 * source: Cortex mcp_server/infrastructure/sqlite_store.py::get_memories_for_domain
 * source: Cortex mcp_server/infrastructure/sqlite_store.py::get_hot_memories
 */
export class SqliteNarrativeAdapter implements MemoryPort {
  constructor(private readonly _db: DatabaseType) {}

  /**
   * Return memories whose directory_context starts with the given directory.
   *
   * Precondition:  directory is a non-empty string; minHeat >= 0.
   * Postcondition: returns all rows where directory_context LIKE directory%
   *                and heat_base >= minHeat.
   *
   * source: Cortex sqlite_store.py::get_memories_for_directory pattern
   */
  getMemoriesForDirectory(directory: string, minHeat: number): MemoryRecord[] {
    const rows = this._db.prepare(
      `SELECT content, tags, importance, heat_base, created_at
         FROM memories
        WHERE directory_context LIKE ? AND heat_base >= ?
        ORDER BY heat_base DESC`,
    ).all(`${directory}%`, minHeat) as MemoryRow[];
    return rows.map(rowToRecord);
  }

  /**
   * Return up to `limit` memories for a domain ordered by heat descending.
   *
   * Precondition:  domain is a string; minHeat >= 0; limit > 0.
   * Postcondition: returns at most `limit` rows where domain = domain
   *                and heat_base >= minHeat, ordered by heat_base DESC.
   *
   * source: Cortex sqlite_store.py::get_memories_for_domain
   */
  getMemoriesForDomain(domain: string, minHeat: number, limit: number): MemoryRecord[] {
    const rows = this._db.prepare(
      `SELECT content, tags, importance, heat_base, created_at
         FROM memories
        WHERE domain = ? AND heat_base >= ?
        ORDER BY heat_base DESC
        LIMIT ?`,
    ).all(domain, minHeat, limit) as MemoryRow[];
    return rows.map(rowToRecord);
  }

  /**
   * Return up to `limit` hot memories across all domains.
   *
   * Precondition:  minHeat >= 0; limit > 0.
   * Postcondition: returns at most `limit` rows with heat_base >= minHeat,
   *                ordered by heat_base DESC.
   *
   * source: Cortex sqlite_store.py::get_hot_memories
   */
  getHotMemories(minHeat: number, limit: number): MemoryRecord[] {
    const rows = this._db.prepare(
      `SELECT content, tags, importance, heat_base, created_at
         FROM memories
        WHERE heat_base >= ?
        ORDER BY heat_base DESC
        LIMIT ?`,
    ).all(minHeat, limit) as MemoryRow[];
    return rows.map(rowToRecord);
  }
}
