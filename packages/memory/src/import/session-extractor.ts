/**
 * Extract memorable content from Claude Code JSONL conversation records.
 *
 * Pure business logic — no I/O. Receives parsed records, returns extraction
 * results. This is the "living-descendant" layer: the core NLP classification
 * and importance scoring that survives across all import formats.
 *
 * Port of: mcp_server/core/session_extractor.py
 *
 * Champollion note: every pattern, constant, and threshold below traces
 * glyph-for-glyph to the Python source. No invented constants.
 */

import type { ExtractedItem, JsonlRecord, MessageBlock, SessionSummary } from "./types.js";

// ── Detection patterns ────────────────────────────────────────────────────
// source: mcp_server/core/session_extractor.py — _DECISION_RE, _ERROR_RE, etc.

const DECISION_RE =
  /\b(decided|chose|switched|migrated|selected|picked|opted|going with|let'?s use|we should|must use|prefer|instead of|rather than|moved to|changed to)\b/i;

const ERROR_RE =
  /\b(error|exception|traceback|failed|failure|bug|crash|broken|timeout|denied|rejected|not working|doesn'?t work|fix|fixed|resolved|debug|issue)\b/i;

const ARCHITECTURE_RE =
  /\b(architecture|design|pattern|refactor|restructur|modular|decouple|abstract|layer|interface|protocol|clean architecture|solid|dependency injection|factory|observer|singleton)\b/i;

const INSIGHT_RE =
  /\b(learned|realized|turns out|key takeaway|important|remember|note to self|lesson|discovery|root cause|the problem was|solution is|conclusion)\b/i;

const SKIP_RE =
  /^\[Request interrupted|^<system-reminder>|^Continue the conversation|^<task-notification>|^<tool-use-result>/i;

// source: mcp_server/core/session_extractor.py — _MIN_CONTENT_LEN, _MAX_CONTENT_LEN
const MIN_CONTENT_LEN = 40;
const MAX_CONTENT_LEN = 2000;

// ── Text extraction ────────────────────────────────────────────────────────

/**
 * Extract plain text from message content (string or list of blocks).
 *
 * Port of: mcp_server/core/session_extractor.py::_extract_text
 */
function extractText(content: string | MessageBlock[] | undefined): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string") {
        parts.push(block.text);
      }
    }
    return parts.join(" ").trim();
  }
  return "";
}

// ── Message extraction ────────────────────────────────────────────────────

/**
 * Extract user messages from JSONL records, filtering noise.
 *
 * Port of: mcp_server/core/session_extractor.py::extract_user_messages
 */
export function extractUserMessages(
  records: JsonlRecord[],
): Array<{ text: string; timestamp: string; session_id: string }> {
  const messages: Array<{ text: string; timestamp: string; session_id: string }> = [];

  for (const rec of records) {
    if (rec.type !== "user") continue;
    if (rec.isMeta === true || rec.toolUseResult !== undefined) continue;

    const msg = rec.message ?? {};
    const text = extractText(msg.content as string | MessageBlock[] | undefined);

    if (!text || text.length < MIN_CONTENT_LEN) continue;
    if (SKIP_RE.test(text)) continue;

    messages.push({
      text: text.slice(0, MAX_CONTENT_LEN),
      timestamp: rec.timestamp ?? "",
      session_id: rec.sessionId ?? "",
    });
  }

  return messages;
}

// ── Classification ────────────────────────────────────────────────────────

/**
 * Classify a message into zero or more categories.
 *
 * Port of: mcp_server/core/session_extractor.py::classify_message
 */
export function classifyMessage(text: string): string[] {
  const categories: string[] = [];
  if (DECISION_RE.test(text)) categories.push("decision");
  if (ERROR_RE.test(text)) categories.push("error");
  if (ARCHITECTURE_RE.test(text)) categories.push("architecture");
  if (INSIGHT_RE.test(text)) categories.push("insight");
  return categories;
}

// ── Importance scoring ────────────────────────────────────────────────────

/**
 * Score how important a message is for long-term memory.
 *
 * Port of: mcp_server/core/session_extractor.py::score_importance
 *
 * source: baseline=0.3, decision+0.25, architecture+0.2, error+0.15,
 *         insight+0.3 — mcp_server/core/session_extractor.py
 */
export function scoreImportance(text: string, categories: string[]): number {
  // source: baseline 0.3 — session_extractor.py
  let score = 0.3;

  if (categories.includes("decision")) score += 0.25;
  if (categories.includes("architecture")) score += 0.2;
  if (categories.includes("error")) score += 0.15;
  if (categories.includes("insight")) score += 0.3;

  if (text.length > 200) score += 0.1;
  if (/```/.test(text)) score += 0.05; // contains code
  if (/\b(always|never|must|should)\b/i.test(text)) score += 0.1; // prescriptive

  return Math.min(score, 1.0);
}

// ── Item extraction ───────────────────────────────────────────────────────

/**
 * Extract items worth remembering from conversation records.
 *
 * Returns list of items with: content, tags, importance, timestamp, session_id.
 * Filters by minimum importance threshold.
 *
 * Port of: mcp_server/core/session_extractor.py::extract_memorable_items
 */
export function extractMemorableItems(
  records: JsonlRecord[],
  minImportance = 0.4,
): ExtractedItem[] {
  const messages = extractUserMessages(records);
  const items: ExtractedItem[] = [];
  const seenContent = new Set<string>();

  for (const msg of messages) {
    const contentKey = msg.text.slice(0, 100).toLowerCase();
    if (seenContent.has(contentKey)) continue;
    seenContent.add(contentKey);

    const categories = classifyMessage(msg.text);
    const importance = scoreImportance(msg.text, categories);

    if (importance < minImportance) continue;

    items.push({
      content: msg.text,
      tags: [...categories, "imported"],
      importance,
      timestamp: msg.timestamp,
      session_id: msg.session_id,
    });
  }

  return items;
}

// ── Session summary ───────────────────────────────────────────────────────

/**
 * Extract tool names from an assistant record.
 *
 * Port of: mcp_server/core/session_extractor.py::_extract_tools_from_assistant
 */
function extractToolsFromAssistant(rec: JsonlRecord, toolsUsed: Set<string>): void {
  const content = rec.message?.content;
  if (!Array.isArray(content)) return;
  for (const block of content as MessageBlock[]) {
    if (block.type === "tool_use" && typeof block.name === "string" && block.name) {
      toolsUsed.add(block.name);
    }
  }
}

/**
 * Build a session-level summary from records.
 *
 * Port of: mcp_server/core/session_extractor.py::extract_session_summary
 */
export function extractSessionSummary(records: JsonlRecord[]): SessionSummary {
  let sessionId = "";
  let cwd = "";
  let firstMessage = "";
  const timestamps: string[] = [];
  let userCount = 0;
  const toolsUsed = new Set<string>();

  for (const rec of records) {
    if (!sessionId && rec.sessionId) sessionId = rec.sessionId;
    if (!cwd && rec.cwd) cwd = rec.cwd;

    if (rec.timestamp) timestamps.push(rec.timestamp);

    if (rec.type === "user") {
      userCount += 1;
      if (!firstMessage && !rec.toolUseResult) {
        const msg = rec.message ?? {};
        const text = extractText(msg.content as string | MessageBlock[] | undefined);
        if (text && !SKIP_RE.test(text)) {
          firstMessage = text.slice(0, 200);
        }
      }
    }

    if (rec.type === "assistant") {
      extractToolsFromAssistant(rec, toolsUsed);
    }
  }

  return {
    session_id: sessionId,
    cwd,
    first_message: firstMessage,
    user_count: userCount,
    tools_used: [...toolsUsed].sort(),
    start_time: timestamps.length > 0 ? timestamps.reduce((a, b) => (a < b ? a : b)) : "",
    end_time: timestamps.length > 0 ? timestamps.reduce((a, b) => (a > b ? a : b)) : "",
  };
}
