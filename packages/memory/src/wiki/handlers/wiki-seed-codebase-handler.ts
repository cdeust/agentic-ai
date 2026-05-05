/**
 * Wiki seed-codebase handler — bootstrap wiki from repo markdown docs.
 *
 * Scans priority-ordered markdown files (README, CHANGELOG, ARCHITECTURE,
 * docs/**\/*.md, adr/**\/*.md, etc.) and provides their content + metadata
 * for import via the caller's remember function.
 *
 * Design note: this handler returns the file list and processed content;
 * the actual storage write is delegated to the caller-supplied rememberFn
 * to avoid a circular dependency between wiki-handlers and memory-store.
 * The Python handler did the same via a dynamic import.
 *
 * source: mcp_server/handlers/wiki_seed_codebase.py (Cortex ed33435)
 */

import * as fs from "node:fs";
import * as path from "node:path";

// source: mcp_server/handlers/wiki_seed_codebase.py:109-122 (_SEED_PATTERNS)
// Priority-ordered patterns — scanner walks the repo once and keeps files
// whose relative path matches any of these.
const SEED_PATTERNS: readonly string[] = [
  "README.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "ARCHITECTURE.md",
  "HISTORY.md",
  "SECURITY.md",
  "AGENTS.md",
  "CLAUDE.md",
];

// Recursive dir patterns are resolved by walking the tree
const SEED_RECURSIVE_DIRS = ["docs", "adr", ".claude"] as const;
const SEED_DIR_PATTERN = /\.md$/i;

// source: mcp_server/handlers/wiki_seed_codebase.py:125-135 (_SKIP_PATH_FRAGMENTS)
const SKIP_PATH_FRAGMENTS = [
  "/node_modules/",
  "/.venv/",
  "/.build/",
  "/.git/",
  "/dist/",
  "/build/",
  "/__pycache__/",
  "/.cache/",
  "/.generated/",
] as const;

// source: mcp_server/handlers/wiki_seed_codebase.py:77 — per-file size cap
const DEFAULT_MAX_FILES = 50;
const DEFAULT_MAX_BYTES_PER_FILE = 8192; // source: mcp_server/handlers/wiki_seed_codebase.py:76 (8 kB per-file cap)

// Max file size to consider for seeding (2 MB — prevents huge binary files)
// source: mcp_server/handlers/wiki_seed_codebase.py:178
const SEED_MAX_SCAN_FILE_SIZE = 2_000_000;

// Max errors to include in seed result
// source: mcp_server/handlers/wiki_seed_codebase.py:255 (errors[:10])
const SEED_MAX_ERRORS = 10;

export interface WikiSeedCodebaseArgs {
  readonly repo_root?: string | null;
  readonly max_files?: number | null;
  readonly max_bytes_per_file?: number | null;
  readonly dry_run?: boolean | null;
  readonly run_pipeline?: boolean | null;
  [key: string]: unknown;
}

export interface SeedFilePreview {
  readonly path: string;
  readonly kind: string;
  readonly size: number;
}

export interface SeedImportPayload {
  readonly content: string;
  readonly tags: string[];
  readonly domain: string;
  readonly source: string;
  readonly force: boolean;
  readonly rel_path: string;
  readonly kind: string;
}

export interface WikiSeedCodebaseResult {
  readonly files_found: number;
  readonly imported: number;
  readonly errors: string[];
  readonly error_count: number;
  readonly dry_run: boolean;
  readonly preview?: SeedFilePreview[];
  readonly pipeline?: Record<string, unknown>;
}

/**
 * Infer wiki kind from a relative path.
 * source: mcp_server/handlers/wiki_seed_codebase.py:138-151 (_kind_for)
 */
function kindFor(relPath: string): string {
  const low = relPath.toLowerCase();
  if (low.includes("adr") || low.includes("decision")) return "adr";
  if (low.includes("architecture")) return "spec";
  if (low.includes("convention") || low.includes("style")) return "convention";
  if (low.includes("lesson") || low.includes("postmortem")) return "lesson";
  if (low.startsWith("readme") || low.endsWith("/readme.md")) return "note";
  return "note";
}

/**
 * Collect seed-worthy markdown files from the repo.
 * source: mcp_server/handlers/wiki_seed_codebase.py:153-184 (_collect_files)
 *
 * Precondition: root is an existing directory path; maxFiles >= 1.
 * Postcondition: returns list of [absPath, relPath] pairs ≤ maxFiles,
 *   filtered by skip fragments and minimum file size.
 */
function collectFiles(
  root: string,
  maxFiles: number,
): Array<[string, string]> {
  const resolvedRoot = fs.realpathSync(root);
  const seen = new Set<string>();
  const results: Array<[string, string]> = [];

  function shouldSkip(rel: string): boolean {
    const fragPath = `/${rel}`;
    return SKIP_PATH_FRAGMENTS.some((frag) => fragPath.includes(frag));
  }

  function addFile(absPath: string): void {
    if (results.length >= maxFiles) return;
    let resolved: string;
    try {
      resolved = fs.realpathSync(absPath);
    } catch {
      return;
    }
    if (seen.has(resolved)) return;
    seen.add(resolved);
    const rel = path.relative(resolvedRoot, resolved).replace(/\\/g, "/");
    if (shouldSkip(rel)) return;
    try {
      const stat = fs.statSync(resolved);
      if (!stat.isFile() || stat.size === 0 || stat.size > SEED_MAX_SCAN_FILE_SIZE) return; // source: mcp_server/handlers/wiki_seed_codebase.py:178
    } catch {
      return;
    }
    results.push([resolved, rel]);
  }

  // Priority files first
  for (const pattern of SEED_PATTERNS) {
    const abs = path.join(resolvedRoot, pattern);
    if (fs.existsSync(abs)) addFile(abs);
    if (results.length >= maxFiles) break;
  }

  // Recursive dirs
  if (results.length < maxFiles) {
    for (const dirName of SEED_RECURSIVE_DIRS) {
      const dirPath = path.join(resolvedRoot, dirName);
      if (!fs.existsSync(dirPath)) continue;
      try {
        walkDir(dirPath, (absFile) => {
          if (SEED_DIR_PATTERN.test(absFile)) addFile(absFile);
        });
      } catch {
        // ignore unreadable dirs
      }
      if (results.length >= maxFiles) break;
    }
  }

  // ADR-*.md at root
  if (results.length < maxFiles) {
    try {
      for (const entry of fs.readdirSync(resolvedRoot).sort()) {
        if (/^ADR-.*\.md$/i.test(entry)) {
          addFile(path.join(resolvedRoot, entry));
          if (results.length >= maxFiles) break;
        }
      }
    } catch {
      // ignore
    }
  }

  return results;
}

function walkDir(dir: string, visit: (absPath: string) => void): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_PATH_FRAGMENTS.some((f) => abs.includes(f))) walkDir(abs, visit);
    } else if (entry.isFile()) {
      visit(abs);
    }
  }
}

/**
 * Seed-codebase handler.
 *
 * Precondition:  rememberFn is a callable that accepts a payload and stores a memory.
 * Postcondition: up to max_files markdown docs are imported via rememberFn;
 *   returns real counts of files_found, imported, errors.
 *   In dry_run mode returns preview list without importing.
 *
 * source: mcp_server/handlers/wiki_seed_codebase.py:187-261
 */
export async function wikiSeedCodebaseHandler(
  args: WikiSeedCodebaseArgs,
  rememberFn: (payload: SeedImportPayload) => Promise<{ stored?: boolean; memory_id?: number }>,
  pipelineFn?: (pipeArgs: Record<string, unknown>) => Promise<Record<string, unknown>>,
): Promise<WikiSeedCodebaseResult> {
  const repoRoot = typeof args.repo_root === "string" && args.repo_root
    ? args.repo_root
    : process.cwd();
  const maxFiles = typeof args.max_files === "number" ? args.max_files : DEFAULT_MAX_FILES;
  const maxBytes = typeof args.max_bytes_per_file === "number"
    ? args.max_bytes_per_file
    : DEFAULT_MAX_BYTES_PER_FILE;
  const dryRun = args.dry_run === true;
  const runPipeline = args.run_pipeline !== false; // default true

  let resolvedRoot: string;
  try {
    resolvedRoot = fs.realpathSync(repoRoot);
  } catch {
    return {
      files_found: 0,
      imported: 0,
      errors: [`repo_root not accessible: ${repoRoot}`],
      error_count: 1,
      dry_run: dryRun,
    };
  }

  const files = collectFiles(resolvedRoot, maxFiles);
  if (!files.length) {
    return {
      files_found: 0,
      imported: 0,
      errors: [],
      error_count: 0,
      dry_run: dryRun,
    };
  }

  if (dryRun) {
    return {
      files_found: files.length,
      imported: 0,
      errors: [],
      error_count: 0,
      dry_run: true,
      preview: files.map(([absPath, relPath]) => ({
        path: relPath,
        kind: kindFor(relPath),
        size: (() => { try { return fs.statSync(absPath).size; } catch { return 0; } })(),
      })),
    };
  }

  let imported = 0;
  const errors: string[] = [];
  const domain = path.basename(resolvedRoot) || "seed";

  // Invariant: imported <= files processed so far; errors.length <= files processed
  // Termination: for loop over finite files array
  for (const [absPath, relPath] of files) {
    try {
      let content = fs.readFileSync(absPath, "utf-8");
      if (content.length > maxBytes) {
        content = content.slice(0, maxBytes) + "\n\n[...truncated]";
      }
      const kind = kindFor(relPath);
      const result = await rememberFn({
        content,
        tags: ["seed:codebase", `kind:${kind}`, `file:${relPath}`],
        domain,
        source: `seed:${relPath}`,
        force: true,
        rel_path: relPath,
        kind,
      });
      if (result.stored || result.memory_id != null) imported++;
    } catch (err) {
      errors.push(`${relPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const summary: WikiSeedCodebaseResult = {
    files_found: files.length,
    imported,
    errors: errors.slice(0, SEED_MAX_ERRORS),
    error_count: errors.length,
    dry_run: false,
  };

  if (runPipeline && imported > 0 && pipelineFn) {
    try {
      const pipe = await pipelineFn({ limit_per_stage: 1000 }); // source: mcp_server/handlers/wiki_seed_codebase.py:251
      return {
        ...summary,
        pipeline: {
          claims_inserted: pipe["claims_inserted"] ?? 0,
          concepts_inserted: pipe["concepts_inserted"] ?? 0,
          drafts_approved: pipe["drafts_approved"] ?? 0,
          pages_published: pipe["pages_published"] ?? 0,
        },
      };
    } catch (err) {
      return {
        ...summary,
        pipeline: { error: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  return summary;
}
