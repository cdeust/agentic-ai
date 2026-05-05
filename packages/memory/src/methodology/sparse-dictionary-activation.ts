/**
 * Activation extraction for behavioral feature dictionary.
 *
 * Extracts 27D activation vectors from conversation records.
 * Dimensions: tool ratios (7), keyword densities (4), temporal signals (5),
 * derived (1), category scores (10).
 *
 * Pure business logic — no I/O.
 *
 * Port of: cortex@ed33435 mcp_server/core/sparse_dictionary_activation.py
 */

import {
  ABSTRACT_KEYWORDS,
  CONCRETE_KEYWORDS,
  PLANNING_KEYWORDS,
  TRIAL_KEYWORDS,
} from "./style-classifier.js";
import { zeros } from "../shared/linear-algebra.js";

// ── Signal names ──────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/sparse_dictionary_activation.py:24-57

export const TOOL_SIGNALS = [
  "tool:Read", "tool:Edit", "tool:Write", "tool:Grep", "tool:Glob", "tool:Bash", "tool:Agent",
] as const;

export const KEYWORD_SIGNALS = [
  "kw:abstract", "kw:concrete", "kw:planning", "kw:trial",
] as const;

export const TEMPORAL_SIGNALS = [
  "tmp:duration", "tmp:turnCount", "tmp:burst", "tmp:exploration", "tmp:fileSpread",
] as const;

export const DERIVED_SIGNALS = ["drv:editReadRatio"] as const;

export const CATEGORY_NAMES = [
  "cat:bug-fix", "cat:feature", "cat:refactoring", "cat:testing",
  "cat:documentation", "cat:devops", "cat:code-review",
  "cat:debugging", "cat:architecture", "cat:general",
] as const;

export const SIGNAL_NAMES = [
  ...TOOL_SIGNALS, ...KEYWORD_SIGNALS, ...TEMPORAL_SIGNALS,
  ...DERIVED_SIGNALS, ...CATEGORY_NAMES,
] as const;

/** Number of signal dimensions = 27. source: cortex@ed33435 mcp_server/core/sparse_dictionary_activation.py:58 */
export const D = SIGNAL_NAMES.length;

// ── Category keyword map ──────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/sparse_dictionary_activation.py:64-75

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  "bug-fix": ["fix", "bug", "error", "issue", "crash", "broken"],
  feature: ["add", "implement", "create", "new", "feature"],
  refactoring: ["refactor", "clean", "restructure", "rename", "move"],
  testing: ["test", "spec", "coverage", "assert", "expect"],
  documentation: ["doc", "readme", "comment", "explain"],
  devops: ["deploy", "ci", "docker", "build", "pipeline"],
  "code-review": ["review", "check", "audit", "inspect"],
  debugging: ["debug", "trace", "log", "inspect", "breakpoint"],
  architecture: ["architecture", "design", "pattern", "module", "layer"],
  general: [],
};

// ── Helper functions ──────────────────────────────────────────────────────

/**
 * Count density of keyword hits in text.
 * source: cortex@ed33435 mcp_server/core/sparse_dictionary_activation.py:83-90
 */
function countKeywordDensity(text: string | null | undefined, keywords: readonly string[]): number {
  if (!text) return 0.0;
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/).length || 1;
  const hits = keywords.filter((kw) => lower.includes(kw)).length;
  return hits / words;
}

/**
 * Count occurrences of a named tool in a tool usage list.
 * source: cortex@ed33435 mcp_server/core/sparse_dictionary_activation.py:93-99
 */
function countTool(tools: unknown[], name: string): number {
  let count = 0;
  for (const t of tools) {
    if (typeof t === "string") { if (t === name) count++; }
    else if (t && typeof t === "object") {
      if (((t as Record<string, unknown>)["name"] ?? "") === name) count++;
    }
  }
  return count;
}

function extractToolRatios(activation: number[], tools: unknown[]): void {
  const total = tools.length || 1;
  const toolNames = ["Read", "Edit", "Write", "Grep", "Glob", "Bash", "Agent"];
  for (let i = 0; i < toolNames.length; i++) {
    activation[i] = countTool(tools, toolNames[i]!) / total;
  }
}

function extractKeywordDensities(activation: number[], text: string | null | undefined): void {
  activation[7] = countKeywordDensity(text, ABSTRACT_KEYWORDS);
  activation[8] = countKeywordDensity(text, CONCRETE_KEYWORDS);
  activation[9] = countKeywordDensity(text, PLANNING_KEYWORDS);
  activation[10] = countKeywordDensity(text, TRIAL_KEYWORDS);
}

function extractTemporalSignals(
  activation: number[],
  conv: Record<string, unknown>,
  tools: unknown[],
): void {
  const duration = (conv["duration"] as number | undefined) ?? 0;
  activation[11] = Math.min(duration / 3600000, 1);
  activation[12] = Math.min(((conv["turnCount"] as number | undefined) ?? 0) / 50, 1);
  activation[13] = (duration > 0 && duration < 600000) ? 1 : 0;
  activation[14] = ((conv["turnCount"] as number | undefined) ?? 0) > 20 ? 1 : 0;

  const total = tools.length || 1;
  const globCount = countTool(tools, "Glob");
  const readCount = countTool(tools, "Read");
  activation[15] = Math.min((globCount + readCount) / total, 1);
}

function extractDerivedRatio(activation: number[], tools: unknown[]): void {
  const editCount = countTool(tools, "Edit") + countTool(tools, "Write");
  const readGrep = countTool(tools, "Read") + countTool(tools, "Grep");
  activation[16] = readGrep > 0 ? editCount / readGrep : (editCount > 0 ? 1 : 0);
}

function extractCategoryScores(activation: number[], text: string): void {
  const lowerText = text.toLowerCase();
  let anyCat = false;
  const categories = Object.keys(CATEGORY_KEYWORDS);
  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i]!;
    const kws = CATEGORY_KEYWORDS[cat]!;
    if (kws.length === 0) continue;
    const score = kws.filter((kw) => lowerText.includes(kw)).length;
    activation[17 + i] = Math.min(score / kws.length, 1);
    if (score > 0) anyCat = true;
  }
  if (!anyCat) activation[26] = 0.5;
}

// ── Main extraction function ──────────────────────────────────────────────

/**
 * Extract a 27D activation vector from a conversation record.
 *
 * precondition:  conversation is a dict with optional toolsUsed, allText,
 *   firstMessage, duration, turnCount fields.
 * postcondition: returned array has D = 27 elements, each ∈ [0, 1]
 *   except editReadRatio which may exceed 1.
 *
 * source: cortex@ed33435 mcp_server/core/sparse_dictionary_activation.py:168-180
 */
export function extractSessionActivation(
  conversation: Record<string, unknown>,
): number[] {
  const activation = zeros(D);
  const tools = ((conversation["toolsUsed"]) as unknown[] | undefined) ?? [];
  const text = ((conversation["allText"] ?? conversation["firstMessage"]) as string | undefined) ?? "";

  extractToolRatios(activation, tools);
  extractKeywordDensities(activation, text);
  extractTemporalSignals(activation, conversation, tools);
  extractDerivedRatio(activation, tools);
  extractCategoryScores(activation, text);

  return activation;
}
