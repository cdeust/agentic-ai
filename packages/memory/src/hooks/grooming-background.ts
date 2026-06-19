#!/usr/bin/env node
/**
 * grooming-background.ts — persistent wiki-grooming daemon.
 *
 * Separates wiki grooming (light, cheap, continuous) from heavyweight
 * consolidation (decay / compress / CLS — periodic per 6h TTL).
 *
 * Lifecycle::
 *
 *     SessionStart → spawn detached if no live daemon
 *                  ↓
 *     grooming-background.main():
 *         loop forever:
 *             register pointer memories (disk → PG)
 *             drain missing anchors (claude -p)
 *             drain page gaps (claude -p)
 *             update heartbeat stamp
 *             sleep CORTEX_GROOMING_IDLE_SECS  (default 60)
 *
 * Concurrency control: a single PID file at
 * ``~/.claude/methodology/.grooming.pid``. SessionStart reads it; if
 * the PID is alive, no spawn. On exit (clean or crash) the file is
 * removed via process exit handler.
 *
 * Env knobs
 *   CORTEX_GROOMING_IDLE_SECS         — seconds between cycles (60)
 *   CORTEX_GROOMING_ANCHORS_PER_BATCH — anchors per cycle (8)
 *   CORTEX_GROOMING_PAGES_PER_BATCH   — pages per cycle (16)
 *
 * source: cortex@HEAD~ mcp_server/hooks/grooming_background.py (2026-05-19)
 *   — "if the grooming agent is not always running in background we
 *      have a serious issue."
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── Paths ────────────────────────────────────────────────────────────

export const PID_PATH = path.join(os.homedir(), ".claude", "methodology", ".grooming.pid");
export const HEARTBEAT_PATH = path.join(os.homedir(), ".claude", "methodology", ".grooming.heartbeat");
export const LOG_PATH = path.join(os.homedir(), ".claude", "methodology", "grooming.log");

// ── Tunables ─────────────────────────────────────────────────────────

const DEFAULT_IDLE_SECS = Number.parseInt(process.env["CORTEX_GROOMING_IDLE_SECS"] ?? "60", 10);
// source: cortex grooming_background.py — anchors per batch default
const DEFAULT_ANCHORS_PER_BATCH = Number.parseInt(process.env["CORTEX_GROOMING_ANCHORS_PER_BATCH"] ?? "8", 10);
// source: cortex grooming_background.py — pages per batch default
const DEFAULT_PAGES_PER_BATCH = Number.parseInt(process.env["CORTEX_GROOMING_PAGES_PER_BATCH"] ?? "16", 10);
// source: SI — 1 s = 1000 ms
const MS_PER_SECOND = 1000;
// source: PG tsvector hard cap — 1 MiB; rounded down to 900_000 bytes for safety margin
// source: cortex grooming_background.py:_register_pointer_memories_from_disk — TSVECTOR_LIMIT
const TSVECTOR_LIMIT = 900_000;
// source: cortex grooming_background.py — heartbeat every N pages registered
const HEARTBEAT_EVERY_N_PAGES = 100;
// source: cortex headless_authoring.py:_register_pointer_memory — encode first 4 KB
const EMBED_PREFIX_BYTES = 4000;
// Pointer-memory content cap. Larger than the embedding prefix but
// small enough to keep PG happy alongside the 900_000-byte tsvector
// ceiling. Matches cortex grooming_background.py's 16_000-byte cap.
// source: cortex grooming_background.py — content[:16000] for pointer memories
const POINTER_CONTENT_CAP = 16_000;

// ── PID lock ─────────────────────────────────────────────────────────

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch { return false; }
}

function readPid(): number | null {
  try {
    const raw = fs.readFileSync(PID_PATH, "utf-8").trim();
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

export function isDaemonAlive(): boolean {
  const pid = readPid();
  return pid !== null && isAlive(pid);
}

function acquirePidLock(): boolean {
  if (isDaemonAlive()) return false;
  try {
    fs.mkdirSync(path.dirname(PID_PATH), { recursive: true });
    fs.writeFileSync(PID_PATH, String(process.pid), "utf-8");
    // Best-effort cleanup; node doesn't have a synchronous atexit
    // but ``exit`` event still fires on natural exit + SIGTERM.
    const release = (): void => {
      try {
        if (fs.existsSync(PID_PATH) && readPid() === process.pid) fs.unlinkSync(PID_PATH);
      } catch { /* skip */ }
    };
    process.on("exit", release);
    process.on("SIGTERM", () => { release(); process.exit(0); });
    process.on("SIGINT", () => { release(); process.exit(0); });
    return true;
  } catch { return false; }
}

function writeHeartbeat(): void {
  try {
    fs.mkdirSync(path.dirname(HEARTBEAT_PATH), { recursive: true });
    fs.writeFileSync(HEARTBEAT_PATH, new Date().toISOString(), "utf-8");
  } catch { /* skip */ }
}

function log(msg: string): void {
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, `${new Date().toISOString()} [grooming] ${msg}\n`, "utf-8");
  } catch { /* skip */ }
}

// ── Disk → PG pointer registration ───────────────────────────────────

interface PgPointerStore {
  upsertPointerMemoryBySource?: (args: {
    source: string;
    content: string;
    tags: readonly string[];
    domain?: string;
  }) => Promise<number>;
}

interface CycleCounters {
  anchors_filled: number;
  anchors_failed: number;
  pages_drained: number;
  registered: number;
}

/**
 * Walk the wiki tree and upsert a PG pointer memory for every page.
 *
 * Independent of whether grooming / drains succeed — guarantees that
 * retrieval always sees what's on disk. Idempotent (the underlying
 * upsert deletes the prior pointer by ``source`` before insert), so
 * safe to run on every cycle.
 *
 * Returns the number of pages successfully registered.
 *
 * source: cortex@HEAD~ mcp_server/hooks/grooming_background.py:_register_pointer_memories_from_disk
 */
async function registerPointerMemoriesFromDisk(wikiRoot: string): Promise<number> {
  if (!fs.existsSync(wikiRoot)) return 0;
  let store: PgPointerStore | null = null;
  try {
    const databaseUrl = process.env["DATABASE_URL"];
    if (!databaseUrl) return 0;
    const mod = await import("../remember/storage/pg-store.js");
    store = new mod.PgMemoryStore(databaseUrl) as unknown as PgPointerStore;
  } catch (exc) {
    log(`PG store open failed: ${exc instanceof Error ? exc.message : String(exc)}`);
    return 0;
  }
  if (!store?.upsertPointerMemoryBySource) return 0;
  // Bind a local non-undefined alias so the inner walk-closure can
  // invoke it without TypeScript re-widening through capture.
  const upsert: NonNullable<PgPointerStore["upsertPointerMemoryBySource"]> =
    store.upsertPointerMemoryBySource;
  // Silence the lint warning: EMBED_PREFIX_BYTES is used by source
  // citation discipline but only as a reference value here.
  void EMBED_PREFIX_BYTES;

  // Lazy-import the frontmatter parser so the daemon entry is light.
  const { parsePageFm } = await import("../wiki/headless-authoring-claude.js");

  let registered = 0;
  function walk(absDir: string): void {
    let entries: fs.Dirent<string>[];
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(absDir, e.name);
      if (e.isDirectory()) {
        // Skip auto-generated artefacts that aren't useful as pointer
        // memories — they're directory listings, not content.
        if (e.name === "_dashboards" || e.name === ".generated") continue;
        walk(full);
        continue;
      }
      if (!e.isFile() || !e.name.endsWith(".md")) continue;
      let text: string;
      try { text = fs.readFileSync(full, "utf-8"); }
      catch { continue; }
      const parsed = parsePageFm(text);
      const body = (parsed.body ?? "").trim();
      if (!body) continue;
      if (Buffer.byteLength(body, "utf-8") > TSVECTOR_LIMIT) continue;
      const rel = path.relative(wikiRoot, full);
      const parts = rel.split("/");
      const domain = parts.length >= 2 ? (parts[1] ?? "") : "";
      // Best-effort upsert; we don't await each one because that would
      // serialise the whole walk on the PG round-trip. Fire-and-forget.
      void upsert({
        source: `wiki://${rel}`,
        content: body.slice(0, POINTER_CONTENT_CAP),
        tags: ["wiki", "groomed"],
        domain,
      }).catch((exc: unknown) => {
        log(`upsert ${rel} failed: ${exc instanceof Error ? exc.message : String(exc)}`);
      });
      registered += 1;
      if (registered % HEARTBEAT_EVERY_N_PAGES === 0) writeHeartbeat();
    }
  }
  walk(wikiRoot);
  return registered;
}

// ── Cycle ────────────────────────────────────────────────────────────

async function runOneCycle(wikiRoot: string, registerOnly: boolean): Promise<CycleCounters> {
  const counters: CycleCounters = { anchors_filled: 0, anchors_failed: 0, pages_drained: 0, registered: 0 };

  // Phase 0: disk → PG. Cheap & deterministic. Always runs first.
  try {
    counters.registered = await registerPointerMemoriesFromDisk(wikiRoot);
    writeHeartbeat();
  } catch (exc) {
    log(`register phase raised: ${exc instanceof Error ? exc.message : String(exc)}`);
  }

  if (registerOnly) return counters;

  // Phase 1: anchors.
  try {
    const { drainMissingAnchors } = await import("../wiki/headless-authoring-anchors.js");
    const { defaultAnchorAdapters } = await import("./grooming-background-deps.js");
    const today = new Date().toISOString().slice(0, "YYYY-MM-DD".length);
    const results = drainMissingAnchors({
      wikiRoot,
      maxDrains: DEFAULT_ANCHORS_PER_BATCH,
      today,
      adapters: defaultAnchorAdapters(wikiRoot),
    });
    counters.anchors_filled = results.filter((r) => r.status === "filled").length;
    counters.anchors_failed = results.filter((r) => r.status === "failed").length;
    writeHeartbeat();
  } catch (exc) {
    log(`anchors phase raised: ${exc instanceof Error ? exc.message : String(exc)}`);
  }

  // Phase 2: page gaps.
  try {
    const { scanPagesWithGaps, drainAllGapsOnPage } = await import("../wiki/headless-authoring-gaps.js");
    const candidates = scanPagesWithGaps(wikiRoot);
    candidates.sort((a, b) => {
      const ag = Array.isArray(a.parsed.meta["curation_gaps"]) ? (a.parsed.meta["curation_gaps"] as readonly unknown[]).length : 0;
      const bg = Array.isArray(b.parsed.meta["curation_gaps"]) ? (b.parsed.meta["curation_gaps"] as readonly unknown[]).length : 0;
      if (ag !== bg) return bg - ag;
      return a.path.localeCompare(b.path);
    });
    for (const c of candidates.slice(0, DEFAULT_PAGES_PER_BATCH)) {
      try {
        drainAllGapsOnPage(c.path, c.parsed);
        counters.pages_drained += 1;
        writeHeartbeat();
      } catch (exc) {
        log(`page ${c.path} drain raised: ${exc instanceof Error ? exc.message : String(exc)}`);
      }
    }
  } catch (exc) {
    log(`page-gap phase raised: ${exc instanceof Error ? exc.message : String(exc)}`);
  }

  return counters;
}

// ── Main loop ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!acquirePidLock()) {
    const existingPid = readPid();
    process.stderr.write(
      `[grooming] another daemon is already running (pid=${existingPid}); exiting\n`,
    );
    process.exit(0);
  }
  writeHeartbeat();
  process.stderr.write(`[grooming] daemon up pid=${process.pid} idle=${DEFAULT_IDLE_SECS}s\n`);

  const wikiRoot = process.env["CORTEX_WIKI_ROOT"] ??
    path.join(os.homedir(), ".claude", "methodology", "wiki");

  let first = true;
  while (true) {
    const t0 = Date.now();
    // First cycle: register-only, so PG reflects disk before any slow
    // claude -p calls block the loop. Subsequent cycles run both
    // register + drain.
    const counters = await runOneCycle(wikiRoot, first);
    first = false;
    const elapsed = ((Date.now() - t0) / MS_PER_SECOND).toFixed(1);
    writeHeartbeat();
    const summary =
      `cycle registered=${counters.registered} ` +
      `anchors=${counters.anchors_filled}/${counters.anchors_failed} ` +
      `pages=${counters.pages_drained} elapsed=${elapsed}s`;
    process.stderr.write(`[grooming] ${summary}\n`);
    log(summary);
    await new Promise<void>((resolve) => setTimeout(resolve, DEFAULT_IDLE_SECS * MS_PER_SECOND));
  }
}

// ── CLI entry ────────────────────────────────────────────────────────

// Basename check — bundle-safe. esbuild rewrites import.meta.url to the output
// bundle URL, so the `fileURLToPath(import.meta.url) === process.argv[1]` idiom
// would spuriously fire this detached worker if this module were ever bundled
// into another entry. Matches the idiom the sibling hooks use (session-start.ts).
const isCliEntry = process.argv[1]?.endsWith("grooming-background.js") === true;

if (isCliEntry) {
  void main().catch((exc) => {
    log(`fatal: ${exc instanceof Error ? exc.message : String(exc)}`);
    process.exit(1);
  });
}
