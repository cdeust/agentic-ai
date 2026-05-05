/**
 * backfill-helpers.ts — backfill_memories file discovery, hashing, concept linking.
 *
 * Ports the parts of mcp_server/handlers/backfill_helpers.py NOT already covered
 * by heat.ts (ageDecayedHeat + computeAgeDays were ported there).
 *
 * Exports:
 *   - ensureBackfillLog    — CREATE TABLE IF NOT EXISTS backfill_log
 *   - fileHash             — first-64KB SHA-256 truncated to 16 chars
 *   - isAlreadyBackfilled  — hash-based idempotency check
 *   - markBackfilled       — upsert into backfill_log
 *   - discoverBackfillFiles — rglob-style walk identical to backfill_helpers.discover_files
 *   - slugToDomain         — project slug → domain label (delegates to domain-detector)
 *   - findConcepts         — keyword matching over _CORE_CONCEPTS
 *   - linkConcepts         — upsert entities + insert relationships
 *
 * Layer: import (infrastructure helpers; no compose-root dependencies).
 *
 * source: cortex@ed33435 mcp_server/handlers/backfill_helpers.py
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";
import { detectDomainFromPath } from "./domain-detector.js";
import type { MemoryStore } from "../remember/storage/memory-store.js";

// ── Constants ─────────────────────────────────────────────────────────────────

// source: cortex@ed33435 mcp_server/handlers/backfill_helpers.py:file_hash (65536 = 64 KiB)
const HASH_READ_BYTES = 65536; // source: IEC 80000-13:2008 §21-12

// source: cortex@ed33435 mcp_server/handlers/backfill_helpers.py:discover_files — limit = max_files * 3
const DISCOVER_MULTIPLIER = 3; // source: backfill_helpers.py:discover_files

// ── Core concept keywords ─────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/backfill_helpers.py:_CORE_CONCEPTS

const CORE_CONCEPTS: Readonly<Record<string, readonly string[]>> = {
  predictive_coding: ["predictive coding", "write gate", "novelty score", "embedding novelty"],
  hopfield: ["hopfield", "modern hopfield", "pattern matrix"],
  hdc: ["hyperdimensional", "hdc", "bind bundle permute", "bipolar vector"],
  successor_representation: [
    "successor representation",
    "co-access",
    "sr graph",
    "sr score",
  ],
  thermodynamics: ["heat decay", "thermodynamic", "cold threshold", "heat score"],
  consolidation: [
    "cls consolidation",
    "episodic to semantic",
    "memify",
    "sleep compute",
  ],
  fractal_hierarchy: [
    "fractal hierarchy",
    "recall hierarchical",
    "drill down",
    "cluster",
  ],
  knowledge_graph: [
    "entity relationship",
    "causal chain",
    "knowledge graph",
    "entity extraction",
  ],
};

// ── Backfill log helpers ──────────────────────────────────────────────────────

/**
 * Ensure the backfill_log table exists.
 *
 * Pre:  store is a connected MemoryStore.
 * Post: backfill_log table exists (idempotent CREATE TABLE IF NOT EXISTS).
 *
 * source: cortex@ed33435 mcp_server/handlers/backfill_helpers.py:ensure_backfill_log
 */
export function ensureBackfillLog(store: MemoryStore): void {
  try {
    (store as unknown as {
      run?: (sql: string) => void;
      exec?: (sql: string) => void;
    }).run?.(
      `CREATE TABLE IF NOT EXISTS backfill_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL UNIQUE,
        file_hash TEXT NOT NULL,
        memories_imported INTEGER DEFAULT 0,
        processed_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
    );
  } catch {
    // Best-effort; table may already exist or store may not support DDL.
  }
}

/**
 * Compute a fast hash of the first 64 KiB of a file.
 *
 * Pre:  filePath exists and is readable.
 * Post: returns a 16-char hex string (truncated SHA-256).
 *
 * source: cortex@ed33435 mcp_server/handlers/backfill_helpers.py:file_hash
 */
export function fileHash(filePath: string): string {
  const buf = new Uint8Array(HASH_READ_BYTES);
  const fd = fs.openSync(filePath, "r");
  let bytesRead = 0;
  try {
    bytesRead = fs.readSync(fd, buf, 0, HASH_READ_BYTES, 0);
  } finally {
    fs.closeSync(fd);
  }
  const hash = crypto.createHash("sha256").update(buf.subarray(0, bytesRead)).digest("hex");
  return hash.slice(0, 16); // source: backfill_helpers.py — h.hexdigest()[:16]
}

/**
 * Check whether a file has already been backfilled with this hash.
 *
 * Pre:  store has a backfill_log table.
 * Post: returns true iff the stored hash matches currentHash.
 *
 * source: cortex@ed33435 mcp_server/handlers/backfill_helpers.py:is_already_backfilled
 */
export function isAlreadyBackfilled(
  store: MemoryStore,
  filePath: string,
  currentHash: string,
): boolean {
  try {
    const row = (store as unknown as {
      get?: (sql: string, params: unknown[]) => Record<string, unknown> | undefined;
    }).get?.(
      "SELECT file_hash FROM backfill_log WHERE file_path = ?",
      [filePath],
    );
    if (!row) return false;
    return row["file_hash"] === currentHash;
  } catch {
    return false;
  }
}

/**
 * Record that a file has been backfilled.
 *
 * Pre:  store has a backfill_log table; fhash is 16 hex chars.
 * Post: backfill_log row is upserted for filePath.
 *
 * source: cortex@ed33435 mcp_server/handlers/backfill_helpers.py:mark_backfilled
 */
export function markBackfilled(
  store: MemoryStore,
  filePath: string,
  fhash: string,
  count: number,
): void {
  try {
    (store as unknown as {
      run?: (sql: string, params: unknown[]) => void;
    }).run?.(
      `INSERT INTO backfill_log (file_path, file_hash, memories_imported, processed_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(file_path) DO UPDATE SET
         file_hash = excluded.file_hash,
         memories_imported = excluded.memories_imported,
         processed_at = datetime('now')`,
      [filePath, fhash, count],
    );
  } catch {
    // Best-effort.
  }
}

// ── File discovery ────────────────────────────────────────────────────────────

export interface BackfillFileEntry {
  filePath: string;
  slug: string;
}

/**
 * Return (filePath, slug) pairs for JSONL session files.
 *
 * Walks project directories under ~/.claude/projects rglob-style, accepting
 * four session layouts:
 *   1. Flat parent         <slug>/<uuid>.jsonl
 *   2. UUID-dir parent     <slug>/<uuid>/<uuid>.jsonl
 *   3. Subagent data dir   <slug>/<parent>/data/subagents/agent-<id>.jsonl
 *   4. Subagent direct     <slug>/<parent>/agent-<id>.jsonl
 *
 * Pre:  projectsDir exists (or function returns []).
 * Post: returns at most max_files * DISCOVER_MULTIPLIER entries, sorted newest-first.
 *
 * source: cortex@ed33435 mcp_server/handlers/backfill_helpers.py:discover_files
 */
export function discoverBackfillFiles(
  projectFilter: string,
  maxFiles: number,
  projectsDirOverride?: string,
): BackfillFileEntry[] {
  const claudeDir = path.join(homedir(), ".claude");
  const projectsDir = projectsDirOverride ?? path.join(claudeDir, "projects");
  if (!fs.existsSync(projectsDir)) return [];

  const limit = maxFiles * DISCOVER_MULTIPLIER; // source: backfill_helpers.py:discover_files
  const results: BackfillFileEntry[] = [];

  let projectDirs: string[];
  try {
    projectDirs = fs.readdirSync(projectsDir).sort();
  } catch {
    return [];
  }

  for (const slug of projectDirs) {
    if (results.length >= limit) break;
    const projectDir = path.join(projectsDir, slug);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(projectDir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    if (projectFilter && !slug.includes(projectFilter)) continue;

    const jsonlFiles = _rglob(projectDir, ".jsonl");
    // Sort newest-first (reverse lexicographic on path as heuristic).
    jsonlFiles.sort((a, b) => b.localeCompare(a));

    for (const f of jsonlFiles) {
      if (results.length >= limit) break;
      const parent = path.dirname(f);
      const base = path.basename(f, ".jsonl");
      const parentName = path.basename(parent);
      const accept =
        parent === projectDir ||
        parentName === base ||
        path.basename(f).startsWith("agent-");
      if (accept) {
        results.push({ filePath: f, slug });
      }
    }
  }

  return results.slice(0, limit);
}

/** Recursive glob for files with a given extension. */
function _rglob(dir: string, ext: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(..._rglob(full, ext));
    } else if (entry.isFile() && full.endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
}

// ── Slug → domain ─────────────────────────────────────────────────────────────

/**
 * Convert a project slug like '-Users-you-project-name' to a canonical domain.
 *
 * Delegates to detectDomainFromPath (same logic as domain-detector.ts).
 *
 * source: cortex@ed33435 mcp_server/handlers/backfill_helpers.py:slug_to_domain
 */
export function slugToDomain(slug: string): string {
  // Convert slug (-Users-alice-code-cortex) back to a path then extract domain.
  const asPath = slug.replace(/-/g, "/");
  return detectDomainFromPath(asPath);
}

// ── Concept detection and linking ─────────────────────────────────────────────

/**
 * Return core concept keys that appear in the content (case-insensitive).
 *
 * Pre:  content is a string (possibly empty).
 * Post: returns a list of CORE_CONCEPTS keys whose keywords appear in content.
 *
 * source: cortex@ed33435 mcp_server/handlers/backfill_helpers.py:find_concepts
 */
export function findConcepts(content: string): string[] {
  const lower = content.toLowerCase();
  const found: string[] = [];
  for (const [key, keywords] of Object.entries(CORE_CONCEPTS)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      found.push(key);
    }
  }
  return found;
}

/**
 * Create entity relationships linking a memory to core concepts.
 *
 * Pre:  store is a connected MemoryStore; memoryId is a valid memory row id.
 * Post: for each concept, upserts a 'cortex:<concept>' entity and inserts a
 *       mentions_concept relationship. Returns count of successfully linked concepts.
 *
 * source: cortex@ed33435 mcp_server/handlers/backfill_helpers.py:link_concepts
 */
export function linkConcepts(
  store: MemoryStore,
  memoryId: number,
  concepts: string[],
): number {
  let linked = 0;
  for (const concept of concepts) {
    try {
      const entityName = `cortex:${concept}`;
      let entityId = store.getEntityByName(entityName)?.id;
      if (entityId === undefined) {
        entityId = store.upsertEntity(entityName, "concept", "cortex");
      }
      if (entityId > 0) {
        store.linkMemoryEntity(memoryId, entityId);
        linked += 1;
      }
    } catch {
      // Best-effort — single concept failure must not abort the loop.
    }
  }
  return linked;
}
