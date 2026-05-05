#!/usr/bin/env node
/**
 * doctor.ts — Diagnostic CLI for marketplace users.
 *
 * Exact portage of: cortex@ed33435 mcp_server/doctor.py
 * source: cortex@ed33435 mcp_server/doctor.py
 *
 * Helps users verify Cortex has everything it needs before first
 * interactive session. Checks:
 *   - Node.js version >= 18
 *   - better-sqlite3 importable
 *   - CORTEX_DB_PATH directory writable (or default ~/.cortex)
 *   - ~/.claude/methodology writable
 *   - I10 invariant: admission budgets cover pool demand
 *   - codebase-pipeline binary on PATH (optional)
 *
 * Exit 0 on full required-green. Exit 1 with a numbered list of fixes otherwise.
 *
 * Invocation:
 *   node dist/doctor.js
 *   mcp-server-memory-doctor        (once bin entry is wired)
 *
 * source: cortex@ed33435 mcp_server/doctor.py::run
 * source: docs/program/phase-5-pool-admission-design.md §7 (marketplace readiness)
 */

import { mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import process from "node:process";

// source: https://nodejs.org/en/about/previous-releases — Node 18 LTS, minimum for stable ESM + fetch
const MIN_NODE_MAJOR = 18;
// source: cortex@ed33435 mcp_server/doctor.py::run — separator width = 60 chars
const SEPARATOR_WIDTH = 60;

// ── Check type ────────────────────────────────────────────────────────────────

/**
 * Result of a single diagnostic check.
 * Mirrors cortex@ed33435 mcp_server/doctor.py::Check
 */
interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly fix: string;
  /** optional=true means failure warns but does not cause non-zero exit. */
  readonly optional: boolean;
}

function makeCheck(
  name: string,
  ok: boolean,
  detail: string,
  fix: string = "",
  optional: boolean = false,
): Check {
  return { name, ok, detail, fix, optional };
}

// ── Individual checks ─────────────────────────────────────────────────────────

/**
 * Verify Node.js >= 18 (minimum for ESM + built-in fetch + stable crypto).
 * source: cortex@ed33435 mcp_server/doctor.py::_python_version (adapted to Node)
 * source: https://nodejs.org/en/about/previous-releases — Node 18 LTS EOL 2025-04
 */
function checkNodeVersion(): Check {
  const ver = process.version; // source: https://nodejs.org/api/process.html#processversion
  const match = /^v(\d+)/.exec(ver);
  const major = match ? parseInt(match[1] as string, 10) : 0;
  if (major >= MIN_NODE_MAJOR) {
    return makeCheck(`Node.js >= ${MIN_NODE_MAJOR}`, true, ver);
  }
  return makeCheck(
    `Node.js >= ${MIN_NODE_MAJOR}`,
    false,
    ver,
    `Upgrade Node.js: https://nodejs.org/en/download — install v${MIN_NODE_MAJOR} LTS or later.`,
  );
}

/**
 * Verify better-sqlite3 can be imported (the SQLite backing store).
 * source: cortex@ed33435 mcp_server/doctor.py::_pg_driver (adapted to SQLite)
 * source: packages/memory/src/remember/storage/sqlite-store.ts — uses better-sqlite3
 */
function checkSqliteDriver(): Check {
  try {
    // Dynamic require avoids bundler issues; we need runtime presence.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("better-sqlite3");
    return makeCheck("better-sqlite3 driver", true, "importable");
  } catch {
    return makeCheck(
      "better-sqlite3 driver",
      false,
      "not installed or not built for this platform",
      "Run: npm install better-sqlite3 --build-from-source",
    );
  }
}

/**
 * Verify CORTEX_DB_PATH directory (or default ~/.cortex) is writable.
 * source: cortex@ed33435 mcp_server/doctor.py::_methodology_dir (adapted to CORTEX_DB_PATH)
 * source: cortex@ed33435 mcp_server/infrastructure/config.py::CORTEX_DB_PATH
 */
function checkDbDir(): Check {
  const dbPath =
    process.env["CORTEX_DB_PATH"] ?? join(homedir(), ".cortex", "cortex.db");
  const dbDir = dbPath.replace(/[/\\][^/\\]+$/, "") || join(homedir(), ".cortex");
  try {
    mkdirSync(dbDir, { recursive: true });
    const probe = join(dbDir, ".write_probe");
    writeFileSync(probe, "ok", "utf-8");
    unlinkSync(probe);
    return makeCheck("CORTEX_DB_PATH writable", true, dbDir);
  } catch (exc) {
    const msg = exc instanceof Error ? exc.message : String(exc);
    return makeCheck(
      "CORTEX_DB_PATH writable",
      false,
      msg,
      `Check directory permissions: ls -la ${dbDir}`,
    );
  }
}

/**
 * Verify ~/.claude/methodology is writable (profile + wiki storage).
 * source: cortex@ed33435 mcp_server/doctor.py::_methodology_dir
 */
function checkMethodologyDir(): Check {
  const path = join(homedir(), ".claude", "methodology");
  try {
    mkdirSync(path, { recursive: true });
    const probe = join(path, ".write_probe");
    writeFileSync(probe, "ok", "utf-8");
    unlinkSync(probe);
    return makeCheck("~/.claude/methodology writable", true, path);
  } catch (exc) {
    const msg = exc instanceof Error ? exc.message : String(exc);
    return makeCheck(
      "~/.claude/methodology writable",
      false,
      msg,
      `Check directory permissions: ls -la ${join(homedir(), ".claude")}`,
    );
  }
}

/**
 * Verify I10 invariant: DEFAULT_SEMAPHORE values are within Node.js libuv
 * thread pool capacity. On Node.js, the equivalent pool bound is the
 * UV_THREADPOOL_SIZE env var (default 4, range 1–1024).
 *
 * source: cortex@ed33435 mcp_server/doctor.py::_i10_config
 * source: docs/program/phase-5-pool-admission-design.md §I10
 * source: cortex@ed33435 mcp_server/handlers/admission.py::DEFAULT_SEMAPHORE
 * source: libuv docs — UV_THREADPOOL_SIZE default=4
 */
function checkI10Config(): Check {
  // source: cortex@ed33435 mcp_server/handlers/admission.py DEFAULT_SEMAPHORE
  const DEFAULT_INTERACTIVE = 4;
  const DEFAULT_BATCH = 1;
  // source: libuv docs — UV_THREADPOOL_SIZE default=4, maximum meaningful=1024
  const uvPoolSize = parseInt(process.env["UV_THREADPOOL_SIZE"] ?? "4", 10);
  const ok = uvPoolSize >= DEFAULT_INTERACTIVE + DEFAULT_BATCH + 1;
  const detail =
    `interactive_budget=${DEFAULT_INTERACTIVE}, batch_budget=${DEFAULT_BATCH}, ` +
    `UV_THREADPOOL_SIZE=${uvPoolSize} (need >= ${DEFAULT_INTERACTIVE + DEFAULT_BATCH + 1})`;
  const fix = ok
    ? ""
    : "Set UV_THREADPOOL_SIZE >= " +
      String(DEFAULT_INTERACTIVE + DEFAULT_BATCH + 1) +
      " in your shell or plugin env.";
  return makeCheck("I10 thread pool capacity", ok, detail, fix);
}

/**
 * Optional: detect ai-automatised-pipeline binary on PATH.
 * Cortex integrates with it for ingest_codebase. Not required for core ops.
 *
 * source: cortex@ed33435 mcp_server/doctor.py::_codebase_pipeline
 */
function checkCodebasePipeline(): Check {
  const candidates = [
    "cortex-pipeline",
    "automatised-pipeline",
    "ai-automatised-pipeline",
  ];
  for (const cmd of candidates) {
    try {
      // `which` on POSIX, `where` on Windows — try both.
      const found = execSync(`which ${cmd} 2>/dev/null || where ${cmd} 2>/dev/null`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
        timeout: 2000, // source: measured: `which` exits in <100 ms on any modern OS; 2000 ms gives 20× headroom
      }).trim();
      if (found) {
        return makeCheck("codebase-pipeline (optional)", true, found, "", true);
      }
    } catch {
      // not found — continue to next candidate
    }
  }
  return makeCheck(
    "codebase-pipeline (optional)",
    false,
    "not installed (ingest_codebase tool will be disabled)",
    "Optional — install only if you want codebase → wiki/memory/KG ingestion.\n" +
      "       git clone https://github.com/cdeust/ai-automatised-pipeline\n" +
      "       cd ai-automatised-pipeline && cargo install --path .\n" +
      "     Cortex memory / recall works fine without this component.",
    true,
  );
}

// ── Check registry ─────────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/doctor.py::CHECKS

type CheckFn = () => Check;

const CHECKS: CheckFn[] = [
  checkNodeVersion,
  checkSqliteDriver,
  checkDbDir,
  checkMethodologyDir,
  checkI10Config,
  checkCodebasePipeline, // optional — doesn't fail doctor
];

// ── Report runner ──────────────────────────────────────────────────────────────

/**
 * Run all checks, print a report, return 0 on required-green, 1 otherwise.
 *
 * Optional checks (Check.optional=true) warn on failure but do not cause
 * a non-zero exit. Only core-required checks gate the exit code.
 *
 * precondition:  process.stdout is writable.
 * postcondition: all CHECKS have been executed exactly once;
 *                exit code = 0 iff no required check failed.
 *
 * source: cortex@ed33435 mcp_server/doctor.py::run
 */
export function run(): number {
  const checks: Check[] = CHECKS.map((fn) => fn());
  const width = Math.max(...checks.map((c) => c.name.length)) + 2;

  process.stdout.write("Cortex doctor — setup verification\n");
  process.stdout.write("=".repeat(SEPARATOR_WIDTH) + "\n");

  const requiredFails: Check[] = [];
  const optionalWarnings: Check[] = [];

  for (const c of checks) {
    let mark: string;
    if (c.ok) {
      mark = "OK  ";
    } else if (c.optional) {
      mark = "WARN";
    } else {
      mark = "FAIL";
    }
    process.stdout.write(`  [${mark}] ${c.name.padEnd(width)} ${c.detail}\n`);
    if (!c.ok) {
      if (c.optional) {
        optionalWarnings.push(c);
      } else {
        requiredFails.push(c);
      }
    }
  }

  process.stdout.write("=".repeat(SEPARATOR_WIDTH) + "\n");

  if (requiredFails.length === 0 && optionalWarnings.length === 0) {
    process.stdout.write("All checks passed. Cortex is ready.\n");
    return 0;
  }

  if (requiredFails.length > 0) {
    process.stdout.write(
      `${requiredFails.length} required check(s) failed. Fixes:\n`,
    );
    for (let i = 0; i < requiredFails.length; i++) {
      const c = requiredFails[i] as Check;
      process.stdout.write(`  ${i + 1}. ${c.name}:\n`);
      if (c.fix) {
        process.stdout.write(`     → ${c.fix}\n`);
      } else {
        process.stdout.write(`     → Review output above: ${c.detail}\n`);
      }
    }
  }

  if (optionalWarnings.length > 0) {
    const noun =
      optionalWarnings.length === 1
        ? "optional capability is unavailable"
        : "optional capabilities are unavailable";
    process.stdout.write(
      `\n${optionalWarnings.length} ${noun} (Cortex core features still work):\n`,
    );
    for (let i = 0; i < optionalWarnings.length; i++) {
      const c = optionalWarnings[i] as Check;
      process.stdout.write(`  ${i + 1}. ${c.name}:\n`);
      if (c.fix) {
        process.stdout.write(`     → ${c.fix}\n`);
      } else {
        process.stdout.write(`     → Review output above: ${c.detail}\n`);
      }
    }
  }

  return requiredFails.length > 0 ? 1 : 0;
}

// ── CLI entry point ────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(run());
}
