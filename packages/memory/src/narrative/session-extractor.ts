/**
 * session-extractor — extract memorable content from session JSONL records.
 *
 * Pure business logic — no I/O.  Receives parsed records, returns extraction
 * results.  Direct port of mcp_server/core/session_extractor.py.
 *
 * Strategies (preserved from Python source):
 *   1. Decision extraction: user messages containing decision keywords
 *   2. Error extraction: messages about bugs, failures, debugging sessions
 *   3. Architecture extraction: design discussions, pattern choices
 *   4. Key insight extraction: important conclusions, lessons learned
 *   5. Tool pattern extraction: which tools were used and how
 *
 * Each extracted item includes content, tags, and a source classification.
 */

import type { MemorableItem, SessionRecord, SessionSummary } from "./types.js";

// ── Detection patterns ─────────────────────────────────────────────────────

// source: mcp_server/core/session_extractor.py — _DECISION_RE
const DECISION_RE =
  /\b(decided|chose|switched|migrated|selected|picked|opted|going with|let'?s use|we should|must use|prefer|instead of|rather than|moved to|changed to)\b/i;

// source: mcp_server/core/session_extractor.py — _ERROR_RE
const ERROR_RE =
  /\b(error|exception|traceback|failed|failure|bug|crash|broken|timeout|denied|rejected|not working|doesn'?t work|fix|fixed|resolved|debug|issue)\b/i;

// source: mcp_server/core/session_extractor.py — _ARCHITECTURE_RE
const ARCHITECTURE_RE =
  /\b(architecture|design|pattern|refactor|restructur|modular|decouple|abstract|layer|interface|protocol|clean architecture|solid|dependency injection|factory|observer|singleton)\b/i;

// source: mcp_server/core/session_extractor.py — _INSIGHT_RE
const INSIGHT_RE =
  /\b(learned|realized|turns out|key takeaway|important|remember|note to self|lesson|discovery|root cause|the problem was|solution is|conclusion)\b/i;

// source: mcp_server/core/session_extractor.py — _SKIP_RE
const SKIP_RE =
  /^\[Request interrupted|^<system-reminder>|^Continue the conversation|^<task-notification>|^<tool-use-result>/i;

// Minimum content length worth storing
// source: mcp_server/core/session_extractor.py — _MIN_CONTENT_LEN = 40
const MIN_CONTENT_LEN = 40;

// Maximum content length per memory
// source: mcp_server/core/session_extractor.py — _MAX_CONTENT_LEN = 2000
const MAX_CONTENT_LEN = 2000;

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract plain text from message content (string or array of typed blocks).
 * Mirrors session_extractor._extract_text.
 */
export function extractText(
  content: unknown
): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (
        typeof block === "object" &&
        block !== null &&
        (block as Record<string, unknown>)["type"] === "text"
      ) {
        const text = (block as Record<string, unknown>)["text"];
        if (typeof text === "string") {
          parts.push(text);
        }
      }
    }
    return parts.join(" ").trim();
  }
  return "";
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Extract user messages from JSONL records, filtering noise.
 * Mirrors session_extractor.extract_user_messages.
 */
export function extractUserMessages(
  records: SessionRecord[]
): Array<{ text: string; timestamp: string; session_id: string }> {
  const messages: Array<{ text: string; timestamp: string; session_id: string }> = [];

  for (const rec of records) {
    if (rec.type !== "user") continue;
    if (rec.isMeta ?? false) continue;
    if (rec.toolUseResult !== undefined && rec.toolUseResult !== null) continue;

    const rawContent = rec.message?.content;
    const text = extractText(rawContent);

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

/**
 * Classify a message into zero or more categories.
 * Mirrors session_extractor.classify_message.
 */
export function classifyMessage(text: string): string[] {
  const categories: string[] = [];

  if (DECISION_RE.test(text)) categories.push("decision");
  if (ERROR_RE.test(text)) categories.push("error");
  if (ARCHITECTURE_RE.test(text)) categories.push("architecture");
  if (INSIGHT_RE.test(text)) categories.push("insight");

  return categories;
}

/**
 * Score how important a message is for long-term memory.
 * Mirrors session_extractor.score_importance.
 *
 * Baseline score and category boosts are preserved from the Python source.
 * No invented constants — all values sourced from session_extractor.py.
 */
export function scoreImportance(text: string, categories: string[]): number {
  // source: mcp_server/core/session_extractor.py — score_importance
  let score = 0.3; // baseline

  if (categories.includes("decision")) score += 0.25;
  if (categories.includes("architecture")) score += 0.2;
  if (categories.includes("error")) score += 0.15;
  if (categories.includes("insight")) score += 0.3;

  if (text.length > 200) score += 0.1;
  if (/```/.test(text)) score += 0.05; // contains code
  if (/\b(always|never|must|should)\b/i.test(text)) score += 0.1; // prescriptive

  return Math.min(score, 1.0);
}

/**
 * Classify a message and build a memorable item if important enough.
 * Mirrors session_extractor._classify_and_build_item.
 */
function classifyAndBuildItem(
  msg: { text: string; timestamp: string; session_id: string },
  minImportance: number
): MemorableItem | null {
  const categories = classifyMessage(msg.text);
  const importance = scoreImportance(msg.text, categories);
  if (importance < minImportance) return null;
  return {
    content: msg.text,
    tags: [...categories, "imported"],
    importance,
    timestamp: msg.timestamp,
    session_id: msg.session_id,
  };
}

/**
 * Extract items worth remembering from conversation records.
 * Returns list with: content, tags, importance, timestamp, session_id.
 * Filters by minimum importance threshold.
 *
 * Mirrors session_extractor.extract_memorable_items.
 */
export function extractMemorableItems(
  records: SessionRecord[],
  { minImportance = 0.4 }: { minImportance?: number } = {}
): MemorableItem[] {
  const messages = extractUserMessages(records);
  const items: MemorableItem[] = [];
  const seenContent = new Set<string>();

  for (const msg of messages) {
    const contentKey = msg.text.slice(0, 100).toLowerCase();
    if (seenContent.has(contentKey)) continue;
    seenContent.add(contentKey);

    const item = classifyAndBuildItem(msg, minImportance);
    if (item !== null) items.push(item);
  }

  return items;
}

/**
 * Extract tool names used from an assistant record.
 * Mirrors session_extractor._extract_tools_from_assistant.
 */
function extractToolsFromAssistant(rec: SessionRecord, toolsUsed: Set<string>): void {
  const content = rec.message?.content;
  if (!Array.isArray(content)) return;
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      (block as Record<string, unknown>)["type"] === "tool_use"
    ) {
      const name = (block as Record<string, unknown>)["name"];
      if (typeof name === "string" && name) {
        toolsUsed.add(name);
      }
    }
  }
}

/**
 * Build a session-level summary from records.
 * Mirrors session_extractor.extract_session_summary.
 */
export function extractSessionSummary(records: SessionRecord[]): SessionSummary {
  let sessionId = "";
  let cwd = "";
  let firstMessage = "";
  const timestamps: string[] = [];
  let userCount = 0;
  const toolsUsed = new Set<string>();

  for (const rec of records) {
    if (!sessionId && rec.sessionId) sessionId = rec.sessionId;
    if (!cwd && rec.cwd) cwd = rec.cwd;

    const ts = rec.timestamp;
    if (ts) timestamps.push(ts);

    if (rec.type === "user") {
      userCount += 1;
      if (!firstMessage && !(rec.toolUseResult !== undefined && rec.toolUseResult !== null)) {
        const text = extractText(rec.message?.content);
        if (text && !SKIP_RE.test(text)) {
          firstMessage = text.slice(0, 200);
        }
      }
    }

    if (rec.type === "assistant") {
      extractToolsFromAssistant(rec, toolsUsed);
    }
  }

  const startTime = timestamps.length > 0 ? timestamps.reduce((a, b) => (a < b ? a : b)) : "";
  const endTime = timestamps.length > 0 ? timestamps.reduce((a, b) => (a > b ? a : b)) : "";

  return {
    session_id: sessionId,
    cwd,
    first_message: firstMessage,
    user_count: userCount,
    tools_used: Array.from(toolsUsed).sort(),
    start_time: startTime,
    end_time: endTime,
  };
}
