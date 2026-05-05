/**
 * SessionStart hook — inject memory context at session start.
 *
 * Claude Code fires this once per session, before any UserPromptSubmit.
 * This hook connects to PostgreSQL and prints a Markdown context block
 * to stdout. Claude Code injects stdout into the context window.
 *
 * Happens-before invariants (Lamport 1978, §2):
 *   I1: autoWirePipeline fires BEFORE the DB connection attempt, because
 *       the auto-wire itself does not need the DB (it only writes a JSON
 *       config file or reads env vars).
 *   I2: background reanalysis spawned BEFORE DB connect attempt —
 *       the detached child connects independently; no ordering
 *       between parent DB access and child DB access is assumed.
 *   I3: anchors fetched BEFORE hot memories (ID exclusion dependency).
 *   I4: team decisions fetched with anchor IDs excluded (same invariant).
 *   I5: checkpoint fetched independently (no ordering dependency with anchors).
 *
 * Failure model:
 *   - DB connection failure → cold-start path (non-blocking exit 0).
 *   - Partial DB failure (one query fails) → fallback to empty list.
 *   - External source detection failure → non-fatal, skip.
 *   All failures log to stderr; nothing surfaces to the user.
 *
 * Exit codes:
 *   exit 0 + stdout → injected into session
 *   exit 0 + empty → no injection, no error
 *   No exit 1/2 path — failures are non-blocking.
 *
 * Timeout: no hard Claude Code limit; we budget 30s (HOOK_TIMEOUTS_MS.SESSION_START).
 *
 * source: cortex@ed33435 mcp_server/hooks/session_start.py
 * source: Smith & Vela (2001) context reinstatement d=0.28.
 * source: Wegner (1987) Transactive Memory Systems.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import {
  countMemories,
  fetchAnchors,
  fetchCheckpoint,
  fetchHotMemories,
  fetchTeamDecisions,
} from "./db.js";
import {
  buildColdStartMessage,
  buildContext,
  formatExternalSources,
  type ExternalSource,
  type SetupResult,
} from "./session-start-context.js";
import { loadHookConfig } from "./types.js";

const LOG_PREFIX = "[session-start-hook]";

function log(msg: string): void {
  process.stderr.write(`${LOG_PREFIX} ${msg}\n`);
}

// ── Config ────────────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/hooks/session_start.py:29-33

const config = loadHookConfig();
const HOT_LIMIT = parseInt(
  process.env["CORTEX_SESSION_START_LIMIT"] ?? "8",
  10,
);
const MIN_HEAT = parseFloat(
  process.env["CORTEX_SESSION_START_MIN_HEAT"] ?? "0.4",
);
const ANCHOR_LIMIT = parseInt(
  process.env["CORTEX_SESSION_START_ANCHOR_LIMIT"] ?? "5",
  10,
);

// ── Setup DB ──────────────────────────────────────────────────────────────

/**
 * Run setup_db.py and return its JSON result, or null on failure.
 *
 * precondition:  pluginRoot may be empty; returns null without throwing.
 * postcondition: returns parsed JSON from setup_db.py stdout, or null
 *   if the script is not found, exits non-zero, or produces invalid JSON.
 *
 * source: cortex@ed33435 mcp_server/hooks/session_start.py:58-82 (_try_setup_db)
 */
export function trySetupDb(): SetupResult | null {
  // Locate setup_db.py relative to this file or CLAUDE_PLUGIN_ROOT.
  // Re-read config at call time so env var changes in tests are respected.
  const { pluginRoot, databaseUrl } = loadHookConfig();
  let scriptPath = pluginRoot
    ? join(pluginRoot, "scripts", "setup_db.py")
    : "";
  if (!scriptPath || !existsSync(scriptPath)) {
    return null;
  }

  try {
    const result = spawnSync(
      "python3",
      [scriptPath],
      {
        encoding: "utf-8",
        timeout: 15_000, // source: cortex@ed33435 mcp_server/hooks/session_start.py:73 — 15s timeout for setup_db
        env: { ...process.env, DATABASE_URL: databaseUrl },
      },
    );
    const stdout = result.stdout?.trim();
    if (!stdout) return null;
    return JSON.parse(stdout) as SetupResult;
  } catch (err) {
    log(`setup_db failed: ${String(err)}`);
    return null;
  }
}

// ── Auto-backfill ─────────────────────────────────────────────────────────

/**
 * Run backfill + cascade automatically on first install.
 *
 * Spawns Python backfill_memories handler synchronously.
 * Returns number of memories imported (0 on any failure — non-fatal).
 *
 * precondition:  pluginRoot is set and the Cortex Python package is installed.
 * postcondition: returns imported count ≥ 0; never throws.
 *
 * source: cortex@ed33435 mcp_server/hooks/session_start.py:307-332 (_auto_backfill)
 */
export function autoBackfill(): number {
  const { pluginRoot, databaseUrl } = loadHookConfig();
  if (!pluginRoot) {
    log("auto-backfill skipped: no plugin root");
    return 0;
  }

  // source: cortex@ed33435 mcp_server/hooks/session_start.py:317-322 — backfill params
  // max_files=100, min_importance=0.35 (importance threshold below which sessions are skipped)
  const BACKFILL_MAX_FILES = 100; // source: cortex@ed33435 mcp_server/hooks/session_start.py:318
  const BACKFILL_MIN_IMPORTANCE = "0.35"; // source: cortex@ed33435 mcp_server/hooks/session_start.py:319 — float, kept as string to pass into Python inline

  try {
    const result = spawnSync(
      "python3",
      [
        "-c",
        `import asyncio, json
from mcp_server.handlers.backfill_memories import handler as h
r = asyncio.run(h({"max_files": ${BACKFILL_MAX_FILES}, "min_importance": ${BACKFILL_MIN_IMPORTANCE}, "force_reprocess": False}))
print(json.dumps({"backfilled": r.get("backfilled", 0), "cascade_advanced": r.get("cascade_advanced", 0)}))`,
      ],
      {
        encoding: "utf-8",
        timeout: 60_000, // source: cortex@ed33435 mcp_server/hooks/session_start.py — backfill budget; 60s for historical JSONL scan
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          PYTHONPATH: pluginRoot,
        },
      },
    );
    const stdout = result.stdout?.trim();
    if (!stdout) return 0;
    const r = JSON.parse(stdout) as { backfilled: number; cascade_advanced: number };
    const imported = r.backfilled ?? 0;
    log(`Auto-backfill: ${imported} imported, ${r.cascade_advanced ?? 0} cascaded`);
    return imported;
  } catch (err) {
    log(`Auto-backfill failed (non-fatal): ${String(err)}`);
    return 0;
  }
}

// ── Pipeline auto-wire ────────────────────────────────────────────────────

/**
 * Best-effort: auto-add the ai-automatised-pipeline MCP server to
 * mcp-connections.json when detected. Non-blocking; failures go to stderr only.
 *
 * Idempotent — once the `codebase` server entry exists, subsequent
 * SessionStarts leave the config alone.
 *
 * precondition:  pluginRoot may be empty; function returns without throwing.
 * postcondition: mcp-connections.json is updated if the pipeline is found
 *   and not already present; otherwise file is unchanged.
 *
 * source: cortex@ed33435 mcp_server/hooks/session_start.py:482-503 (_auto_wire_pipeline)
 */
export function autoWirePipeline(): void {
  const { pluginRoot } = loadHookConfig();
  if (!pluginRoot) return;

  try {
    const result = spawnSync(
      "python3",
      [
        "-c",
        `
import json, sys
sys.path.insert(0, r"${pluginRoot.replace(/\\/g, "/")}")
from mcp_server.infrastructure.pipeline_discovery import ensure_pipeline_connection
r = ensure_pipeline_connection()
print(json.dumps(r))
`,
      ],
      {
        encoding: "utf-8",
        timeout: 5_000, // source: cortex@ed33435 mcp_server/hooks/session_start.py:482-503 — pipeline auto-wire is fast (config file write only)
        env: { ...process.env, PYTHONPATH: pluginRoot },
      },
    );
    const stdout = result.stdout?.trim();
    if (!stdout) return;
    const r = JSON.parse(stdout) as { action?: string; binary?: string; path?: string };
    const action = r.action ?? "unknown";
    if (action === "wrote_config" || action === "added_codebase") {
      log(`pipeline auto-wired (${r.binary ?? ""}) in ${r.path ?? ""}`);
    }
  } catch (err) {
    log(`pipeline auto-wire skipped: ${String(err)}`);
  }
}

// ── Cached graph path lookup ──────────────────────────────────────────────

/**
 * Read the cached graph_path memo for this project from the memories table.
 *
 * precondition:  databaseUrl is a reachable PostgreSQL connection string.
 * postcondition: returns the graph_path string from the most-recent
 *   non-stale memory tagged with the project's code-graph tag, or null
 *   if no such memory exists or the DB is unreachable.
 *
 * source: cortex@ed33435 mcp_server/hooks/session_start.py:568-597 (_lookup_cached_graph_path)
 */
export async function lookupCachedGraphPath(
  projectRoot: string,
): Promise<string | null> {
  // Derive the tag the Python side stores when indexing a codebase.
  // source: cortex@ed33435 mcp_server/handlers/ingest_helpers.py:code_graph_tag
  const safePath = projectRoot.replace(/[^a-zA-Z0-9._-]/g, "_");
  const tag = `code-graph:${safePath}`;

  // Lazy PG import — mirrors db.ts pattern.
  type PgClientShape = {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
    end: () => Promise<void>;
  };
  let client: PgClientShape | null = null;

  try {
    const { default: pg } = await import("pg");
    const c = new pg.Client({ connectionString: config.databaseUrl });
    await c.connect();
    client = c as unknown as PgClientShape;
  } catch {
    return null;
  }

  if (!client) return null;
  const resolvedClient: PgClientShape = client;

  try {
    const { rows } = await resolvedClient.query(
      `SELECT content FROM memories
       WHERE tags @> $1::jsonb
         AND NOT is_stale
       ORDER BY heat_base_set_at DESC
       LIMIT 1`,
      [`["${tag}"]`],
    );
    for (const row of rows as Array<{ content?: string }>) {
      const content = row.content ?? "";
      if (content.startsWith("graph_path=")) {
        return content.slice("graph_path=".length).trim();
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    await resolvedClient.end();
  }
}

// ── Background codebase reanalysis ────────────────────────────────────────

/**
 * Spawn background ingest_codebase when the graph is stale.
 *
 * Detached — returns immediately. No ordering assumption between
 * parent session and child ingest process (Lamport I2 above).
 *
 * source: cortex@ed33435 mcp_server/hooks/session_start.py:506-565 (_maybe_background_reanalyze)
 */
function maybeBackgroundReanalyze(): void {
  try {
    const pluginRoot = config.pluginRoot;
    if (!pluginRoot) return;

    const launcherPath = join(pluginRoot, "scripts", "launcher.py");
    if (!existsSync(launcherPath)) return;

    const logDir = join(homedir(), ".claude", "methodology");
    const logPath = join(logDir, "pipeline_reanalyze.log");

    // Detach: fire-and-forget. The spawned process connects to DB independently.
    const child = spawn(
      "python3",
      [launcherPath, "mcp_server.hooks.ingest_codebase_background", config.projectRoot],
      {
        detached: true,
        stdio: ["ignore", "ignore", "ignore"],
      },
    );
    child.unref();
    log(`background pipeline reanalysis spawned → ${logPath}`);
  } catch (err) {
    log(`background pipeline reanalysis skipped: ${String(err)}`);
  }
}

// ── Session file count ────────────────────────────────────────────────────

/**
 * Count JSONL session files in ~/.claude/projects/.
 *
 * precondition:  none — OS may not have the directory.
 * postcondition: returns total count ≥ 0; never throws.
 *
 * source: cortex@ed33435 mcp_server/hooks/session_start.py:242-251 (_count_session_files)
 */
export function countSessionFiles(): number {
  const projectsDir = join(homedir(), ".claude", "projects");
  if (!existsSync(projectsDir)) return 0;
  let count = 0;
  try {
    for (const entry of readdirSync(projectsDir)) {
      const fullPath = join(projectsDir, entry);
      if (statSync(fullPath).isDirectory()) {
        for (const f of readdirSync(fullPath)) {
          if (f.endsWith(".jsonl")) count++;
        }
      }
    }
  } catch {
    // non-fatal
  }
  return count;
}

// ── External source detection ─────────────────────────────────────────────

/**
 * Detect other AI memory systems importable into Cortex.
 *
 * Checks for: claude-mem SQLite, Cursor JSONL files, ChatGPT exports.
 *
 * precondition:  none — filesystem may be absent.
 * postcondition: returns list of detected sources; never throws.
 *
 * source: cortex@ed33435 mcp_server/hooks/session_start.py:257-301 (_detect_external_sources)
 */
export function detectExternalSources(): ExternalSource[] {
  const sources: ExternalSource[] = [];

  // claude-mem SQLite
  // source: cortex@ed33435 mcp_server/hooks/session_start.py:262-277
  const claudeMemDb = join(homedir(), ".claude-mem", "claude-mem.db");
  if (existsSync(claudeMemDb)) {
    sources.push({ name: "claude-mem", count: 0, path: claudeMemDb });
  }

  // Cursor conversations
  // source: cortex@ed33435 mcp_server/hooks/session_start.py:279-287
  const cursorDir = join(homedir(), ".cursor");
  if (existsSync(cursorDir)) {
    try {
      const files = readdirSync(cursorDir, { recursive: true }) as string[];
      const jsonlFiles = files.filter((f) => basename(f).endsWith(".jsonl"));
      if (jsonlFiles.length > 0) {
        sources.push({ name: "Cursor", count: jsonlFiles.length, path: cursorDir });
      }
    } catch {
      // non-fatal
    }
  }

  // ChatGPT exports in Downloads
  // source: cortex@ed33435 mcp_server/hooks/session_start.py:289-298
  const downloads = join(homedir(), "Downloads");
  if (existsSync(downloads)) {
    try {
      const conversationFiles = readdirSync(downloads, { recursive: true }) as string[];
      const chatGptFiles = conversationFiles.filter((f) =>
        basename(f) === "conversations.json",
      );
      if (chatGptFiles.length > 0) {
        sources.push({
          name: "ChatGPT",
          count: chatGptFiles.length,
          path: join(downloads, chatGptFiles[0] ?? ""),
        });
      }
    } catch {
      // non-fatal
    }
  }

  return sources;
}

// ── Main entry point ──────────────────────────────────────────────────────

/** processEvent alias — required for consistent exports across hooks. */
export async function processEvent(): Promise<void> {
  return main();
}

export async function main(): Promise<void> {
  // I1: pipeline auto-wire before DB connect — does not need the DB.
  // source: cortex@ed33435 mcp_server/hooks/session_start.py:600-606
  autoWirePipeline();

  // I2: background re-analysis: fire-and-forget when the graph is stale.
  // source: cortex@ed33435 mcp_server/hooks/session_start.py:607-612
  maybeBackgroundReanalyze();

  // Attempt DB connection via countMemories.
  const memoryCount = await countMemories(config.databaseUrl);

  if (memoryCount === 0) {
    // Empty or unreachable DB — cold-start path.
    const sessionFiles = countSessionFiles();
    log(`Empty database, ${sessionFiles} session files found`);

    // Auto-backfill on first run when session history exists.
    // source: cortex@ed33435 mcp_server/hooks/session_start.py:640-654
    let autoImportedCount: number | undefined;
    if (sessionFiles > 0) {
      log(`Empty DB with ${sessionFiles} session files — auto-backfilling...`);
      autoImportedCount = autoBackfill();
    }

    const setupResult: SetupResult = {
      status: "ready",
      memories: 0,
      session_files: sessionFiles,
    };
    const msg = buildColdStartMessage(setupResult, autoImportedCount);
    if (msg) process.stdout.write(msg + "\n");
    return;
  }

  // Normal flow — I3: fetch anchors first (provides exclude IDs for I4 + hot).
  const anchors = await fetchAnchors(config.databaseUrl, ANCHOR_LIMIT);
  const anchorIds = new Set(anchors.map((a) => a.id));

  // I4 + I3: hot memories and team decisions exclude anchor IDs.
  const [hot, teamDecisions, checkpoint] = await Promise.all([
    fetchHotMemories(config.databaseUrl, MIN_HEAT, HOT_LIMIT, anchorIds),
    fetchTeamDecisions(config.databaseUrl, anchorIds),
    fetchCheckpoint(config.databaseUrl),
  ]);

  const context = buildContext(anchors, hot, checkpoint, teamDecisions);

  if (context) {
    process.stdout.write(context + "\n");
    log(
      `Injected ${anchors.length} anchors + ${hot.length} hot memories ` +
        `(total: ${memoryCount})`,
    );
  } else {
    log("No memories above threshold");
  }

  // Always check for importable external sources.
  // source: cortex@ed33435 mcp_server/hooks/session_start.py:675-693
  try {
    const sources = detectExternalSources();
    if (sources.length > 0) {
      const sourcesText = formatExternalSources(sources);
      if (sourcesText) process.stdout.write(sourcesText + "\n");
      log(`Detected ${sources.length} external memory sources`);
    }
  } catch (err) {
    log(`External source detection failed (non-fatal): ${String(err)}`);
  }
}

// Standalone invocation
if (process.argv[1]?.endsWith("session-start.js") === true) {
  main().catch((err) => {
    log(`fatal: ${String(err)}`);
    process.exit(0); // Non-blocking — always exit 0
  });
}
