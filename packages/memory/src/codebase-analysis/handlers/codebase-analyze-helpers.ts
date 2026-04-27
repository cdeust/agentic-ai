/**
 * Helpers for codebase-analyze — file walking, hashing, entity persistence.
 *
 * Ported from mcp_server/handlers/codebase_analyze_helpers.py
 */

import { readdirSync, statSync } from "node:fs";
import type { Dirent } from "node:fs";
import { join, relative } from "node:path";
import { EXT_TO_LANG } from "../codebase-parser.js";
import type { FileAnalysis } from "../types.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MemoryStore = any;

export const CODEBASE_AGENT_CONTEXT = "codebase";
export const FILE_TAG_PREFIX = "file:";
export const HASH_TAG_PREFIX = "hash:";

// Bounded-candidate multiplier: we take at most `max_files * CANDIDATE_MULTIPLIER`
// paths from the directory walk before sorting. Source: ADR-0045 §R2 — bounded
// streaming for ingestion paths.
const CANDIDATE_MULTIPLIER = 10;

const IGNORE_DIRS = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".venv",
  "venv",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "target",
  ".cargo",
  "vendor",
  ".tox",
  "coverage",
  ".mypy_cache",
  ".pytest_cache",
]);

// ── File walking ──────────────────────────────────────────────────────────

function* _walkDir(root: string): Generator<string> {
  let entries: Dirent<string>[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      yield* _walkDir(fullPath);
    } else if (entry.isFile()) {
      yield fullPath;
    }
  }
}

export function collectSourceFiles(
  root: string,
  languages: string[] | null | undefined,
  maxFiles: number,
  maxBytes: number,
): string[] {
  /**
   * Walk directory and collect source files matching language filters.
   *
   * Preconditions:
   *   - `root` is an existing directory.
   *   - `maxFiles > 0` and `maxBytes > 0`.
   *
   * Postconditions:
   *   - Returns at most `maxFiles` paths.
   *   - Peak memory footprint is O(maxFiles * CANDIDATE_MULTIPLIER) paths,
   *     not O(tree_size) — see ADR-0045 §R2.
   */
  const langFilter = languages && languages.length > 0 ? new Set(languages) : null;
  const candidateCap = Math.max(maxFiles * CANDIDATE_MULTIPLIER, maxFiles);

  // Collect bounded candidate set
  const candidates: string[] = [];
  for (const p of _walkDir(root)) {
    candidates.push(p);
    if (candidates.length >= candidateCap) break;
  }
  candidates.sort();

  const files: string[] = [];
  for (const p of candidates) {
    if (files.length >= maxFiles) break;
    const ext = p.slice(p.lastIndexOf(".")).toLowerCase();
    const lang = EXT_TO_LANG[ext];
    if (!lang) continue;
    if (langFilter && !langFilter.has(lang)) continue;
    try {
      const st = statSync(p);
      if (st.size > maxBytes) continue;
    } catch {
      continue;
    }
    files.push(p);
  }
  return files;
}

// ── Hash-based change detection ───────────────────────────────────────────

function _parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as string[];
    } catch {
      return [];
    }
  }
  return [];
}

function _extractFileHash(tags: string[]): [string, string] {
  let filePath = "";
  let contentHash = "";
  for (const tag of tags) {
    if (typeof tag === "string") {
      if (tag.startsWith(FILE_TAG_PREFIX)) filePath = tag.slice(FILE_TAG_PREFIX.length);
      else if (tag.startsWith(HASH_TAG_PREFIX)) contentHash = tag.slice(HASH_TAG_PREFIX.length);
    }
  }
  return [filePath, contentHash];
}

export function loadExistingHashes(
  store: MemoryStore,
): Map<string, [number, string]> {
  const hashes = new Map<string, [number, string]>();
  try {
    const rows = (
      store.acquireBatch?.() ??
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      store
    ).execute(
      "SELECT id, tags FROM memories WHERE agent_context = $1 AND NOT is_stale",
      [CODEBASE_AGENT_CONTEXT],
    );
    for (const row of rows ?? []) {
      const memId = row.id as number;
      const tags = _parseTags(row.tags);
      const [fp, ch] = _extractFileHash(tags);
      if (fp && ch) hashes.set(fp, [memId, ch]);
    }
  } catch {
    // best-effort
  }
  return hashes;
}

export function markStale(store: MemoryStore, memoryIds: number[]): number {
  /**
   * Mark deleted file memories as stale.
   *
   * The legacy `heat = 0` clause was redundant with `is_stale = TRUE`
   * — every scan filters `NOT is_stale` before the heat signal is
   * consulted, so the heat value on stale rows is never read. A3 drops
   * the redundant zeroing; the heat_base column keeps its last value.
   * Source: phase-3-a3-migration-design.md §3.6.
   */
  if (memoryIds.length === 0) return 0;
  try {
    for (const mid of memoryIds) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      store.execute("UPDATE memories SET is_stale = TRUE WHERE id = $1", [mid]);
    }
    return memoryIds.length;
  } catch {
    return 0;
  }
}

// ── Entity persistence ────────────────────────────────────────────────────

const VALID_KINDS = new Set([
  "function",
  "class",
  "interface",
  "type",
  "enum",
  "trait",
  "protocol",
  "constant",
  "struct",
]);

function _getOrCreateEntity(
  store: MemoryStore,
  name: string,
  entityType: string,
  domain: string,
): number {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    const existing = store.getEntityByName(name) as Record<string, unknown> | null;
    if (existing) return existing["id"] as number;
  } catch {
    // fall through to insert
  }
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  return store.insertEntity({ name, type: entityType, domain }) as number;
}

function _persistSymbolEntities(
  store: MemoryStore,
  analysis: FileAnalysis,
  fileEid: number,
  domain: string,
): [number, number] {
  let entities = 0;
  let relationships = 0;
  for (const sym of analysis.definitions) {
    const kind = VALID_KINDS.has(sym.kind) ? sym.kind : "function";
    const symEid = _getOrCreateEntity(store, sym.name, kind, domain);
    entities++;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      store.insertRelationship({
        source_entity_id: fileEid,
        target_entity_id: symEid,
        relationship_type: "defines",
        weight: 1.0,
      });
      relationships++;
    } catch {
      // best-effort
    }
  }
  return [entities, relationships];
}

function _persistImportEntities(
  store: MemoryStore,
  analysis: FileAnalysis,
  fileEid: number,
  domain: string,
): [number, number] {
  let entities = 0;
  let relationships = 0;
  for (const imp of analysis.imports) {
    const depEid = _getOrCreateEntity(store, imp.module, "dependency", domain);
    entities++;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      store.insertRelationship({
        source_entity_id: fileEid,
        target_entity_id: depEid,
        relationship_type: "imports",
        weight: 1.0,
      });
      relationships++;
    } catch {
      // best-effort
    }
  }
  return [entities, relationships];
}

export function persistEntities(
  store: MemoryStore,
  analysis: FileAnalysis,
  _memoryId: number,
  domain: string,
): [number, number] {
  let entities = 0;
  let relationships = 0;
  try {
    const fileEid = _getOrCreateEntity(store, analysis.path, "file", domain);
    entities++;
    const [se, sr] = _persistSymbolEntities(store, analysis, fileEid, domain);
    entities += se;
    relationships += sr;
    const [ie, ir] = _persistImportEntities(store, analysis, fileEid, domain);
    entities += ie;
    relationships += ir;
  } catch {
    // best-effort
  }
  return [entities, relationships];
}

// ── Graph edge persistence ────────────────────────────────────────────────

export function persistFileEdge(
  store: MemoryStore,
  edges: [string, string][],
  domain: string,
): number {
  let count = 0;
  for (const [srcPath, tgtPath] of edges) {
    try {
      const srcEid = _getOrCreateEntity(store, srcPath, "file", domain);
      const tgtEid = _getOrCreateEntity(store, tgtPath, "file", domain);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      store.insertRelationship({
        source_entity_id: srcEid,
        target_entity_id: tgtEid,
        relationship_type: "imports",
        weight: 1.0,
      });
      count++;
    } catch {
      // best-effort
    }
  }
  return count;
}

export function persistInheritanceEdge(
  store: MemoryStore,
  edges: [string, string][],
  domain: string,
): number {
  let count = 0;
  for (const [child, parent] of edges) {
    try {
      const childEid = _getOrCreateEntity(store, child, "class", domain);
      const parentEid = _getOrCreateEntity(store, parent, "class", domain);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      store.insertRelationship({
        source_entity_id: childEid,
        target_entity_id: parentEid,
        relationship_type: "extends",
        weight: 1.0,
      });
      count++;
    } catch {
      // best-effort
    }
  }
  return count;
}

export function persistCommunityTags(
  store: MemoryStore,
  communities: Map<string, number>,
): void {
  if (communities.size === 0) return;
  for (const [filePath, clusterId] of communities) {
    try {
      const rows = (
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        store.execute(
          "SELECT id, tags FROM memories WHERE agent_context = 'codebase' AND NOT is_stale AND content LIKE $1",
          [`%${filePath}%`],
        ) ?? []
      ) as Record<string, unknown>[];
      for (const row of rows) {
        const tags = _parseTags(row["tags"]);
        const tag = `cluster:${clusterId}`;
        if (!tags.includes(tag)) {
          tags.push(tag);
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
          store.execute("UPDATE memories SET tags = $1 WHERE id = $2", [
            JSON.stringify(tags),
            row["id"],
          ]);
        }
      }
    } catch {
      // best-effort
    }
  }
}

export function resolveRelativePath(sourcePath: string, root: string): string {
  try {
    return relative(root, sourcePath) || sourcePath;
  } catch {
    return sourcePath;
  }
}
