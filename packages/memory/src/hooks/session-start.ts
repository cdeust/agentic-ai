/**
 * SessionStart hook — inject memory context at session start.
 *
 * Claude Code fires this once per session, before any UserPromptSubmit.
 * This hook connects to PostgreSQL and prints a Markdown context block
 * to stdout. Claude Code injects stdout into the context window.
 *
 * Happens-before invariants (Lamport 1978, §2):
 *   I1: pipeline auto-wire fires BEFORE the DB connection attempt,
 *       because the spawn itself does not need the DB.
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
 * source: Smith & Vela (2001) context reinstatement d=0.28.
 * source: Wegner (1987) Transactive Memory Systems.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
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

// ── Background codebase reanalysis ────────────────────────────────────────

/**
 * Spawn background ingest_codebase when the graph is stale.
 *
 * Detached — returns immediately. No ordering assumption between
 * parent session and child ingest process (Lamport I2 above).
 *
 * ADR-0010: uses bare ${CLAUDE_PLUGIN_ROOT} form ONLY, never :-fallback.
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

function countSessionFiles(): number {
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

function detectExternalSources(): ExternalSource[] {
  const sources: ExternalSource[] = [];

  // claude-mem SQLite
  const claudeMemDb = join(homedir(), ".claude-mem", "claude-mem.db");
  if (existsSync(claudeMemDb)) {
    sources.push({ name: "claude-mem", count: 0, path: claudeMemDb });
  }

  // Cursor conversations
  const cursorDir = join(homedir(), ".cursor");
  if (existsSync(cursorDir)) {
    try {
      const files = readdirSync(cursorDir, { recursive: true }) as string[];
      const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));
      if (jsonlFiles.length > 0) {
        sources.push({ name: "Cursor", count: jsonlFiles.length, path: cursorDir });
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
  // I1: pipeline auto-wire before DB connect (fire-and-forget, no dep on DB)
  maybeBackgroundReanalyze();

  // Attempt DB connection
  const memoryCount = await countMemories(config.databaseUrl);

  if (memoryCount === 0) {
    // Empty or unreachable DB — cold-start path
    const sessionFiles = countSessionFiles();
    log(`Empty database, ${sessionFiles} session files found`);

    const setupResult: SetupResult = {
      status: "ready",
      memories: 0,
      session_files: sessionFiles,
    };
    const msg = buildColdStartMessage(setupResult);
    if (msg) process.stdout.write(msg + "\n");
    return;
  }

  // Normal flow — I3: fetch anchors first (provides exclude IDs for I4 + hot)
  const anchors = await fetchAnchors(config.databaseUrl, ANCHOR_LIMIT);
  const anchorIds = new Set(anchors.map((a) => a.id));

  // I4 + I3: hot memories and team decisions exclude anchor IDs
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

  // Always check for importable external sources
  const sources = detectExternalSources();
  if (sources.length > 0) {
    const sourcesText = formatExternalSources(sources);
    if (sourcesText) process.stdout.write(sourcesText + "\n");
    log(`Detected ${sources.length} external memory sources`);
  }
}

// Standalone invocation
if (process.argv[1]?.endsWith("session-start.js") === true) {
  main().catch((err) => {
    log(`fatal: ${String(err)}`);
    process.exit(0); // Non-blocking — always exit 0
  });
}
