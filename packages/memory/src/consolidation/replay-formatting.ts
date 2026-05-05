/**
 * Replay formatting — context restoration for post-compaction injection.
 *
 * Formats checkpoint state and hot memories as injectable markdown
 * for hippocampal context reconstruction after Claude Code compaction.
 *
 * Pure business logic — no I/O.
 *
 * Port of: cortex@ed33435 mcp_server/core/replay_formatting.py
 */

// ── Micro-checkpoint detection ────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/replay_formatting.py:16-24

const MICRO_ERROR_RE = /\b(error|exception|traceback|failed|crash|bug)\b/i;
const MICRO_DECISION_RE = /\b(decided|chose|switched|migrated|will use|going with|opted)\b/i;

const CRITICAL_TAGS = new Set(["critical", "important", "architecture", "breaking"]);

/**
 * Check if content warrants a micro-checkpoint.
 *
 * Triggers on error detection, decisions, high surprise, or critical tags.
 *
 * precondition:  cooldown >= 0; toolCallCount >= 0; surprise ∈ [0, 1].
 * postcondition: returned [shouldCheckpoint, reason] where reason is ""
 *   when shouldCheckpoint is false.
 *
 * source: cortex@ed33435 mcp_server/core/replay_formatting.py:27-55
 */
export function shouldMicroCheckpoint(
  content: string,
  tags: string[],
  surprise = 0.0,
  toolCallCount = 0,
  cooldown = 5,
): [boolean, string] {
  if (toolCallCount < cooldown) return [false, ""];
  if (MICRO_ERROR_RE.test(content)) return [true, "error_detected"];
  if (MICRO_DECISION_RE.test(content)) return [true, "decision_made"];
  if (surprise > 0.8) return [true, "high_surprise_event"];

  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  for (const ct of CRITICAL_TAGS) {
    if (tagSet.has(ct)) return [true, "critical_tag"];
  }

  return [false, ""];
}

// ── JSON field parsing ────────────────────────────────────────────────────

/**
 * Safely parse a JSON field that might be string or array.
 * source: cortex@ed33435 mcp_server/core/replay_formatting.py:61-70
 */
function parseJsonField(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try { return JSON.parse(value) as unknown[]; }
    catch { return []; }
  }
  return [];
}

// ── Restoration formatting ────────────────────────────────────────────────

/**
 * Truncate text with ellipsis if it exceeds maxLen.
 * source: cortex@ed33435 mcp_server/core/replay_formatting.py:166-170
 */
function truncate(text: string, maxLen: number): string {
  if (text.length > maxLen) return text.slice(0, maxLen) + "...";
  return text;
}

function appendListField(
  lines: string[],
  checkpoint: Record<string, unknown>,
  fieldName: string,
  label: string,
): void {
  const items = parseJsonField(checkpoint[fieldName]);
  if (items.length > 0) {
    lines.push(`**${label}:**`);
    for (const item of items) {
      lines.push(`- ${item}`);
    }
  }
}

function formatCheckpoint(lines: string[], checkpoint: Record<string, unknown>): void {
  lines.push("## What You Were Doing");
  const task = (checkpoint["current_task"] as string | undefined) ?? "";
  if (task) lines.push(`**Task:** ${task}`);

  const files = parseJsonField(checkpoint["files_being_edited"]);
  if (files.length > 0) {
    lines.push(`**Files:** ${files.map(String).join(", ")}`);
  }

  appendListField(lines, checkpoint, "key_decisions", "Decisions");
  appendListField(lines, checkpoint, "open_questions", "Open questions");
  appendListField(lines, checkpoint, "next_steps", "Next steps");
  appendListField(lines, checkpoint, "active_errors", "Active errors");

  const custom = (checkpoint["custom_context"] as string | undefined) ?? "";
  if (custom) lines.push(`\n${custom}`);
  lines.push("");
}

function formatAnchored(lines: string[], memories: Record<string, unknown>[]): void {
  lines.push("## Critical Facts (Anchored)");
  for (const m of memories) {
    const content = truncate((m["content"] as string | undefined) ?? "", 300);
    lines.push(`- ${content}`);
  }
  lines.push("");
}

function formatRecent(lines: string[], memories: Record<string, unknown>[]): void {
  lines.push("## Working Memory (Recently Stored)");
  for (const m of memories.slice(0, 6)) {
    const content = truncate((m["content"] as string | undefined) ?? "", 250);
    const created = String((m["created_at"] as string | undefined) ?? "").slice(0, 16);
    lines.push(`- [${created}] ${content}`);
  }
  lines.push("");
}

function formatHot(lines: string[], memories: Record<string, unknown>[]): void {
  lines.push("## Active Project Context");
  for (const m of memories.slice(0, 6)) {
    const content = truncate((m["content"] as string | undefined) ?? "", 200);
    const heat = (m["heat"] as number | undefined) ?? 0;
    lines.push(`- [${heat.toFixed(2)}] ${content}`);
  }
  lines.push("");
}

/**
 * Format restoration data as injectable markdown for context reconstruction.
 *
 * precondition:  checkpoint, memories arrays may be null/empty.
 * postcondition: returns a non-empty markdown string with
 *   # Cortex Context Restoration header.
 *
 * source: cortex@ed33435 mcp_server/core/replay_formatting.py:76-97
 */
export function formatRestoration(
  checkpoint: Record<string, unknown> | null,
  anchoredMemories: Record<string, unknown>[],
  recentMemories: Record<string, unknown>[],
  hotMemories: Record<string, unknown>[],
  directory = "",
): string {
  const lines: string[] = ["# Cortex Context Restoration (Hippocampal Replay)", ""];

  if (checkpoint) formatCheckpoint(lines, checkpoint);
  if (anchoredMemories.length > 0) formatAnchored(lines, anchoredMemories);
  if (recentMemories.length > 0) formatRecent(lines, recentMemories);
  if (hotMemories.length > 0) formatHot(lines, hotMemories);
  if (directory) lines.push(`*Restored for directory: ${directory}*`);

  return lines.join("\n");
}
