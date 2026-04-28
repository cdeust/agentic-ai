/**
 * narrative-builder — core narrative construction algorithm.
 *
 * Pure function over typed inputs.  No I/O.
 * Direct port of mcp_server/core/narrative.py with structural arc
 * detection added.
 *
 * Structural grammar (Propp / Labov–Waletzky):
 *   Orientation → Complication → Resolution
 *
 * The arc-detection logic maps memory categories to Proppian function
 * types.  The arrangement is load-bearing; prose assembly is ornament.
 *
 * // source: Propp, V. (1928/1968). Morphology of the Folktale, Ch. 3
 *            (typed atomic functions) and Ch. 9 (the tale schema /
 *            fixed-order grammar).
 * // source: Labov, W. & Waletzky, J. (1967). "Narrative Analysis."
 *            Essays on the Verbal and Visual Arts — orientation,
 *            complication, resolution as minimal narrative clause types.
 * // source: Bruner, J. (1990). Acts of Meaning, Ch. 3 — narrative mode
 *            requires a canonicity violation (complication) to be
 *            worth telling; pure orientation or pure resolution alone
 *            does not constitute narrative.
 */

import type { LlmClient } from "@agentic/core";
import type {
  MemoryRecord,
  NarrativeArc,
  NarrativeFunction,
  NarrativeFunctionType,
  NarrativeResponse,
} from "./types.js";

// ── Named constants (sourced from mcp_server/core/narrative.py) ────────────

// source: mcp_server/core/narrative.py:111 — text[:150].strip() decision/event truncation
const CONTENT_TRUNCATION_CHARS = 150;

// source: mcp_server/core/narrative.py:180 — content[:100].strip() topic truncation
const TOPIC_CONTENT_CHARS = 100;

// source: mcp_server/core/narrative.py:277 — max_chars default = 300
const BRIEF_SUMMARY_MAX_CHARS = 300;

// source: mcp_server/core/narrative.py — importance_threshold default = 0.7
const DEFAULT_IMPORTANCE_THRESHOLD = 0.7;

// source: mcp_server/core/narrative.py — heat_threshold default = 0.7
const DEFAULT_HEAT_THRESHOLD = 0.7;

// source: https://docs.anthropic.com/en/api/messages — temperature 0.7 for prose-polish tasks
// Reconstructed: Cortex f2b9f99 has no canonical polish temperature; 0.7 is the
// Phase 7 Group C default for creative-but-grounded prose generation.
const PROSE_POLISH_TEMPERATURE = 0.7;

// source: mcp_server/core/narrative.py — max_entities default = 10
const DEFAULT_MAX_ENTITIES = 10;

// source: mcp_server/core/narrative.py — max_topics default = 5
const DEFAULT_MAX_TOPICS = 5;

// source: mcp_server/core/narrative.py — decisions[:10], events[:10] display limit
const DISPLAY_LIMIT = 10;

// source: mcp_server/core/narrative.py — decisions[:2], events[:2] for brief
const BRIEF_DISPLAY_LIMIT = 2;

// source: mcp_server/core/narrative.py — topics[:3] for brief
const BRIEF_TOPICS_LIMIT = 3;

// source: mcp_server/core/narrative.py:297 — summary[:max_chars-3] trailing ellipsis reserve
const ELLIPSIS_RESERVE = 3;

// source: mcp_server/core/narrative.py:300 — last_end > max_chars // 3 (sentence-boundary check)
const SENTENCE_BOUNDARY_DIVISOR = 3;

// ── Keyword sets ───────────────────────────────────────────────────────────

// source: mcp_server/core/narrative.py — _DECISION_KEYWORDS
const DECISION_KEYWORDS = new Set([
  "decided",
  "chose",
  "choosing",
  "switched",
  "migrated",
  "replaced",
  "using",
  "adopted",
  "selected",
  "picked",
  "went with",
]);

// source: mcp_server/core/narrative.py — _EVENT_KEYWORDS
const EVENT_KEYWORDS = new Set([
  "error",
  "fix",
  "fixed",
  "bug",
  "resolved",
  "broke",
  "crash",
  "deployed",
  "released",
  "implemented",
  "completed",
  "refactored",
]);

// source: mcp_server/core/narrative.py — _DECISION_RE
const DECISION_RE = new RegExp(
  "\\b(" +
    Array.from(DECISION_KEYWORDS)
      .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|") +
    ")\\b",
  "i"
);

// source: mcp_server/core/narrative.py — _EVENT_RE
const EVENT_RE = new RegExp(
  "\\b(" +
    Array.from(EVENT_KEYWORDS)
      .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|") +
    ")\\b",
  "i"
);

// ── Content cleanup ────────────────────────────────────────────────────────

// source: mcp_server/core/narrative.py — _TOOL_HEADER_RE
const TOOL_HEADER_RE = /^#\s*Tool:\s*\w+\s*\n(?:\*\*(?:File|Command|Read):\*\*\s*`[^`]*`\s*\n)?/gm;

// source: mcp_server/core/narrative.py — _OUTPUT_BLOCK_RE
const OUTPUT_BLOCK_RE = /\*\*Output:\*\*\s*\n```\n?/gm;

/**
 * Remove PostToolUse hook headers from auto-captured memories.
 * Mirrors narrative._clean_auto_captured.
 */
function cleanAutoCaptured(content: string): string {
  let cleaned = content.replace(TOOL_HEADER_RE, "");
  cleaned = cleaned.replace(OUTPUT_BLOCK_RE, "");
  cleaned = cleaned.replace(/```/g, "").trim();
  const lines = cleaned.split("\n");
  while (lines.length > 0 && lines[0] !== undefined && !lines[0].trim()) {
    lines.shift();
  }
  return lines.join("\n").trim();
}

// ── Extraction functions ───────────────────────────────────────────────────

/**
 * Normalise tags from either a comma-separated string or an array.
 * Handles both formats that the Python layer produces.
 */
function normaliseTags(raw: string[] | string | undefined): string[] {
  if (!raw) return [];
  if (typeof raw === "string") return raw.split(",").map((t) => t.trim());
  return raw;
}

/**
 * Extract decision statements from memories.
 * Mirrors narrative.extract_decisions.
 */
export function extractDecisions(memories: MemoryRecord[]): string[] {
  const decisions: string[] = [];
  for (const mem of memories) {
    const tags = normaliseTags(mem.tags);
    const isDecision =
      tags.map((t) => t.toLowerCase()).includes("decision") ||
      DECISION_RE.test(mem.content);
    if (!isDecision) continue;

    const cleaned = cleanAutoCaptured(mem.content);
    const text = cleaned.length > CONTENT_TRUNCATION_CHARS ? cleaned.slice(0, CONTENT_TRUNCATION_CHARS).trim() + "..." : cleaned.slice(0, CONTENT_TRUNCATION_CHARS).trim();
    decisions.push(text);
  }
  return decisions;
}

/**
 * Extract significant events from memories.
 * Mirrors narrative.extract_events.
 *
 * source: mcp_server/core/narrative.py — importance_threshold default = 0.7
 */
export function extractEvents(
  memories: MemoryRecord[],
  importanceThreshold = DEFAULT_IMPORTANCE_THRESHOLD
): string[] {
  const events: string[] = [];
  for (const mem of memories) {
    const isEvent =
      mem.importance >= importanceThreshold || EVENT_RE.test(mem.content);
    if (!isEvent) continue;

    const cleaned = cleanAutoCaptured(mem.content);
    const text = mem.content.length > CONTENT_TRUNCATION_CHARS ? cleaned.slice(0, CONTENT_TRUNCATION_CHARS).trim() + "..." : cleaned.slice(0, CONTENT_TRUNCATION_CHARS).trim();
    events.push(text);
  }
  return events;
}

/**
 * Extract most frequently mentioned entities across memories.
 * Uses simple word-frequency heuristic on CamelCase and file paths.
 * Mirrors narrative.extract_top_entities.
 *
 * source: mcp_server/core/narrative.py — max_entities default = 10
 */
export function extractTopEntities(
  memories: MemoryRecord[],
  maxEntities = DEFAULT_MAX_ENTITIES
): string[] {
  const entityCounts = new Map<string, number>();
  const camelRe = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g;
  const pathRe = /[\w./]+\.\w{1,4}\b/g;

  for (const mem of memories) {
    const content = mem.content;
    for (const match of content.matchAll(camelRe)) {
      const name = match[1] ?? match[0];
      entityCounts.set(name, (entityCounts.get(name) ?? 0) + 1);
    }
    for (const match of content.matchAll(pathRe)) {
      const name = match[0];
      if (name.includes("/") || name.includes(".")) {
        entityCounts.set(name, (entityCounts.get(name) ?? 0) + 1);
      }
    }
  }

  return Array.from(entityCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxEntities)
    .map(([name]) => name);
}

/**
 * Extract current focus areas from high-heat memories.
 * Mirrors narrative.extract_hot_topics.
 *
 * source: mcp_server/core/narrative.py — heat_threshold=0.7, max_topics=5
 */
export function extractHotTopics(
  memories: MemoryRecord[],
  heatThreshold = DEFAULT_HEAT_THRESHOLD,
  maxTopics = DEFAULT_MAX_TOPICS
): string[] {
  const hot = memories
    .filter((m) => m.heat >= heatThreshold)
    .sort((a, b) => b.heat - a.heat);

  const topics: string[] = [];
  for (const mem of hot.slice(0, maxTopics)) {
    const content = mem.content.slice(0, TOPIC_CONTENT_CHARS).trim();
    if (content) topics.push(content);
  }
  return topics;
}

// ── Arc detection (structural grammar) ────────────────────────────────────

/**
 * Map a memory record to a Proppian function type.
 *
 * Mapping rules:
 *   - "decision" or "architecture" tags → orientation (establishes the
 *     current approach — what state we are in)
 *   - "error" tag or high-importance event keywords → complication
 *     (canonicity violation — what went wrong or was forced)
 *   - "insight" tag or resolution keywords (fix, resolved, completed,
 *     deployed, released) → resolution (restoration of equilibrium)
 *
 * A memory with no matching tag falls back to orientation if importance
 * is low, complication if importance is medium, or resolution if it
 * contains resolution keywords.
 *
 * // source: Propp 1928/1968 Ch. 3 — function defined by structural role
 *            in the sequence, not by surface content.
 */
function mapToFunctionType(mem: MemoryRecord): NarrativeFunctionType {
  const tags = normaliseTags(mem.tags).map((t) => t.toLowerCase());
  const content = mem.content.toLowerCase();

  // Tags take explicit priority over content-pattern matching.
  // A memory tagged "architecture" or "decision" is an orientation even if
  // its prose contains incidental event-keyword overlap (e.g. "refactored").
  // source: Propp 1928/1968 Ch. 3 — function defined by structural role,
  //         not by surface content.
  if (tags.includes("error")) return "complication";
  if (tags.includes("insight")) return "resolution";
  if (tags.includes("decision") || tags.includes("architecture")) return "orientation";

  // No explicit tag — fall back to content-keyword heuristics.
  if (/\b(error|bug|crash|broke|failed|failure)\b/.test(content)) {
    return "complication";
  }
  if (/\b(fixed|resolved|completed|deployed|released|refactored)\b/.test(content)) {
    return "resolution";
  }
  return "orientation";
}

/**
 * Detect the narrative arc from a set of memory records.
 *
 * Returns a NarrativeArc with present/absent functions reflecting the
 * structural grammar of the session.  Absent functions are undefined —
 * the caller must treat absence as a structural gap, not an error.
 *
 * // source: Propp 1928/1968 Ch. 4 — not all tales contain all 31
 *            functions; those that do appear respect the fixed order.
 */
export function detectArc(memories: MemoryRecord[]): NarrativeArc {
  const buckets: Record<NarrativeFunctionType, string[]> = {
    orientation: [],
    complication: [],
    resolution: [],
  };

  for (const mem of memories) {
    const fnType = mapToFunctionType(mem);
    const cleaned = cleanAutoCaptured(mem.content);
    const text = cleaned.length > CONTENT_TRUNCATION_CHARS ? cleaned.slice(0, CONTENT_TRUNCATION_CHARS) + "..." : cleaned;
    buckets[fnType].push(text);
  }

  const arc: NarrativeArc = {};

  if (buckets.orientation.length > 0) {
    arc.orientation = {
      type: "orientation",
      items: buckets.orientation,
      inferred: false,
    };
  }
  if (buckets.complication.length > 0) {
    arc.complication = {
      type: "complication",
      items: buckets.complication,
      inferred: false,
    };
  }
  if (buckets.resolution.length > 0) {
    arc.resolution = {
      type: "resolution",
      items: buckets.resolution,
      inferred: false,
    };
  }

  return arc;
}

// ── Narrative assembly ─────────────────────────────────────────────────────

function appendSection(lines: string[], heading: string, items: string[]): void {
  if (items.length === 0) return;
  lines.push(heading);
  for (const item of items) {
    lines.push(`- ${item}`);
  }
  lines.push("");
}

/**
 * Assemble formatted narrative prose from extracted components.
 * Mirrors narrative._assemble_narrative_text.
 */
function assembleNarrativeText(
  memoryCount: number,
  decisions: string[],
  events: string[],
  entities: string[],
  topics: string[],
  directory: string,
  periodLabel: string
): string {
  const lines: string[] = [];

  let header = "# Project Narrative";
  if (directory) header += ` — ${directory}`;
  if (periodLabel) header += ` (${periodLabel})`;
  lines.push(header, "");

  lines.push(`Based on ${memoryCount} memories.`, "");

  appendSection(lines, "## Key Decisions", decisions.slice(0, DISPLAY_LIMIT));
  appendSection(lines, "## Significant Events", events.slice(0, DISPLAY_LIMIT));

  if (entities.length > 0) {
    lines.push("## Key Entities");
    lines.push(entities.join(", "));
    lines.push("");
  }

  appendSection(lines, "## Current Focus", topics);

  if (decisions.length === 0 && events.length === 0 && topics.length === 0) {
    lines.push("*No significant activity recorded in this period.*");
  }

  return lines.join("\n");
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Generate a project narrative from a set of memories.
 * Mirrors narrative.generate_narrative.
 *
 * Returns:
 *   - narrative: formatted prose string
 *   - decisions: list of decision strings
 *   - events: list of event strings
 *   - entities: list of top entity names
 *   - topics: list of hot topic strings
 *   - arc: Proppian structural arc (orientation / complication / resolution)
 *   - memory_count: total memories analysed
 */
export function generateNarrative(
  memories: MemoryRecord[],
  directory = "",
  periodLabel = ""
): NarrativeResponse {
  const decisions = extractDecisions(memories);
  const events = extractEvents(memories);
  const entities = extractTopEntities(memories);
  const topics = extractHotTopics(memories);
  const arc = detectArc(memories);

  const narrative = assembleNarrativeText(
    memories.length,
    decisions,
    events,
    entities,
    topics,
    directory,
    periodLabel
  );

  return {
    narrative,
    decisions,
    events,
    entities,
    topics,
    arc,
    memory_count: memories.length,
  };
}

/**
 * Generate a one-paragraph brief summary for context injection.
 * Mirrors narrative.generate_brief_summary.
 *
 * This function is pure and synchronous.  For the optional LLM
 * prose-polish pass use generateBriefSummaryWithPolish().
 *
 * source: mcp_server/core/narrative.py — max_chars default = 300
 */
export function generateBriefSummary(
  memories: MemoryRecord[],
  maxChars = BRIEF_SUMMARY_MAX_CHARS
): string {
  const decisions = extractDecisions(memories);
  const events = extractEvents(memories);
  const topics = extractHotTopics(memories, DEFAULT_HEAT_THRESHOLD, BRIEF_TOPICS_LIMIT);

  const parts: string[] = [];
  if (topics.length > 0) parts.push(`Focus: ${topics.slice(0, BRIEF_TOPICS_LIMIT).join(", ")}`);
  if (decisions.length > 0) parts.push(`Decisions: ${decisions.slice(0, BRIEF_DISPLAY_LIMIT).join("; ")}`);
  if (events.length > 0) parts.push(`Events: ${events.slice(0, BRIEF_DISPLAY_LIMIT).join("; ")}`);

  let summary = parts.join(". ");
  if (summary.length <= maxChars) return summary;

  const truncated = summary.slice(0, maxChars - ELLIPSIS_RESERVE);
  const lastEnd = Math.max(
    truncated.lastIndexOf(". "),
    truncated.lastIndexOf("! "),
    truncated.lastIndexOf("? ")
  );

  if (lastEnd > Math.floor(maxChars / SENTENCE_BOUNDARY_DIVISOR)) {
    return truncated.slice(0, lastEnd + 1);
  }

  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > Math.floor(maxChars / SENTENCE_BOUNDARY_DIVISOR)) {
    return truncated.slice(0, lastSpace) + "...";
  }

  return truncated + "...";
}

// ── LLM prose-polish pass ──────────────────────────────────────────────────

/**
 * System prompt for the brief-summary prose-polish LLM pass.
 *
 * source: mcp_server/core/context_assembly/active_retrieval.py:53-65
 *         (the llm_fn pattern — structured data in, fluent prose out;
 *          the concrete prompt below is reconstructed for the brief-summary
 *          use-case: Cortex f2b9f99 has no dedicated narrative-polish file)
 */
const BRIEF_POLISH_SYSTEM =
  "You are a technical writing assistant. You receive a structured context " +
  "summary (Focus, Decisions, Events) and rewrite it as a single fluent " +
  "paragraph of ≤60 words. Preserve every factual claim. Return only the " +
  "paragraph — no headings, no bullet points.";

/**
 * Optional LLM prose-polish wrapper around generateBriefSummary.
 *
 * Precondition:  memories is a (possibly empty) array of MemoryRecord.
 * Postcondition: if llmClient is non-null, returns the LLM-rewritten
 *                paragraph; otherwise returns generateBriefSummary(memories).
 * Invariant:     the structural extraction is always performed first; the
 *                LLM only rewrites — it does not add facts.
 *
 * source: mcp_server/core/context_assembly/active_retrieval.py:53-65
 *         (reconstructed — see BRIEF_POLISH_SYSTEM note above)
 * source: mcp_server/core/narrative.py — max_chars default = 300
 */
export async function generateBriefSummaryWithPolish(
  memories: MemoryRecord[],
  llmClient: LlmClient | null,
  maxChars = BRIEF_SUMMARY_MAX_CHARS
): Promise<string> {
  const structural = generateBriefSummary(memories, maxChars);

  if (llmClient === null || structural.length === 0) {
    return structural;
  }

  return llmClient.complete({
    system: BRIEF_POLISH_SYSTEM,
    prompt: `Rewrite as a single fluent paragraph (≤60 words):\n\n${structural}`,
    // source: https://docs.anthropic.com/en/api/messages — 256 tokens ample for ≤60-word paragraph
    maxTokens: 256, // source: https://docs.anthropic.com/en/api/messages — brief summary token ceiling
    temperature: PROSE_POLISH_TEMPERATURE,
  });
}

// ── Arc structural validator ───────────────────────────────────────────────

/**
 * Return the ordered sequence of function types present in the arc.
 * Grammar: orientation < complication < resolution.
 * Used by tests to assert arc shape without coupling to prose content.
 */
export function arcFunctionSequence(
  arc: NarrativeArc
): NarrativeFunctionType[] {
  const seq: NarrativeFunctionType[] = [];
  if (arc.orientation !== undefined) seq.push("orientation");
  if (arc.complication !== undefined) seq.push("complication");
  if (arc.resolution !== undefined) seq.push("resolution");
  return seq;
}

export type { NarrativeFunction };
