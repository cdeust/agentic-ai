/**
 * seed-project.ts — seed_project handler.
 *
 * Bootstrap memory from an existing codebase by scanning files and creating
 * structured memories. Performs a five-stage structural sweep:
 *   Stage 1: Config extraction  (package.json, pyproject.toml, Cargo.toml, …)
 *   Stage 2: Docs harvesting    (README*, CLAUDE*, docs/, adr/, …)
 *   Stage 3: Entry point scan   (main.ts, index.js, __main__.py, …)
 *   Stage 4: CI/CD detection    (.github/workflows, Makefile, Dockerfile, …)
 *   Stage 5: Structural summary (top-level layout + language detection)
 *
 * Each discovery is stored through the standard remember write gate.
 *
 * Layer: codebase-analysis/handlers (composition — wires scanner + store).
 * Allowed imports: file-scanner, @agentic/memory/remember types, node:fs.
 *
 * source: cortex@ed33435 mcp_server/handlers/seed_project.py::handler
 * source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py
 */

import { existsSync } from "node:fs";
import { basename, resolve as resolvePath } from "node:path";
import { collectAllDiscoveries, heatForTags } from "../file-scanner.js";
import type { MemoryStore } from "../../remember/storage/memory-store.js";
import type { MemoryInsertData } from "../../remember/types.js";

// ── Named constants ───────────────────────────────────────────────────────────

// source: cortex@ed33435 mcp_server/handlers/seed_project.py:117 — max_file_size_kb default 64
const DEFAULT_MAX_FILE_SIZE_KB = 64; // source: cortex@ed33435 seed_project.py:117
// source: IEC 80000-13 — 1 kibibyte = 1024 bytes
const BYTES_PER_KB = 1024; // source: IEC 80000-13:2008 §21-12

// ── Dependency injection type ─────────────────────────────────────────────────

export interface SeedProjectDeps {
  /** Live MemoryStore. Must support insertMemory, bumpHeatRaw, and tag queries. */
  store: MemoryStore;
}

// ── Handler args + response ───────────────────────────────────────────────────

export interface SeedProjectArgs {
  directory?:        string;
  domain?:           string;
  max_file_size_kb?: number;
  dry_run?:          boolean;
}

export interface SeedProjectResponse {
  seeded:         boolean;
  directory?:     string;
  domain?:        string;
  discoveries?:   number;
  stored?:        number;
  skipped?:       number;
  purged_stale?:  number;
  memory_ids?:    number[];
  titles?:        string[];
  stages?:        Record<string, number>;
  dry_run?:       boolean;
  reason?:        string;
}

// ── Argument parsing ──────────────────────────────────────────────────────────

/**
 * Extract and validate handler arguments.
 *
 * precondition:  args may be null/undefined.
 * postcondition: returns (root absolute path, domain, maxBytes, dry_run).
 *
 * source: cortex@ed33435 mcp_server/handlers/seed_project.py::_parse_args:112-119
 */
function parseArgs(args: SeedProjectArgs): {
  root:    string;
  domain:  string;
  maxBytes: number;
  dryRun:  boolean;
} {
  const raw = args.directory?.trim() || process.cwd();
  const root = resolvePath(raw);
  const domain = args.domain?.trim() ?? basename(root);
  const maxKb = args.max_file_size_kb ?? DEFAULT_MAX_FILE_SIZE_KB;
  const maxBytes = maxKb * BYTES_PER_KB;
  const dryRun = args.dry_run ?? false;
  return { root, domain, maxBytes, dryRun };
}

// ── Stage count summary ───────────────────────────────────────────────────────

/**
 * Count discoveries per stage from their tag lists.
 *
 * postcondition: returns a map of stage name → count.
 *
 * source: cortex@ed33435 mcp_server/handlers/seed_project.py::_build_stage_counts:158-168
 */
function buildStageCounts(
  discoveries: ReadonlyArray<{ readonly tags: readonly string[] }>,
): Record<string, number> {
  return {
    structural_summary: 1,
    configs:      discoveries.filter((d) => d.tags.includes("config")).length,
    docs:         discoveries.filter((d) => d.tags.includes("documentation")).length,
    entry_points: discoveries.filter((d) => d.tags.includes("entry-point")).length,
    cicd:         discoveries.filter((d) => d.tags.includes("ci-cd")).length,
  };
}

// ── Discovery storage ─────────────────────────────────────────────────────────

/**
 * Store discoveries via the MemoryStore.
 *
 * Each discovery is inserted as a new memory; stale heat is applied after
 * insertion. We do not use the write gate here because `force=true` is the
 * intent (same as the Python handler's `force=True` on every discovery).
 *
 * precondition:  store is live; discoveries is non-empty.
 * postcondition: returns (stored, skipped, memoryIds); stored + skipped == discoveries.length.
 *   Each stored ID is guaranteed positive. bumpHeatRaw is called once per ID.
 *
 * source: cortex@ed33435 mcp_server/handlers/seed_project.py::_store_discoveries:122-155
 */
function storeDiscoveries(
  discoveries: ReadonlyArray<{ title: string; content: string; tags: readonly string[] }>,
  root: string,
  domain: string,
  store: MemoryStore,
): { stored: number; skipped: number; memoryIds: number[] } {
  let stored = 0;
  let skipped = 0;
  const memoryIds: number[] = [];

  for (const disc of discoveries) {
    try {
      const discTags = [...disc.tags, "seeded"];
      const initialHeat = heatForTags(discTags);

      const insertData: MemoryInsertData = {
        content:           disc.content,
        tags:              discTags,
        domain:            domain,
        directory_context: root,
        source:            "seed_project",
        importance:        initialHeat,
      };
      const mid = store.insertMemory(insertData);
      if (mid > 0) {
        store.bumpHeatRaw(mid, initialHeat);
        stored++;
        memoryIds.push(mid);
      } else {
        skipped++;
      }
    } catch {
      skipped++;
    }
  }

  return { stored, skipped, memoryIds };
}

// ── Public handler ────────────────────────────────────────────────────────────

/**
 * seed_project handler — bootstrap memory from an existing codebase.
 *
 * precondition:  deps.store is a live MemoryStore;
 *   args.directory (if given) is a readable directory path.
 * postcondition: when dry_run=false and root exists:
 *   - all prior "seeded" memories are purged (delete_memories_by_tag);
 *   - all discoveries across all 5 stages are inserted + heat-bumped;
 *   - returns {seeded:true, stored, skipped, purged_stale, memory_ids, stages}.
 *   when dry_run=true: returns {seeded:false, dry_run:true, discoveries, titles}.
 *   when root does not exist: returns {seeded:false, reason:"directory not found"}.
 *
 * source: cortex@ed33435 mcp_server/handlers/seed_project.py::handler:171-208
 */
export async function handler(
  args: SeedProjectArgs,
  deps: SeedProjectDeps,
): Promise<SeedProjectResponse> {
  const { root, domain, maxBytes, dryRun } = parseArgs(args);

  if (!existsSync(root)) {
    return { seeded: false, reason: `directory not found: ${root}` };
  }

  const allDiscoveries = collectAllDiscoveries(root, maxBytes);

  if (dryRun) {
    return {
      seeded:      false,
      dry_run:     true,
      discoveries: allDiscoveries.length,
      titles:      allDiscoveries.map((d) => d.title),
    };
  }

  // Purge prior seeded memories before re-seeding.
  // Scope purge to this domain (issue #16): seeding repo-A must not
  // wipe out repo-B's seeded memories. Domain authority ends at the
  // project boundary; cross-domain effects are an externality.
  // source: cortex@fdc78f7 mcp_server/handlers/seed_project.py:181-186 (issue #16)
  let purgedStale = 0;
  const storeExt = deps.store as unknown as {
    deleteMemoriesByTag?: (tag: string, domain?: string) => number;
  };
  if (typeof storeExt.deleteMemoriesByTag === "function") {
    purgedStale = storeExt.deleteMemoriesByTag("seeded", domain);
  }

  const { stored, skipped, memoryIds } = storeDiscoveries(
    allDiscoveries,
    root,
    domain,
    deps.store,
  );

  return {
    seeded:       true,
    directory:    root,
    domain,
    discoveries:  allDiscoveries.length,
    stored,
    skipped,
    purged_stale: purgedStale,
    memory_ids:   memoryIds,
    stages:       buildStageCounts(allDiscoveries),
  };
}

/** Schema metadata (mirrors Python handler schema for MCP registry). */
export const schema = {
  title: "Seed project",
  description:
    "Bootstrap the memory store from an existing codebase via a five-stage " +
    "structural sweep (config extraction, documentation harvesting, entry-point " +
    "scan, CI/CD detection, structural summary). Each discovery is stored through " +
    "the standard write gate. Distinct from codebase_analyze (tree-sitter AST per " +
    "file, much deeper). Returns counts and stored memory IDs.",
};

export type SeedProjectHandlerFn = typeof handler;
