/**
 * PostToolUse hook — preemptive memory priming via file path.
 *
 * When an agent reads or edits a file, primes related memories by
 * boosting their heat. Implements "proactive brain" spreading activation
 * without writing to stdout (PostToolUse stdout is not shown to the model
 * per Claude Code lesson 10).
 *
 * Paper backing:
 *   - Bar (2007) "The proactive brain" (Trends in Cognitive Sciences):
 *     continuous top-down predictions pre-activate representations
 *     before bottom-up input arrives.
 *   - Collins & Loftus (1975): file path as cue node activates related
 *     memory nodes via spreading activation.
 *   - Smith & Vela (2001): context reinstatement d=0.28 (~15-20% boost).
 *
 * Happens-before contract (Lamport 1978, §2):
 *   I1: fires AFTER the file tool returns. The file_path in tool_input
 *       is causally committed before this hook sees it.
 *   I2: cooldown read MUST precede heat bump (prevents duplicate boosts).
 *       Cooldown uses wall-clock time as an approximation — this is safe
 *       because the cooldown is a performance optimization, not a
 *       correctness invariant. Clock skew within a single machine is
 *       bounded to microseconds, well within the 60s cooldown window.
 *   I3: heat bump MUST complete before cooldown write (ordering within
 *       this process; no distributed ordering claim).
 *   I4: no ordering with concurrent preemptive_context invocations for
 *       different files — they may interleave at the DB level. The DB
 *       UPDATE is idempotent within the LEAST(heat+boost, 1.0) bound.
 *
 * Wall-clock assumption explicitly stated (Lamport invariant check):
 *   Cooldown: _COOLDOWN_SECONDS = 60. Clock skew assumption: single-machine,
 *   monotone clock. process.hrtime() / Date.now() are monotone on Node ≥18
 *   on macOS/Linux. If the machine's clock is adjusted backward by more
 *   than 60s, the cooldown may fire early — acceptable for a performance
 *   optimization.
 *
 * Exit codes: always 0 (non-blocking per HOOKS.md Hook 7).
 * Timeout: non-blocking; no explicit budget.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bumpHeatByPath } from "./db.js";
import { loadHookConfig, type PostToolUseEvent } from "./types.js";

const LOG_PREFIX = "[cortex-preemptive]";
// source: Collins & Loftus (1975) — small boost to prime without dominating
const HEAT_BOOST = 0.1;
// Wall-clock cooldown — 60s per file. See I2 above for skew analysis.
const COOLDOWN_SECONDS = 60;
const COOLDOWN_FILE = join(tmpdir(), "cortex_preemptive_cooldown.json");

// Tools that indicate file interaction worth priming for
const FILE_TOOLS = new Set(["Edit", "Write", "Read"]);

function log(msg: string): void {
  process.stderr.write(`${LOG_PREFIX} ${msg}\n`);
}

// ── Cooldown management ───────────────────────────────────────────────────

function checkCooldown(filePath: string): boolean {
  try {
    if (existsSync(COOLDOWN_FILE)) {
      const data = JSON.parse(
        readFileSync(COOLDOWN_FILE, "utf-8"),
      ) as Record<string, number>;
      const lastTime = data[filePath] ?? 0;
      if (Date.now() / 1000 - lastTime < COOLDOWN_SECONDS) return true;
    }
  } catch {
    // non-fatal
  }
  return false;
}

function updateCooldown(filePath: string): void {
  try {
    let data: Record<string, number> = {};
    if (existsSync(COOLDOWN_FILE)) {
      data = JSON.parse(
        readFileSync(COOLDOWN_FILE, "utf-8"),
      ) as Record<string, number>;
    }
    data[filePath] = Date.now() / 1000;
    // Prune old entries (keep top 50 by recency)
    if (Object.keys(data).length > 50) {
      const sorted = Object.entries(data).sort(([, a], [, b]) => b - a);
      data = Object.fromEntries(sorted.slice(0, 50));
    }
    writeFileSync(COOLDOWN_FILE, JSON.stringify(data), "utf-8");
  } catch {
    // non-fatal
  }
}

// ── Main handler ──────────────────────────────────────────────────────────

export async function processEvent(event: PostToolUseEvent): Promise<void> {
  const toolName = event.tool_name ?? "";
  if (!FILE_TOOLS.has(toolName)) return;

  const toolInput = (event.tool_input ?? {}) as Record<string, unknown>;
  const filePath = String(toolInput["file_path"] ?? "");
  if (!filePath) return;

  // I2: cooldown check before DB operation
  if (checkCooldown(filePath)) return;

  const { databaseUrl } = loadHookConfig();
  const count = await bumpHeatByPath(databaseUrl, filePath, HEAT_BOOST);

  if (count > 0) {
    // I3: cooldown write after heat bump
    updateCooldown(filePath);
    const filename = filePath.split("/").pop() ?? filePath;
    log(`primed ${count} memories for ${filename}`);
  }
}

export async function main(): Promise<void> {
  if (process.stdin.isTTY) {
    process.exit(0);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) process.exit(0);

  let event: PostToolUseEvent;
  try {
    event = JSON.parse(raw) as PostToolUseEvent;
  } catch {
    process.exit(0);
  }

  await processEvent(event).catch(() => {});
  process.exit(0);
}

if (process.argv[1]?.endsWith("preemptive-context.js") === true) {
  main().catch(() => process.exit(0));
}
