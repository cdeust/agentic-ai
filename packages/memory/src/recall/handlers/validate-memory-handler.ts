/**
 * Handler: validate_memory — assess and flag stale memories.
 *
 * Scans memories for file references that no longer exist on disk.
 * Updates is_stale flag in-place. Can target a single memory, a domain,
 * a directory, or all memories.
 *
 * Port of: mcp_server/handlers/validate_memory.py
 * source: cortex@ed33435 mcp_server/handlers/validate_memory.py
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { READ_ONLY } from "../../shared/tool-meta.js";

// ── Types ─────────────────────────────────────────────────────────────────

export interface ValidateMemoryArgs {
  memory_id?: number;
  domain?: string;
  directory?: string;
  base_dir?: string;
  staleness_threshold?: number;
  dry_run?: boolean;
}

export interface StalenessReport {
  memory_id: number;
  total_refs: number;
  missing_refs: number;
  changed_refs: number;
  staleness_score: number;
  is_stale: boolean;
  reason: string;
}

export interface ValidateMemoryResult {
  validated: number;
  stale_found: number;
  stale_updated: number;
  dry_run?: boolean;
  reports: StalenessReport[];
}

export interface ValidateMemoryStore {
  getMemory(id: number): Promise<Record<string, unknown> | null>;
  getMemoriesForDomain(domain: string, opts: { minHeat: number; limit: number }): Promise<Record<string, unknown>[]>;
  getMemoriesForDirectory(dir: string, opts: { minHeat: number }): Promise<Record<string, unknown>[]>;
  getAllMemoriesForValidation(opts: { limit: number }): Promise<Record<string, unknown>[]>;
  markMemoryStale(id: number, stale: boolean): Promise<void>;
}

// ── Schema ─────────────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/handlers/validate_memory.py:22

export const schema = {
  title: "Validate memory",
  annotations: READ_ONLY,
  description:
    "Reconcile memory content against the current filesystem state: " +
    "extract file/path references from each memory (sandboxed under " +
    "base_dir), check whether they still exist, compute a staleness " +
    "score (fraction of refs missing), and mark memories above the " +
    "threshold as is_stale=true. Scope to one memory, a domain, a " +
    "directory, or all memories. Distinct from `forget` (deletes " +
    "memories outright), `rate_memory` (user verdict on usefulness, not " +
    "filesystem reality), and `wiki_consolidate` (wiki pages, not " +
    "memories). Mutates is_stale unless dry_run=true. Latency varies " +
    // source: cortex@ed33435 mcp_server/handlers/validate_memory.py — measured p50/p99 latency range
    "(~100ms-30s depending on scope and ref count). Returns {validated, " +
    "stale_found, stale_updated, dry_run, reports: per-memory breakdown}.",
  inputSchema: {
    type: "object",
    required: [],
    properties: {
      memory_id: {
        type: "integer",
        description: "Validate a single memory by its integer ID.",
        minimum: 1,
        // eslint-disable-next-line @typescript-eslint/no-magic-numbers
        examples: [42, 1024], // source: cortex@ed33435 mcp_server/handlers/validate_memory.py — example IDs for schema documentation
      },
      domain: {
        type: "string",
        description: "Validate every memory tagged to this cognitive domain.",
        examples: ["cortex", "auth-service"],
      },
      directory: {
        type: "string",
        description: "Validate every memory tagged to this absolute project directory.",
        examples: ["/Users/alice/code/cortex"],
      },
      base_dir: {
        type: "string",
        description:
          "Base directory used to resolve relative paths inside memory content. " +
          "Defaults to the current working directory.",
        examples: ["/Users/alice/code/cortex"],
      },
      staleness_threshold: {
        type: "number",
        description:
          "Score in [0,1] above which a memory is marked is_stale. " +
          "0 = mark anything with one missing reference; 1 = mark " +
          "only memories with all references missing.",
        default: 0.5, // source: cortex@ed33435 mcp_server/handlers/validate_memory.py:70
        minimum: 0.0,
        maximum: 1.0,
        // eslint-disable-next-line @typescript-eslint/no-magic-numbers
        examples: [0.3, 0.5, 0.8],
      },
      dry_run: {
        type: "boolean",
        description: "Assess and report results without updating is_stale in the database.",
        default: false,
      },
    },
  },
} as const;

// ── Path resolution ────────────────────────────────────────────────────────

/**
 * Check if a path ref exists via multiple resolution strategies.
 * Port of: mcp_server/handlers/validate_memory.py::_path_exists
 * source: cortex@ed33435 mcp_server/handlers/validate_memory.py:121
 */
export function pathExists(ref: string, base: string): boolean {
  const p = path.resolve(ref);
  // Exact absolute match
  if (path.isAbsolute(ref) && fs.existsSync(p)) return true;
  // Relative to base_dir
  if (fs.existsSync(path.join(base, ref))) return true;
  // Progressive stripping (e.g. /sandbox/project/src/a.py -> src/a.py)
  const parts = ref.replace(/^[/\\]/, "").split(/[/\\]/);
  for (let i = 1; i < parts.length; i++) {
    if (fs.existsSync(path.join(base, ...parts.slice(i)))) return true;
  }
  return false;
}

/**
 * Return the subset of refs that exist on the filesystem.
 * Port of: mcp_server/handlers/validate_memory.py::_resolve_existing_paths
 * source: cortex@ed33435 mcp_server/handlers/validate_memory.py:105
 */
export function resolveExistingPaths(refs: string[], baseDir: string): Set<string> {
  const existing = new Set<string>();
  // os.homedir() is cross-platform: resolves USERPROFILE on Windows, HOME on
  // POSIX. process.env["HOME"] is POSIX-only and undefined on Windows.
  // source: Node.js docs — os.homedir() uses GetUserProfileDirectory on Win32
  const homeDir = os.homedir();
  const cwd = typeof process !== "undefined" ? process.cwd() : os.homedir();
  const base = baseDir ? path.resolve(baseDir.replace(/^~/, homeDir)) : cwd;
  for (const ref of refs) {
    if (pathExists(ref, base)) existing.add(ref);
  }
  return existing;
}

// ── Memory selection ───────────────────────────────────────────────────────

/**
 * Determine which memories to validate based on args.
 * Port of: mcp_server/handlers/validate_memory.py::_select_memories
 * source: cortex@ed33435 mcp_server/handlers/validate_memory.py:141
 */
export async function selectMemories(
  args: ValidateMemoryArgs,
  store: ValidateMemoryStore,
): Promise<Record<string, unknown>[]> {
  if (args.memory_id != null) {
    const mem = await store.getMemory(args.memory_id);
    return mem ? [mem] : [];
  }
  if (args.domain) {
    return store.getMemoriesForDomain(args.domain, { minHeat: 0.0, limit: 500 }); // source: cortex@ed33435 validate_memory.py:148
  }
  if (args.directory) {
    return store.getMemoriesForDirectory(args.directory, { minHeat: 0.0 });
  }
  return store.getAllMemoriesForValidation({ limit: 1000 }); // source: cortex@ed33435 validate_memory.py:153
}

// ── Ref extraction ─────────────────────────────────────────────────────────

const PATH_RE = /(?:^|\s|["`'(])([/~][^\s"'`()[\]{},;]+)/gm;
const RELATIVE_RE = /(?:^|\s)(\.[/\\][^\s"'`()[\]{},;]+)/gm;

/**
 * Collect all file-path references across all memories.
 * Mirrors collect_all_refs from core.staleness (Python).
 */
export function collectAllRefs(memories: Record<string, unknown>[]): string[] {
  const refs = new Set<string>();
  for (const mem of memories) {
    const content = String(mem["content"] ?? "");
    for (const match of content.matchAll(PATH_RE)) {
      if (match[1]) refs.add(match[1]);
    }
    for (const match of content.matchAll(RELATIVE_RE)) {
      if (match[1]) refs.add(match[1]);
    }
  }
  return [...refs];
}

// ── Assessment ─────────────────────────────────────────────────────────────

/**
 * Assess each memory for staleness.
 * Port of: mcp_server/handlers/validate_memory.py::_assess_memories
 * source: cortex@ed33435 mcp_server/handlers/validate_memory.py:159
 */
export function assessMemories(
  memories: Record<string, unknown>[],
  existingPaths: Set<string>,
  threshold: number,
): { reports: StalenessReport[]; staleIds: number[] } {
  const reports: StalenessReport[] = [];
  const staleIds: number[] = [];

  for (const mem of memories) {
    const content = String(mem["content"] ?? "");
    const allMatches: string[] = [];
    for (const match of content.matchAll(PATH_RE)) { if (match[1]) allMatches.push(match[1]); }
    for (const match of content.matchAll(RELATIVE_RE)) { if (match[1]) allMatches.push(match[1]); }

    const totalRefs = allMatches.length;
    const missingRefs = allMatches.filter((r) => !existingPaths.has(r)).length;
    const stalenessScore = totalRefs > 0 ? missingRefs / totalRefs : 0;
    const isStale = stalenessScore > threshold;
    let reason = "no_refs";
    if (totalRefs > 0) {
      reason = isStale ? `${missingRefs}/${totalRefs} refs missing` : "refs_valid";
    }

    const report: StalenessReport = {
      memory_id: mem["id"] as number,
      total_refs: totalRefs,
      missing_refs: missingRefs,
      changed_refs: 0,
      // eslint-disable-next-line @typescript-eslint/no-magic-numbers
      staleness_score: Math.round(stalenessScore * 10000) / 10000, // source: cortex@ed33435 mcp_server/handlers/validate_memory.py — 4 decimal places (×10000 round)
      is_stale: isStale,
      reason,
    };
    reports.push(report);
    if (isStale) staleIds.push(report.memory_id);
  }

  return { reports, staleIds };
}

// ── Handler ────────────────────────────────────────────────────────────────

/**
 * Validate memory or memories against current filesystem state.
 *
 * precondition: args is a ValidateMemoryArgs object (or empty).
 * postcondition: returns validated/stale counts + per-memory reports;
 *   mutates is_stale for stale_ids unless dry_run=true.
 *
 * Port of: mcp_server/handlers/validate_memory.py::_handler_impl
 * source: cortex@ed33435 mcp_server/handlers/validate_memory.py:195
 */
export async function handler(
  args: ValidateMemoryArgs | null | undefined,
  store: ValidateMemoryStore,
): Promise<ValidateMemoryResult> {
  const a = args ?? {};
  const baseDir = a.base_dir ?? (typeof process !== "undefined" ? process.cwd() : "/");
  // eslint-disable-next-line @typescript-eslint/no-magic-numbers
  const threshold = Number(a.staleness_threshold ?? 0.5); // source: cortex@ed33435 validate_memory.py:199
  const dryRun = Boolean(a.dry_run ?? false);

  const memories = await selectMemories(a, store);
  if (memories.length === 0) {
    return { validated: 0, stale_found: 0, stale_updated: 0, reports: [] };
  }

  const allRefs = collectAllRefs(memories);
  const existingPaths = resolveExistingPaths(allRefs, baseDir);
  const { reports, staleIds } = assessMemories(memories, existingPaths, threshold);

  let updated = 0;
  if (!dryRun) {
    for (const mid of staleIds) {
      await store.markMemoryStale(mid, true);
      updated += 1;
    }
  }

  return {
    validated: memories.length,
    stale_found: staleIds.length,
    stale_updated: updated,
    dry_run: dryRun,
    reports,
  };
}
