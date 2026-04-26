/**
 * PostToolUse hook — capture significant tool outputs as memories.
 *
 * Filters by tool kind (high-value / light-value / conditional) and
 * content signals. High-value tools store the full (truncated) output;
 * light-value tools record only the input reference.
 *
 * Invariants:
 *   - Non-blocking: always exits 0, never blocks tool execution.
 *   - Idempotent: the remember handler's write-gate suppresses duplicates.
 *   - Stderr-only logging.
 *
 * Happens-before contract (Lamport 1978, §2):
 *   I1: this hook fires AFTER the named tool returns its result.
 *       The tool_response is causally after the tool_input.
 *   I2: no ordering between concurrent PostToolUse hooks for different
 *       tool calls in the same session — they may interleave.
 *   I3: cascade advancement fires at most every CASCADE_INTERVAL calls.
 *       It is a best-effort operation, not a correctness invariant.
 *
 * Failure model:
 *   All errors are non-fatal and logged to stderr. The hook never
 *   blocks the tool pipeline by exiting non-zero.
 *
 * Timeout: ~5s Claude Code PostToolUse budget (no explicit declaration).
 * source: HOOKS.md Hook 3.
 */

import { loadHookConfig, type PostToolUseEvent } from "./types.js";

const LOG_PREFIX = "[cortex-post-tool-capture]";

// Tools whose FULL output (truncated to MAX_OUTPUT_LENGTH) is stored.
const HIGH_VALUE_TOOLS = new Set([
  "Edit",
  "Write",
  "Bash",
  "MultiEdit",
  "NotebookEdit",
]);

// Tools captured for graph visibility only: input reference, not output.
// source: design rationale in post_tool_capture.py: keeps write <200ms.
const LIGHT_VALUE_TOOLS = new Set([
  "Read",
  "NotebookRead",
  "Glob",
  "Grep",
]);

const CONDITIONAL_TOOLS = new Set(["WebFetch", "WebSearch"]);

const MIN_OUTPUT_LENGTH = 50;
const MAX_OUTPUT_LENGTH = 4096;

// source: post_tool_capture.py _HIGH_VALUE_PATTERNS
const HIGH_VALUE_KEYWORDS = [
  "error",
  "exception",
  "traceback",
  "failed",
  "failure",
  "fixed",
  "resolved",
  "success",
  "deployed",
  "migrated",
  "decided",
  "chose",
  "switched",
  "selected",
  "created",
  "deleted",
  "moved",
  "refactored",
  "test",
  "assert",
  "pass",
  "fail",
  "warning",
  "deprecated",
];

// Cascade: run every N tool calls (biological basis: Dewar et al. 2012)
const CASCADE_INTERVAL = 20;
let toolCallCounter = 0;

function log(msg: string): void {
  process.stderr.write(`${LOG_PREFIX} ${msg}\n`);
}

function normalizeOutput(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw === null || raw === undefined) return "";
  return JSON.stringify(raw);
}

function shouldCapture(
  toolName: string,
  output: string,
): { capture: boolean; reason: string } {
  if (HIGH_VALUE_TOOLS.has(toolName)) {
    if (output.length < MIN_OUTPUT_LENGTH) {
      return { capture: false, reason: "output_too_short" };
    }
    return { capture: true, reason: `high_value_tool:${toolName}` };
  }

  if (LIGHT_VALUE_TOOLS.has(toolName)) {
    return { capture: true, reason: `light_value_tool:${toolName}` };
  }

  if (CONDITIONAL_TOOLS.has(toolName)) {
    const lower = output.toLowerCase();
    for (const kw of HIGH_VALUE_KEYWORDS) {
      if (lower.includes(kw)) {
        return { capture: true, reason: `keyword:${kw}` };
      }
    }
    return { capture: false, reason: "no_signal_keywords" };
  }

  return { capture: false, reason: `low_value_tool:${toolName}` };
}

function buildReferenceLine(
  toolName: string,
  toolInput: Record<string, unknown>,
): string | null {
  if (
    toolName === "Edit" ||
    toolName === "Write" ||
    toolName === "MultiEdit"
  ) {
    const fp = toolInput["file_path"];
    return fp ? `**File:** \`${String(fp)}\`` : null;
  }
  if (toolName === "NotebookEdit") {
    const fp = toolInput["notebook_path"];
    return fp ? `**File:** \`${String(fp)}\`` : null;
  }
  if (toolName === "Bash") {
    const cmd = String(toolInput["command"] ?? "").slice(0, 200);
    return cmd ? `**Command:** \`${cmd}\`` : null;
  }
  if (toolName === "Read" || toolName === "NotebookRead") {
    const fp = toolInput["file_path"] ?? toolInput["notebook_path"];
    return fp ? `**Read:** \`${String(fp)}\`` : null;
  }
  if (toolName === "Glob") {
    return (
      `**Glob:** \`${String(toolInput["pattern"] ?? "")}\` ` +
      `(root=\`${String(toolInput["path"] ?? "")}\`)`
    );
  }
  if (toolName === "Grep") {
    return (
      `**Grep:** \`${String(toolInput["pattern"] ?? "")}\` ` +
      `in \`${String(toolInput["path"] ?? "")}\``
    );
  }
  return null;
}

function buildMemoryContent(
  toolName: string,
  toolInput: Record<string, unknown>,
  output: string,
): string {
  const parts: string[] = [`# Tool: ${toolName}`];
  const ref = buildReferenceLine(toolName, toolInput);
  if (ref) parts.push(ref);

  // Light-value: input reference only
  if (LIGHT_VALUE_TOOLS.has(toolName)) {
    return parts.join("\n");
  }

  // High-value: include truncated output
  const truncated =
    output.length > MAX_OUTPUT_LENGTH
      ? output.slice(0, MAX_OUTPUT_LENGTH) +
        `\n... [truncated ${output.length - MAX_OUTPUT_LENGTH} chars]`
      : output;
  parts.push(`\n**Output:**\n\`\`\`\n${truncated}\n\`\`\``);
  return parts.join("\n");
}

function buildTags(toolName: string, output: string): string[] {
  const tags = ["auto-captured", `tool:${toolName.toLowerCase()}`];
  const lower = output.toLowerCase();

  if (
    lower.includes("error") ||
    lower.includes("exception") ||
    lower.includes("traceback")
  ) {
    tags.push("error");
  }
  if (
    lower.includes("test") &&
    (lower.includes("pass") || lower.includes("fail"))
  ) {
    tags.push("test-result");
  }
  if (
    lower.includes("fixed") ||
    lower.includes("resolved") ||
    lower.includes("success")
  ) {
    tags.push("success");
  }
  if (
    lower.includes("decided") ||
    lower.includes("chose") ||
    lower.includes("switched") ||
    lower.includes("selected")
  ) {
    tags.push("decision");
  }
  return tags;
}

/** Route through MemoryStore rather than calling DB directly. */
async function storeMemory(
  content: string,
  tags: string[],
  directory: string,
  toolName: string,
): Promise<void> {
  // In the full port this routes through the remember handler from
  // packages/memory/src/remember/. We stub the interface here so
  // this file compiles independently. The integration is wired at
  // runtime by the runner when the remember package is available.
  const { databaseUrl } = loadHookConfig();
  // Stub: in production, call the remember handler from cortex-remember.
  // For now: log that we would store and return.
  log(`would store ${toolName} → db=${databaseUrl}, tags=${tags.join(",")}, len=${content.length}`);
  // TODO: wire to packages/memory/src/remember/index when merged (merge order #2).
  void directory;
}

export async function processEvent(event: PostToolUseEvent): Promise<void> {
  const toolName = event.tool_name ?? "";
  const toolInput = (event.tool_input ?? {}) as Record<string, unknown>;
  const cwd = event.cwd ?? "";
  const output = normalizeOutput(event.tool_response);

  // Periodic cascade (I3: best-effort, non-blocking)
  toolCallCounter++;
  if (toolCallCounter >= CASCADE_INTERVAL) {
    toolCallCounter = 0;
    log("cascade interval reached — stub (wire to consolidation when merged)");
  }

  const { capture, reason } = shouldCapture(toolName, output);
  if (!capture) {
    log(`skip ${toolName}: ${reason}`);
    return;
  }

  const content = buildMemoryContent(toolName, toolInput, output);
  const tags = buildTags(toolName, output);

  try {
    await storeMemory(content, tags, cwd, toolName);
  } catch (err) {
    log(`capture failed (non-fatal): ${String(err)}`);
  }
}

export async function main(): Promise<void> {
  if (process.stdin.isTTY) {
    log("No stdin data (TTY mode), exiting");
    process.exit(0);
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) {
    log("Empty stdin, exiting");
    process.exit(0);
  }

  let event: PostToolUseEvent;
  try {
    event = JSON.parse(raw) as PostToolUseEvent;
  } catch (err) {
    log(`Failed to parse event JSON: ${String(err)}`);
    process.exit(0);
  }

  await processEvent(event).catch((err) => {
    log(`process failed (non-fatal): ${String(err)}`);
  });
  process.exit(0);
}

if (process.argv[1]?.endsWith("post-tool-capture.js") === true) {
  main().catch(() => process.exit(0));
}
