#!/usr/bin/env node
/**
 * ingest-codebase-background.ts — Native TS detached worker that
 * invokes the codebase-analyze handler for a project (G11).
 *
 * Spawned by ``session-start.ts::maybeBackgroundReanalyze`` when the
 * cached graph is stale or missing. Replaces the previous Python-
 * module-by-literal-name spawn (cortex's ingest_codebase_background.py)
 * which silently no-op'd on installs without Cortex's Python.
 *
 * Invocation:
 *   node packages/memory/dist/hooks/ingest-codebase-background.js <project_root>
 *
 * Exit codes (mirror Cortex's worker):
 *   0  success
 *   1  recoverable error (logged; SessionStart loop continues)
 *   2  fatal error — no project_root argument
 *
 * Output: appended to ~/.claude/methodology/ingest_codebase_background.log
 * with ISO timestamps + ``[ingest-codebase-background]`` prefix.
 *
 * source: cortex/mcp_server/hooks/ingest_codebase_background.py
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MemoryStoreExt } from "../remember/storage/memory-store.js";

const LOG_PREFIX = "[ingest-codebase-background]";

function methodologyDir(): string {
  return join(homedir(), ".claude", "methodology");
}

function logPath(): string {
  return join(methodologyDir(), "ingest_codebase_background.log");
}

function appendLog(msg: string): void {
  try {
    const dir = methodologyDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(logPath(), `${new Date().toISOString()} ${msg}\n`, "utf-8");
  } catch {
    /* best effort */
  }
}

/**
 * Run one ingest-codebase pass for the given project root. Resolves
 * on completion; never throws (errors logged + exit code mapped).
 *
 * Backend selection mirrors packages/mcp-servers/memory/src/index.ts:
 *   DATABASE_URL set → PgMemoryStore
 *   otherwise        → SQLite at CORTEX_DB_PATH or ~/.cortex/cortex.db
 *
 * source: packages/memory/src/codebase-analysis/handlers/ingest-codebase.ts
 */
export async function runIngestCycle(projectRoot: string): Promise<number> {
  appendLog(`${LOG_PREFIX} cycle start: ${projectRoot}`);
  if (!projectRoot) {
    appendLog(`${LOG_PREFIX} fatal: missing project_root`);
    return 2;
  }

  let store: MemoryStoreExt;
  try {
    const databaseUrl = process.env["DATABASE_URL"];
    if (databaseUrl) {
      const { PgMemoryStore } = await import("../remember/storage/pg-store.js");
      store = new PgMemoryStore(databaseUrl);
      appendLog(`${LOG_PREFIX} PG store opened`);
    } else {
      const { SqliteMemoryStore } = await import("../remember/storage/sqlite-store.js");
      const dbPath = process.env["CORTEX_DB_PATH"] ??
        join(homedir(), ".cortex", "cortex.db");
      store = new SqliteMemoryStore(dbPath);
      appendLog(`${LOG_PREFIX} SQLite store opened at ${dbPath}`);
    }
  } catch (err) {
    appendLog(`${LOG_PREFIX} store open failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  // Default wiki root mirrors the rest of the codebase.
  const wikiRoot = process.env["CORTEX_WIKI_ROOT"] ??
    join(homedir(), ".claude", "methodology", "wiki");

  try {
    const { handler } = await import("../codebase-analysis/handlers/ingest-codebase.js");
    const result = await handler(
      { project_path: projectRoot },
      { store, wikiRoot, mcpClientPool: null },
    );
    if (result["error"]) {
      appendLog(`${LOG_PREFIX} handler returned error: ${String(result["error"])}`);
      return 1;
    }
    const counts: Record<string, number> = {};
    for (const [k, v] of Object.entries(result)) {
      if (typeof v === "number") counts[k] = v;
    }
    appendLog(`${LOG_PREFIX} ingest_codebase ok: ${JSON.stringify(counts)}`);
    return 0;
  } catch (err) {
    appendLog(`${LOG_PREFIX} handler crashed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

// ── CLI entry ────────────────────────────────────────────────────────

// Basename check — bundle-safe. esbuild rewrites import.meta.url to the output
// bundle URL, so the `fileURLToPath(import.meta.url) === process.argv[1]` idiom
// would spuriously fire this detached worker if this module were ever bundled
// into another entry. Matches the idiom the sibling hooks use (session-start.ts).
const isCliEntry = process.argv[1]?.endsWith("ingest-codebase-background.js") === true;

if (isCliEntry) {
  const projectRoot = process.argv[2] ?? "";
  void runIngestCycle(projectRoot).then((code) => process.exit(code));
}
