/**
 * Top-level import handler: discovers JSONL session files, extracts
 * memorable items, and routes each through the remember write gate.
 *
 * Port of: mcp_server/handlers/import_sessions.py::handler
 *
 * Faithful glyph-for-glyph translation. No data lost on import.
 * Preview items are capped at 50 (source: _build_result in import_sessions.py).
 * Error list is capped at 10 (source: _build_result in import_sessions.py).
 *
 * source: mcp_server/handlers/import_sessions.py
 */

import { join } from "node:path";
import { homedir } from "node:os";

import { ageDecayedHeat, computeAgeDays } from "./heat.js";
import { discoverJsonlFiles } from "./scanner.js";
import { readHeadTail } from "./scanner.js";
import { extractMemorableItems, extractSessionSummary } from "./session-extractor.js";
import { detectDomainFromPath } from "./domain-detector.js";
import type {
  ExtractedItem,
  ImportRequest,
  ImportResponse,
  PreviewItem,
  RememberHandler,
} from "./types.js";
import { ImportRequestSchema } from "./types.js";

// ── Constants ─────────────────────────────────────────────────────────────
// source: mcp_server/infrastructure/config.py CLAUDE_DIR = ~/.claude
const CLAUDE_DIR = join(homedir(), ".claude");
const PROJECTS_DIR = join(CLAUDE_DIR, "projects");

// source: _build_result: result["preview"] = preview_items[:50]
const MAX_PREVIEW_ITEMS = 50;

// source: _build_result: result["errors"] = errors[:10]
const MAX_ERRORS = 10;

// ── Preview item builder ───────────────────────────────────────────────────

/**
 * Build a truncated preview dict for dry-run mode.
 *
 * Port of: mcp_server/handlers/import_sessions.py::_build_preview_item
 *
 * source: content[:120] + ("..." if len(content) > 120 else "")
 *         import_sessions.py::_build_preview_item
 */
function buildPreviewItem(
  item: ExtractedItem,
  projectName: string,
  domain: string,
): PreviewItem {
  const content =
    item.content.length > 120
      ? item.content.slice(0, 120) + "..."
      : item.content;
  return {
    content,
    tags: item.tags,
    importance: Math.round(item.importance * 1000) / 1000,
    project: projectName,
    domain,
  };
}

// ── Memory storage ────────────────────────────────────────────────────────

/**
 * Store a single extracted item via the remember handler.
 *
 * Preserves original session timestamp AND computes age-decayed initial
 * heat from it, so historical conversations don't form a bimodal cohort
 * at heat=1.0 after import.
 *
 * Port of: mcp_server/handlers/import_sessions.py::_store_memory
 *
 * source: issue #14 P1 — age-decayed initial heat fix
 * source: mcp_server/handlers/import_sessions.py::_store_memory
 */
async function storeMemory(
  item: ExtractedItem,
  domain: string,
  rememberHandler: RememberHandler,
): Promise<boolean> {
  const args = {
    content: item.content,
    tags: item.tags,
    domain,
    source: "import",
    force: false,
    ...(item.timestamp
      ? {
          created_at: item.timestamp,
          initial_heat: ageDecayedHeat(computeAgeDays(item.timestamp)),
        }
      : {}),
  };

  const result = await rememberHandler(args);
  return Boolean(result?.stored);
}

// ── Session item processing ───────────────────────────────────────────────

/**
 * Process items from one session.
 * Returns [imported, gated] counts.
 *
 * Port of: mcp_server/handlers/import_sessions.py::_process_session_items
 */
async function processSessionItems(
  items: ExtractedItem[],
  projectName: string,
  sessionDomain: string,
  dryRun: boolean,
  previewItems: PreviewItem[],
  rememberHandler: RememberHandler,
): Promise<[number, number]> {
  let imported = 0;
  let gated = 0;

  for (const item of items) {
    if (dryRun) {
      previewItems.push(buildPreviewItem(item, projectName, sessionDomain));
      imported += 1;
    } else {
      const stored = await storeMemory(item, sessionDomain, rememberHandler);
      if (stored) {
        imported += 1;
      } else {
        gated += 1;
      }
    }
  }

  return [imported, gated];
}

// ── Single file processing ────────────────────────────────────────────────

/**
 * Process one JSONL file.
 * Returns [imported, gated, skipped, scanned].
 *
 * Port of: mcp_server/handlers/import_sessions.py::_process_single_file
 */
async function processSingleFile(
  filePath: string,
  projectName: string,
  domainFilter: string,
  minImportance: number,
  dryRun: boolean,
  previewItems: PreviewItem[],
  rememberHandler: RememberHandler,
): Promise<[number, number, number, boolean]> {
  const records = readHeadTail(filePath);
  if (records.length === 0) return [0, 0, 0, false];

  const summary = extractSessionSummary(records);
  const items = extractMemorableItems(records, minImportance);
  if (items.length === 0) return [0, 0, 0, true];

  const sessionDomain = detectDomainFromPath(summary.cwd);
  if (domainFilter && sessionDomain !== domainFilter) {
    return [0, 0, items.length, true];
  }

  const [imported, gated] = await processSessionItems(
    items,
    projectName,
    sessionDomain,
    dryRun,
    previewItems,
    rememberHandler,
  );

  return [imported, gated, 0, true];
}

// ── Result builder ────────────────────────────────────────────────────────

/**
 * Assemble the final result object.
 *
 * Port of: mcp_server/handlers/import_sessions.py::_build_result
 *
 * source: preview cap=50, errors cap=10 — import_sessions.py::_build_result
 */
function buildResult(
  totalImported: number,
  totalGated: number,
  totalSkipped: number,
  sessionsScanned: number,
  totalFiles: number,
  dryRun: boolean,
  previewItems: PreviewItem[],
  errors: string[],
): ImportResponse {
  const result: ImportResponse = {
    imported: totalImported,
    gated: totalGated,
    skipped: totalSkipped,
    sessions_scanned: sessionsScanned,
    total_files: totalFiles,
    dry_run: dryRun,
  };

  if (dryRun && previewItems.length > 0) {
    result.preview = previewItems.slice(0, MAX_PREVIEW_ITEMS);
    result.preview_truncated = previewItems.length > MAX_PREVIEW_ITEMS;
  }

  if (errors.length > 0) {
    result.errors = errors.slice(0, MAX_ERRORS);
  }

  return result;
}

// ── Handler ───────────────────────────────────────────────────────────────

/**
 * Import conversation sessions into the memory store.
 *
 * Port of: mcp_server/handlers/import_sessions.py::handler
 *
 * The rememberHandler dependency is injected (DIP) — the caller provides
 * the write-gate implementation from port/cortex-remember (#2). This
 * keeps the import subsystem decoupled from the storage layer.
 *
 * source: mcp_server/handlers/import_sessions.py::handler
 */
export async function importHandler(
  args: Partial<ImportRequest> | null | undefined,
  rememberHandler: RememberHandler,
  projectsDirOverride?: string,
): Promise<ImportResponse> {
  const parsed = ImportRequestSchema.parse(args ?? {});
  const { project: projectFilter, domain: domainFilter, min_importance, max_sessions, dry_run } = parsed;

  const projectsDir = projectsDirOverride ?? PROJECTS_DIR;
  let jsonlFiles = discoverJsonlFiles(projectsDir, projectFilter);

  if (jsonlFiles.length === 0) {
    return {
      imported: 0,
      gated: 0,
      skipped: 0,
      sessions_scanned: 0,
      total_files: 0,
      dry_run,
      error: "no_sessions_found",
    };
  }

  if (max_sessions > 0) {
    jsonlFiles = jsonlFiles.slice(0, max_sessions);
  }

  let totalImported = 0;
  let totalGated = 0;
  let totalSkipped = 0;
  let sessionsScanned = 0;
  const previewItems: PreviewItem[] = [];
  const errors: string[] = [];

  for (const { filePath, projectName } of jsonlFiles) {
    try {
      const [imported, gated, skipped, scanned] = await processSingleFile(
        filePath,
        projectName,
        domainFilter,
        min_importance,
        dry_run,
        previewItems,
        rememberHandler,
      );
      totalImported += imported;
      totalGated += gated;
      totalSkipped += skipped;
      sessionsScanned += scanned ? 1 : 0;
    } catch (err: unknown) {
      const name = filePath.split("/").pop() ?? filePath;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${name}: ${msg}`);
      process.stderr.write(
        `[import_sessions] Error processing ${name}: ${msg}\n`,
      );
    }
  }

  return buildResult(
    totalImported,
    totalGated,
    totalSkipped,
    sessionsScanned,
    jsonlFiles.length,
    dry_run,
    previewItems,
    errors,
  );
}

// ── Schema metadata ───────────────────────────────────────────────────────
// source: mcp_server/handlers/import_sessions.py schema block

export const schema = {
  title: "Import sessions",
  description:
    "Import Claude Code conversation history from ~/.claude/projects/ " +
    "into the memory store. Walks JSONL session files, extracts memorable " +
    "items (decisions, errors-and-fixes, architecture notes, key insights) " +
    "via session_extractor, and routes each through the remember write gate " +
    "(thermodynamics, hierarchical predictive coding, knowledge graph, engram " +
    "allocation). Supports project / domain filtering and dry-run preview.",
  inputSchema: {
    type: "object",
    required: [],
    properties: {
      project: {
        type: "string",
        description:
          "Filter to a single Claude Code project directory slug. " +
          "Omit to import from every project.",
        examples: ["-Users-alice-code-cortex"],
      },
      domain: {
        type: "string",
        description:
          "Restrict import to sessions classified under this cognitive domain.",
        examples: ["cortex", "ai-architect"],
      },
      min_importance: {
        type: "number",
        description:
          "Minimum importance (0.0-1.0) for an extracted item to be imported. " +
          "Lower = more memories, more noise.",
        default: 0.4,
        minimum: 0.0,
        maximum: 1.0,
        examples: [0.3, 0.4, 0.6],
      },
      max_sessions: {
        type: "integer",
        description:
          "Maximum number of session files to process this call.",
        minimum: 1,
        examples: [50, 200],
      },
      dry_run: {
        type: "boolean",
        description:
          "Preview what would be imported without writing to the store. " +
          "Always run a dry_run first.",
        default: false,
      },
    },
  },
} as const;
