/**
 * Felder-Silverman cognitive style classification from session behavior.
 *
 * Multi-dimensional classification:
 *   - Active/Reflective: tool edit/read ratios + duration + keywords
 *   - Sensing/Intuitive: concrete vs abstract keywords + file counts
 *   - Sequential/Global: file access non-linearity + refactor keywords
 * Plus categorical: problemDecomposition, explorationStyle, verificationBehavior.
 *
 * Pure business logic — no I/O.
 *
 * source: cortex@ed33435 mcp_server/core/style_classifier.py
 */

import type { CognitiveStyle } from "./types.js";

// ── Keyword lists ─────────────────────────────────────────────────────────────

/**
 * source: cortex@ed33435 mcp_server/core/style_classifier.py ABSTRACT_KEYWORDS:15-34
 */
export const ABSTRACT_KEYWORDS: readonly string[] = [
  "architecture",
  "pattern",
  "system",
  "design",
  "module",
  "abstraction",
  "principle",
  "paradigm",
  "framework",
  "conceptual",
  "high-level",
  "strategy",
  "tradeoff",
  "trade-off",
  "evolve",
  "scalable",
  "decoupled",
  "interface",
];

/**
 * source: cortex@ed33435 mcp_server/core/style_classifier.py CONCRETE_KEYWORDS:36-54
 */
export const CONCRETE_KEYWORDS: readonly string[] = [
  "example",
  "specifically",
  "instance",
  "step-by-step",
  "file",
  "line",
  "function",
  "variable",
  "output",
  "value",
  "exact",
  "literal",
  "actual",
  "current",
  "particular",
  "record",
  "entry",
];

/**
 * source: cortex@ed33435 mcp_server/core/style_classifier.py PLANNING_KEYWORDS:56-70
 */
export const PLANNING_KEYWORDS: readonly string[] = [
  "plan",
  "strategy",
  "before",
  "first",
  "outline",
  "design",
  "consider",
  "think",
  "review",
  "analyse",
  "analyze",
  "evaluate",
  "assess",
];

/**
 * source: cortex@ed33435 mcp_server/core/style_classifier.py TRIAL_KEYWORDS:72-84
 */
export const TRIAL_KEYWORDS: readonly string[] = [
  "try",
  "attempt",
  "test",
  "experiment",
  "quick",
  "iterate",
  "tweak",
  "adjust",
  "patch",
  "hack",
  "workaround",
];

// ── Test regex ────────────────────────────────────────────────────────────────

/**
 * source: cortex@ed33435 mcp_server/core/style_classifier.py _TEST_RE:86-89
 */
const TEST_RE =
  /\b(test|spec|assert|expect|xct|xctest|jest|pytest|mocha|coverage|tdd|unit.?test|integration.?test)\b/i;

// ── Conversation record type ──────────────────────────────────────────────────

export interface StyleConversationRecord {
  toolsUsed?: unknown[];
  tools?: unknown[];
  toolCalls?: unknown[];
  durationMinutes?: number;
  duration?: number;
  summary?: string;
  body?: string;
  title?: string;
  filesTouched?: unknown[];
  files?: unknown[];
  allText?: string;
  firstMessage?: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function countTool(conv: StyleConversationRecord, toolName: string): number {
  const raw = conv.toolsUsed ?? conv.tools ?? conv.toolCalls ?? [];
  return (raw as unknown[]).filter((t) => {
    const name = typeof t === "string" ? t : ((t as Record<string, unknown>)?.["name"] as string | undefined) ?? "";
    return name === toolName;
  }).length;
}

function totalToolCalls(conv: StyleConversationRecord): number {
  return (conv.toolsUsed ?? conv.tools ?? conv.toolCalls ?? []).length;
}

function countKeywords(text: string | undefined, keywords: readonly string[]): number {
  if (!text) return 0;
  const lower = text.toLowerCase();
  return keywords.filter((kw) => lower.includes(kw)).length;
}

function nonLinearityScore(conv: StyleConversationRecord): number {
  const files = conv.filesTouched ?? conv.files ?? [];
  if (files.length === 0) return 0;
  const dirs = new Set<string>();
  for (const f of files) {
    const parts = String(f).replace(/\\/g, "/").split("/");
    dirs.add(parts.length > 1 ? parts.slice(0, -1).join("/") : ".");
  }
  return dirs.size / files.length;
}

function clamp(v: number): number {
  return Math.max(-1.0, Math.min(1.0, v));
}

// ── Dimension scorers ─────────────────────────────────────────────────────────

/**
 * Score the active/reflective axis across conversations.
 * source: cortex@ed33435 mcp_server/core/style_classifier.py _score_active_reflective:128-166
 */
function scoreActiveReflective(conversations: StyleConversationRecord[]): number {
  if (conversations.length === 0) return 0;
  let totalScore = 0;
  let counted = 0;

  for (const conv of conversations) {
    const total = totalToolCalls(conv);
    const dur = conv.durationMinutes ?? conv.duration ?? 0;
    const summary = conv.summary ?? conv.body ?? conv.title ?? "";
    let score = 0;
    let signals = 0;

    if (dur > 0) {
      if (dur < 10) { score += 1; signals += 1; }
      else if (dur > 30) { score -= 1; signals += 1; }
    }

    if (total > 0) {
      const editCount = countTool(conv, "Edit") + countTool(conv, "Write");
      const readCount = countTool(conv, "Read") + countTool(conv, "Grep");
      if (editCount / total > 0.4) { score += 1; signals += 1; }
      if (readCount / total > 0.4) { score -= 1; signals += 1; }
    }

    const trial = countKeywords(summary, TRIAL_KEYWORDS);
    const plan = countKeywords(summary, PLANNING_KEYWORDS);
    if (trial > plan) { score += 0.5; signals += 0.5; }
    else if (plan > trial) { score -= 0.5; signals += 0.5; }

    if (signals > 0) {
      totalScore += score / signals;
      counted++;
    }
  }

  return counted > 0 ? clamp(totalScore / counted) : 0;
}

/**
 * Score the sensing/intuitive axis.
 * source: cortex@ed33435 mcp_server/core/style_classifier.py _score_sensing_intuitive:169-192
 */
function scoreSensingIntuitive(conversations: StyleConversationRecord[]): number {
  if (conversations.length === 0) return 0;
  let totalScore = 0;
  let counted = 0;

  for (const conv of conversations) {
    const summary = conv.summary ?? conv.body ?? conv.title ?? "";
    const files = (conv.filesTouched ?? conv.files ?? []).length;
    let score = 0;
    let signals = 0;

    const concrete = countKeywords(summary, CONCRETE_KEYWORDS);
    const abstract = countKeywords(summary, ABSTRACT_KEYWORDS);
    if (concrete > 0 || abstract > 0) {
      const net = concrete - abstract;
      const mx = Math.max(concrete, abstract);
      score += net / mx;
      signals += 1;
    }

    if (files > 5) { score += 0.5; signals += 0.5; }

    if (signals > 0) {
      totalScore += score / signals;
      counted++;
    }
  }

  return counted > 0 ? clamp(totalScore / counted) : 0;
}

/**
 * Score the sequential/global axis.
 * source: cortex@ed33435 mcp_server/core/style_classifier.py _score_sequential_global:195-226
 */
function scoreSequentialGlobal(conversations: StyleConversationRecord[]): number {
  if (conversations.length === 0) return 0;
  let totalScore = 0;
  let counted = 0;

  const refactorTerms = ["refactor", "restructure", "rename", "move", "reorganize"];

  for (const conv of conversations) {
    const nl = nonLinearityScore(conv);
    const total = totalToolCalls(conv);
    const summary = conv.summary ?? conv.body ?? conv.title ?? "";
    const files = (conv.filesTouched ?? conv.files ?? []).length;
    let score = 0;
    let signals = 0;

    if (files > 0) {
      score += 1 - 2 * nl;
      signals += 1;
    }

    if (countKeywords(summary, refactorTerms) > 0) {
      score -= 0.5;
      signals += 0.5;
    }

    if (total > 0 && files > 0) {
      const cpf = total / files;
      if (cpf < 2) { score -= 0.5; signals += 0.5; }
      else if (cpf > 6) { score += 0.5; signals += 0.5; }
    }

    if (signals > 0) {
      totalScore += score / signals;
      counted++;
    }
  }

  return counted > 0 ? clamp(totalScore / counted) : 0;
}

// ── Categorical classifiers ───────────────────────────────────────────────────

/**
 * Classify problem decomposition style.
 * source: cortex@ed33435 mcp_server/core/style_classifier.py _classify_problem_decomposition:229-251
 */
function classifyProblemDecomposition(conversations: StyleConversationRecord[]): string {
  if (conversations.length === 0) return "top-down";
  let topDown = 0;
  let bottomUp = 0;

  for (const conv of conversations) {
    const summary = conv.summary ?? conv.body ?? conv.title ?? "";
    const planHits = countKeywords(summary, PLANNING_KEYWORDS);
    const readFirst =
      countTool(conv, "Read") + countTool(conv, "Grep") + countTool(conv, "Glob");
    const editCount = countTool(conv, "Edit") + countTool(conv, "Write");

    if (planHits > 2 && editCount > readFirst) topDown++;
    else if (readFirst > editCount) bottomUp++;
    else if (planHits > 0) topDown++;
    else bottomUp++;
  }

  return topDown >= bottomUp ? "top-down" : "bottom-up";
}

/**
 * Classify exploration style.
 * source: cortex@ed33435 mcp_server/core/style_classifier.py _classify_exploration_style:254-271
 */
function classifyExplorationStyle(conversations: StyleConversationRecord[]): string {
  if (conversations.length === 0) return "depth-first";
  let depth = 0;
  let breadth = 0;

  for (const conv of conversations) {
    const total = totalToolCalls(conv);
    const files = (conv.filesTouched ?? conv.files ?? []).length;
    if (files === 0 || total === 0) continue;
    const cpf = total / files;
    if (cpf > 5) depth++;
    else if (cpf < 3) breadth++;
  }

  if (depth === breadth) return "depth-first";
  return depth > breadth ? "depth-first" : "breadth-first";
}

/**
 * Classify verification behavior.
 * source: cortex@ed33435 mcp_server/core/style_classifier.py _classify_verification_behavior:274-298
 */
function classifyVerificationBehavior(conversations: StyleConversationRecord[]): string {
  if (conversations.length === 0) return "no-test";
  let testFirst = 0;
  let testAfter = 0;
  let noTest = 0;

  for (const conv of conversations) {
    const bash = countTool(conv, "Bash");
    const reads = countTool(conv, "Read") + countTool(conv, "Grep");
    const edits = countTool(conv, "Edit") + countTool(conv, "Write");
    const text = conv.allText ?? conv.firstMessage ?? "";
    const hasTest = TEST_RE.test(text);

    if (bash === 0 && !hasTest) noTest++;
    else if (hasTest && reads >= edits) testFirst++;
    else if (hasTest || bash > 0) testAfter++;
    else noTest++;
  }

  if (noTest >= testFirst && noTest >= testAfter) return "no-test";
  if (testFirst >= testAfter) return "test-first";
  return "test-after";
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Classify Felder-Silverman cognitive style from conversations.
 *
 * precondition: conversations is an array (may be empty)
 * postcondition: all numeric axes in [-1, 1]; categorical labels are non-empty strings
 *
 * source: cortex@ed33435 mcp_server/core/style_classifier.py:301-311
 */
export function classifyStyle(conversations: unknown): CognitiveStyle {
  const convs = Array.isArray(conversations)
    ? (conversations as StyleConversationRecord[])
    : [];
  return {
    activeReflective: scoreActiveReflective(convs),
    sensingIntuitive: scoreSensingIntuitive(convs),
    sequentialGlobal: scoreSequentialGlobal(convs),
    problemDecomposition: classifyProblemDecomposition(convs),
    explorationStyle: classifyExplorationStyle(convs),
    verificationBehavior: classifyVerificationBehavior(convs),
  };
}
