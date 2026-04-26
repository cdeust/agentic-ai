/**
 * PostToolUse hook — pipeline-driven heat bump on file edits.
 *
 * When an agent edits or writes a file, queries the upstream
 * ai-automatised-pipeline's detect_changes tool to resolve which symbols
 * are impacted, then boosts heat on memories tagged with those symbols.
 * This is a precise, graph-based complement to preemptive-context.ts.
 *
 * Paper backing:
 *   - Collins & Loftus (1975): spreading activation on a structured graph.
 *     Symbol impact set is the activation neighbourhood.
 *   - Smith & Vela (2001): context reinstatement d=0.28.
 *
 * Coexistence with preemptive-context.ts:
 *   preemptive-context: path-based (broad), works without pipeline.
 *   pipeline-impact-bump: graph-based (precise), requires pipeline MCP.
 *   They compose — run both; each adds a complementary activation signal.
 *
 * Happens-before contract (Lamport 1978, §2):
 *   I1: fires AFTER Edit/Write/MultiEdit returns.
 *   I2: cooldown check BEFORE pipeline query (skip if already bumped recently).
 *   I3: pipeline detect_changes call completes BEFORE DB heat bump.
 *   I4: skips cleanly if pipeline MCP server is not installed
 *       (detect_changes import fails gracefully).
 *   I5: no ordering assumption with preemptive-context for the same
 *       file — both may execute concurrently at the DB level. The
 *       LEAST(heat+boost, 1.0) bound makes their composition idempotent.
 *
 * Wall-clock assumption (explicitly stated per Lamport discipline):
 *   Cooldown: COOLDOWN_SECONDS = 30. Same single-machine monotone-clock
 *   assumption as preemptive-context.ts. Failure mode: if clock jumps
 *   backward > 30s, cooldown fires early — acceptable for a perf opt.
 *
 * Exit codes: always 0.
 * Timeout: non-blocking; no explicit budget.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bumpHeatBySymbols } from "./db.js";
import { loadHookConfig, type PostToolUseEvent } from "./types.js";

const LOG_PREFIX = "[pipeline-impact-bump]";
const COOLDOWN_SECONDS = 30;
const COOLDOWN_FILE = join(tmpdir(), "cortex_pipeline_impact_cooldown.json");
const FILE_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);
// source: Collins & Loftus (1975) — graph precision earns slightly higher boost
const IMPACT_BOOST = 0.15;
const MAX_BUMPS = 20;

function log(msg: string): void {
  process.stderr.write(`${LOG_PREFIX} ${msg}\n`);
}

// ── Cooldown ──────────────────────────────────────────────────────────────

function checkCooldown(filePath: string): boolean {
  try {
    if (existsSync(COOLDOWN_FILE)) {
      const data = JSON.parse(
        readFileSync(COOLDOWN_FILE, "utf-8"),
      ) as Record<string, number>;
      const last = data[filePath] ?? 0;
      if (Date.now() / 1000 - last < COOLDOWN_SECONDS) return true;
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
    if (Object.keys(data).length > 50) {
      const sorted = Object.entries(data).sort(([, a], [, b]) => b - a);
      data = Object.fromEntries(sorted.slice(0, 50));
    }
    writeFileSync(COOLDOWN_FILE, JSON.stringify(data), "utf-8");
  } catch {
    // non-fatal
  }
}

// ── Pipeline symbol detection ─────────────────────────────────────────────

/**
 * Resolve impacted symbols for a file via the pipeline detect_changes tool.
 *
 * Returns [] if the pipeline is not installed (I4: skip gracefully).
 * The pipeline MCP call itself is async; we give it most of the PostToolUse
 * budget and let it timeout rather than block indefinitely.
 */
async function pipelineDetectChanges(
  projectRoot: string,
  filePath: string,
): Promise<string[]> {
  // Attempt dynamic import of pipeline helpers — fails gracefully if
  // the pipeline package is not installed (I4).
  let callUpstream: (
    server: string,
    tool: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
  let findCachedGraph: (projectRoot: string) => string | null;
  let normaliseMcpPayload: (payload: unknown) => unknown;

  try {
    // These helpers will exist once packages/codebase is merged (merge order #5)
    // Until then, we return [] gracefully.
    // The dynamic import path is a string expression to avoid TypeScript
    // resolving a not-yet-merged package at compile time.
    const modPath = "@agentic/codebase/ingest-helpers";
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const mod = await import(/* @vite-ignore */ modPath).catch(() => null) as Record<string, unknown> | null;
    if (!mod) return [];
    callUpstream = mod["callUpstream"] as typeof callUpstream;
    findCachedGraph = mod["findCachedGraph"] as typeof findCachedGraph;
    normaliseMcpPayload = mod["normaliseMcpPayload"] as typeof normaliseMcpPayload;
  } catch {
    return [];
  }

  const graphPath = findCachedGraph(projectRoot);
  if (!graphPath) return [];

  const diffText = `diff --git a/${filePath} b/${filePath}\n`;
  let payload: unknown;
  try {
    payload = await callUpstream("codebase", "detect_changes", {
      graph_path: graphPath,
      diff_text: diffText,
    });
  } catch (err) {
    log(`detect_changes failed: ${String(err)}`);
    return [];
  }

  const inner = normaliseMcpPayload(payload);
  if (!inner || typeof inner !== "object") return [];

  const impacted =
    (inner as Record<string, unknown>)["impacted_symbols"] ??
    (inner as Record<string, unknown>)["impacted"] ??
    [];

  if (!Array.isArray(impacted)) return [];

  const names: string[] = [];
  for (const item of impacted as unknown[]) {
    if (typeof item === "string") {
      names.push(item);
    } else if (item && typeof item === "object") {
      const name =
        (item as Record<string, unknown>)["qualified_name"] ??
        (item as Record<string, unknown>)["name"];
      if (name) names.push(String(name));
    }
    if (names.length >= MAX_BUMPS) break;
  }
  return names;
}

// ── Main handler ──────────────────────────────────────────────────────────

export async function processEvent(event: PostToolUseEvent): Promise<void> {
  const toolName = event.tool_name ?? "";
  if (!FILE_TOOLS.has(toolName)) return;

  const toolInput = (event.tool_input ?? {}) as Record<string, unknown>;
  const filePath = String(toolInput["file_path"] ?? "");
  if (!filePath) return;

  // I2: cooldown check before pipeline query
  if (checkCooldown(filePath)) return;

  const { projectRoot, databaseUrl } = loadHookConfig();
  const symbols = await pipelineDetectChanges(projectRoot, filePath).catch(
    () => [] as string[],
  );

  if (!symbols.length) return;

  // I3: bump fires after symbol resolution
  const count = await bumpHeatBySymbols(
    databaseUrl,
    symbols,
    IMPACT_BOOST,
    MAX_BUMPS,
  );
  if (count > 0) {
    updateCooldown(filePath);
    log(`bumped ${count} memories for ${symbols.length} impacted symbols`);
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

if (process.argv[1]?.endsWith("pipeline-impact-bump.js") === true) {
  main().catch(() => process.exit(0));
}
