/**
 * Background codebase ingestion worker.
 *
 * NOT a Claude Code lifecycle hook — spawned as a detached subprocess
 * by session-start.ts when the cached codebase graph is stale or missing.
 *
 * Invocation:
 *   node packages/memory/dist/hooks/ingest-codebase-background.js /path/to/project
 *
 * Happens-before contract (Lamport 1978, §2):
 *   I1: spawned by session-start.ts BEFORE the parent connects to the DB
 *       (see session-start.ts I2). The parent and this child are independent
 *       processes. No ordering assumption between them after spawn.
 *   I2: this process reads project_root from argv[1] — causally after spawn.
 *   I3: ingest_codebase handler writes to the DB independently of the
 *       parent session. There is no distributed-snapshot guarantee between
 *       the ingest write and the parent's memory reads. The next session
 *       will see a consistent state because the graph write is transactional.
 *       WITHIN this session, the parent may see a stale graph — this is
 *       accepted and documented in the Python source ("next session sees a
 *       fresh graph"). This is NOT a correctness violation; it is an
 *       explicit design choice to prioritise non-blocking session start.
 *
 * Exit codes:
 *   0 → success
 *   1 → recoverable error (ingest failed but process launched)
 *   2 → fatal error (no project_root argument)
 */

const LOG_PREFIX = "[bg-ingest]";

function log(msg: string): void {
  process.stdout.write(`${LOG_PREFIX} ${msg}\n`);
}

function logErr(msg: string): void {
  process.stderr.write(`${LOG_PREFIX} ${msg}\n`);
}

export async function main(): Promise<void> {
  const projectRoot = process.argv[2];
  if (!projectRoot) {
    logErr(
      "Usage: node ingest-codebase-background.js <project_root>",
    );
    process.exit(2);
  }

  // Lazy import — handler may not be available during first-install bootstrapping.
  // Once packages/memory/src/codebase-analysis/ is merged (merge order #5),
  // wire to that package's ingestCodebase handler.
  // The dynamic import path is intentionally a string expression to avoid
  // TypeScript resolving a not-yet-merged package at compile time.
  type HandlerFn = (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  let handler: HandlerFn;
  try {
    const modPath = "@agentic/memory/codebase-analysis";
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const mod = await import(/* @vite-ignore */ modPath).catch(() => null) as Record<string, unknown> | null;
    if (!mod) {
      logErr("ingest_codebase import failed: @agentic/memory/codebase-analysis not yet merged");
      process.exit(1);
    }
    handler = mod["ingestCodebase"] as HandlerFn;
  } catch (err) {
    logErr(`ingest_codebase import failed: ${String(err)}`);
    process.exit(1);
  }

  let result: Record<string, unknown>;
  try {
    result = await handler({ project_path: projectRoot });
  } catch (err) {
    logErr(`handler crashed: ${String(err)}`);
    process.exit(1);
  }

  if (result["error"]) {
    logErr(`handler returned error: ${String(result["error"])}`);
    process.exit(1);
  }

  const counts = Object.fromEntries(
    Object.entries(result).filter(([, v]) => typeof v === "number"),
  );
  log(`ingest_codebase ok: ${JSON.stringify(counts)}`);
  process.exit(0);
}

if (process.argv[1]?.endsWith("ingest-codebase-background.js") === true) {
  main().catch((err) => {
    process.stderr.write(`${LOG_PREFIX} fatal: ${String(err)}\n`);
    process.exit(1);
  });
}
