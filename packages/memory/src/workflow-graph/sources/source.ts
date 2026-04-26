/**
 * Workflow graph source facade — reads every data stream the builder
 * consumes and returns plain dicts ready for WorkflowGraphBuilder.
 *
 * Infrastructure layer only. No core imports. The heavy per-stream logic
 * lives in sibling modules so this file stays under the 500-line ceiling:
 *
 *   source-jsonl.ts — session-JSONL-backed loaders
 *   source-pg.ts    — PostgreSQL-backed loaders (stub — see below)
 *   source-ast.ts   — automatised-pipeline AST bridge (stub)
 *   source-native-ast.ts — in-house tree-sitter AST (stub)
 *
 * AST-substrate decision: the AP bridge (source-ast.ts) depends on the
 * automatised-pipeline MCP subprocess; the native-AST source
 * (source-native-ast.ts) depends on tree-sitter bindings. Both are
 * stubbed in this first-pass port pending coordination with the
 * cortex-codebase-analysis worktree (merge order #5), which owns the
 * codebase_parser / ast_parser infrastructure.
 *
 * source: Cortex mcp_server/infrastructure/workflow_graph_source.py
 */

import { createHash } from "node:crypto";
import * as jsonl from "./source-jsonl.js";
import * as pg from "./source-pg.js";

function createHashFn(input: string): string {
  return createHash("sha1").update(input, "utf8").digest("hex");
}

export type DomainFromProjectDir = (projectDir: string) => string;
export type DomainFromDirectory = (directory: string | null) => string | null;

// ── Shared utility re-exported for callers ───────────────────────────────

export function cmdHash(cmd: string): string {
  /** SHA-1 short hash for bash command deduplication. */
  // source: Cortex workflow_graph_source.py _cmd_hash
  return createHashFn(cmd).slice(0, 12);
}

export function firstLine(text: string): string {
  for (const ln of text.split("\n")) {
    const s = ln.trim();
    if (s) return s;
  }
  return text.trim();
}

// Regex for tool tags on auto-captured memories.
const _TOOL_TAG_RE = /^tool:([a-z]+)$/;
const _TOOL_NAMES = new Set([
  "edit",
  "write",
  "bash",
  "read",
  "grep",
  "glob",
  "task",
]);

export function toolFromTags(tags: unknown[]): string | null {
  for (const t of tags ?? []) {
    const m = _TOOL_TAG_RE.exec(String(t));
    if (m && _TOOL_NAMES.has(m[1]!)) {
      const name = m[1]!;
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
  }
  return null;
}

export class WorkflowGraphSource {
  /**
   * Facade over the per-stream loaders. Every method returns plain dicts
   * that the core WorkflowGraphBuilder ingests verbatim.
   */

  private readonly _domainFromProjectDir: DomainFromProjectDir;
  private readonly _domainFromDirectory: DomainFromDirectory;

  constructor(
    domainFromProjectDir: DomainFromProjectDir,
    domainFromDirectory: DomainFromDirectory,
  ) {
    this._domainFromProjectDir = domainFromProjectDir;
    this._domainFromDirectory = domainFromDirectory;
  }

  // ── 1. Tool events ──────────────────────────────────────────────────
  loadToolEvents(pgStore: unknown): Record<string, unknown>[] {
    const pgRows = pg.loadToolEvents(
      pgStore,
      toolFromTags,
      this._domainFromDirectory,
      cmdHash,
      firstLine,
    );
    const jsonlRows = jsonl.loadFileAccessEvents(this._domainFromProjectDir);
    return [...pgRows, ...jsonlRows];
  }

  // ── 2. Skills ───────────────────────────────────────────────────────
  loadSkills(): Record<string, unknown>[] {
    return jsonl.loadSkills();
  }

  // ── 3. Hooks ────────────────────────────────────────────────────────
  loadHooks(): Record<string, unknown>[] {
    return jsonl.loadHooks();
  }

  // ── 4. Agents ───────────────────────────────────────────────────────
  loadAgentEvents(): Record<string, unknown>[] {
    return jsonl.loadAgentEvents(this._domainFromProjectDir);
  }

  // ── 5. Commands ─────────────────────────────────────────────────────
  loadCommandEvents(pgStore: unknown): Record<string, unknown>[] {
    return pg.loadCommandEvents(
      pgStore,
      this._domainFromDirectory,
      cmdHash,
      firstLine,
    );
  }

  // ── 6. Memories ─────────────────────────────────────────────────────
  loadMemories(
    pgStore: unknown,
    minHeat = 0.0,
    limit = 10000,
  ): Record<string, unknown>[] {
    return pg.loadMemories(pgStore, minHeat, limit);
  }

  // ── 7. Discussions ──────────────────────────────────────────────────
  loadDiscussions(): Record<string, unknown>[] {
    return jsonl.loadDiscussions(this._domainFromProjectDir);
  }

  // ── 8. Discussion relations ─────────────────────────────────────────
  loadDiscussionToolUses(): Record<string, unknown>[] {
    return jsonl.loadDiscussionToolUses(this._domainFromProjectDir);
  }

  loadDiscussionAgents(): Record<string, unknown>[] {
    return jsonl.loadDiscussionAgents(this._domainFromProjectDir);
  }

  loadDiscussionCommands(): Record<string, unknown>[] {
    return jsonl.loadDiscussionCommands(
      this._domainFromProjectDir,
      cmdHash,
      firstLine,
    );
  }

  loadDiscussionFiles(): Record<string, unknown>[] {
    return jsonl.loadDiscussionFiles(this._domainFromProjectDir);
  }

  // ── 9. Command → file ───────────────────────────────────────────────
  loadCommandFiles(
    pgStore: unknown,
    knownPaths: Iterable<string>,
  ): Record<string, unknown>[] {
    return pg.loadCommandFiles(pgStore, knownPaths, cmdHash, firstLine);
  }

  // ── 10. Skill usage + 11. MCP usage ────────────────────────────────
  loadSkillUsage(): Record<string, unknown>[] {
    return jsonl.loadSkillUsage(this._domainFromProjectDir);
  }

  loadMcpUsage(): Record<string, unknown>[] {
    return jsonl.loadMcpUsage(this._domainFromProjectDir);
  }

  // ── 12. Entities + memory-entity links ─────────────────────────────
  loadEntities(pgStore: unknown, minHeat = 0.05): Record<string, unknown>[] {
    return pg.loadEntities(pgStore, minHeat);
  }

  loadMemoryEntityEdges(pgStore: unknown): Record<string, unknown>[] {
    return pg.loadMemoryEntityEdges(pgStore);
  }
}
