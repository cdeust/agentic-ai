/**
 * Detect coverage gaps in cognitive domain profiles.
 *
 * Three blind spot types:
 *   - Category: work categories appearing in <5% of sessions
 *   - Tool: tools relevant to domain categories but rarely used
 *   - Pattern: missing exploration, deep-work, or quick-iteration sessions
 *
 * Pure business logic — no I/O.
 *
 * source: cortex@ed33435 mcp_server/core/blindspot_detector.py
 */

import type { BlindSpot } from "./types.js";
import {
  checkDurationGaps,
  checkExplorationGap,
  countDurationBuckets,
} from "./blindspot-patterns.js";

// ── Category and tool constants ───────────────────────────────────────────────

/**
 * All known work categories.
 * source: cortex@ed33435 mcp_server/core/blindspot_detector.py ALL_CATEGORIES (via CATEGORY_RULES)
 */
export const ALL_CATEGORIES = [
  "bug-fix",
  "feature",
  "refactor",
  "testing",
  "docs",
  "research",
  "architecture",
  "debug",
  "config",
  "deployment",
] as const;

export type WorkCategory = typeof ALL_CATEGORIES[number];

/**
 * Common tools to check for blind spots.
 * source: cortex@ed33435 mcp_server/core/blindspot_detector.py COMMON_TOOLS
 */
export const COMMON_TOOLS = [
  "Read",
  "Edit",
  "Write",
  "Grep",
  "Glob",
  "Bash",
  "Agent",
  "WebSearch",
  "WebFetch",
] as const;

/**
 * Relevance mapping: which categories each tool is relevant to.
 * source: cortex@ed33435 mcp_server/core/blindspot_detector.py TOOL_CATEGORY_RELEVANCE
 */
export const TOOL_CATEGORY_RELEVANCE: Readonly<Record<string, readonly string[]>> = {
  Read: ["bug-fix", "research", "debug", "refactor", "docs"],
  Edit: ["bug-fix", "feature", "refactor", "config"],
  Write: ["feature", "docs", "config"],
  Grep: ["bug-fix", "debug", "refactor", "research"],
  Glob: ["refactor", "architecture", "config"],
  Bash: ["testing", "deployment", "debug", "config"],
  Agent: ["research", "architecture"],
  WebSearch: ["research", "architecture"],
  WebFetch: ["research", "docs"],
};

// ── Conversation record shape ─────────────────────────────────────────────────

export interface ConversationRecord {
  toolsUsed?: string[];
  tools?: unknown[];
  toolCalls?: unknown[];
  category?: string;
  categories?: string[];
  allText?: string;
  firstMessage?: string;
  durationMinutes?: number;
  duration?: number;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

const TEST_RE =
  /\b(test|spec|assert|expect|xct|xctest|jest|pytest|mocha)\b/i;

function getToolsUsed(conv: ConversationRecord): string[] {
  const raw = conv.toolsUsed ?? conv.tools ?? conv.toolCalls ?? [];
  return (raw as unknown[])
    .map((t) =>
      typeof t === "string" ? t : ((t as Record<string, unknown>)?.["name"] as string | undefined) ?? "",
    )
    .filter(Boolean) as string[];
}

function categorizeText(text: string): Set<string> {
  const lower = text.toLowerCase();
  const scores = new Set<string>();
  const rules: Array<[string, string[]]> = [
    ["bug-fix", ["fix", "bug", "error", "crash", "regression"]],
    ["feature", ["feature", "implement", "add", "new", "build"]],
    ["refactor", ["refactor", "cleanup", "restructure", "move", "rename"]],
    ["testing", ["test", "spec", "assert", "coverage", "jest", "vitest", "pytest"]],
    ["docs", ["docs", "documentation", "readme", "comment"]],
    ["research", ["research", "explore", "investigate", "analyze", "study"]],
    ["architecture", ["architecture", "design", "pattern", "system", "service"]],
    ["debug", ["debug", "trace", "log", "inspect", "diagnose"]],
    ["config", ["config", "configuration", "env", "setting"]],
    ["deployment", ["deploy", "release", "ship", "publish", "ci", "cd"]],
  ];
  for (const [cat, keywords] of rules) {
    if (keywords.some((kw) => lower.includes(kw))) scores.add(cat);
  }
  return scores;
}

function getCategories(conv: ConversationRecord): Set<string> {
  if (Array.isArray(conv.categories) && conv.categories.length > 0) {
    return new Set(conv.categories);
  }

  const text = conv.allText ?? conv.firstMessage ?? "";
  if (text) {
    const result = categorizeText(text);
    const tools = getToolsUsed(conv);
    if (tools.includes("Bash") && TEST_RE.test(text.toLowerCase())) {
      result.add("testing");
    }
    if (result.size > 0) return result;
  }

  if (typeof conv.category === "string" && conv.category) {
    return new Set([conv.category]);
  }
  return new Set();
}

function getTopDomainCategories(
  conversations: ConversationRecord[],
  topN = 3,
): string[] {
  const counts: Record<string, number> = {};
  for (const conv of conversations) {
    for (const cat of getCategories(conv)) {
      counts[cat] = (counts[cat] ?? 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([cat]) => cat);
}

function globalExplorationRatio(allConversations: ConversationRecord[]): number {
  if (allConversations.length === 0) return 0;
  const explorationCats = new Set(["research", "architecture"]);
  const count = allConversations.filter(
    (conv) => [...getCategories(conv)].some((c) => explorationCats.has(c)),
  ).length;
  return count / allConversations.length;
}

// ── Detection functions ───────────────────────────────────────────────────────

/**
 * Detect category blind spots (<5% threshold).
 * source: cortex@ed33435 mcp_server/core/blindspot_detector.py _detect_category_blind_spots:115-138
 */
function detectCategoryBlindSpots(
  domainConversations: ConversationRecord[],
): BlindSpot[] {
  const total = domainConversations.length;
  if (total === 0) return [];

  const spots: BlindSpot[] = [];
  for (const category of ALL_CATEGORIES) {
    const sessionsWith = domainConversations.filter((conv) =>
      getCategories(conv).has(category),
    ).length;
    const ratio = sessionsWith / total;
    if (ratio < 0.05) {
      spots.push({
        type: "category",
        value: category,
        severity: ratio < 0.01 ? "high" : "medium",
        description: `Category "${category}" appears in only ${(ratio * 100).toFixed(1)}% of sessions (threshold: 5%).`,
        suggestion: `Consider intentionally including ${category} work in this domain to broaden coverage.`,
      });
    }
  }
  return spots;
}

/**
 * Detect tool blind spots for tools relevant to domain but rarely used.
 * source: cortex@ed33435 mcp_server/core/blindspot_detector.py _detect_tool_blind_spots:141-176
 */
function detectToolBlindSpots(
  domainConversations: ConversationRecord[],
  topDomainCategories: string[],
): BlindSpot[] {
  const total = domainConversations.length;
  if (total === 0) return [];

  const topCatSet = new Set(topDomainCategories);
  const spots: BlindSpot[] = [];

  for (const tool of COMMON_TOOLS) {
    const sessionsUsing = domainConversations.filter((conv) =>
      getToolsUsed(conv).includes(tool),
    ).length;
    const ratio = sessionsUsing / total;
    if (ratio >= 0.05) continue;

    const relevantCategories = TOOL_CATEGORY_RELEVANCE[tool] ?? [];
    const isRelevant = relevantCategories.some((cat) => topCatSet.has(cat));
    if (!isRelevant) continue;

    const overlap = relevantCategories.filter((cat) => topCatSet.has(cat));
    const severity = overlap.length >= 2 || ratio < 0.01 ? "high" : "medium";

    spots.push({
      type: "tool",
      value: tool,
      severity,
      description: `Tool "${tool}" used in only ${(ratio * 100).toFixed(1)}% of sessions, yet is relevant to domain categories: ${overlap.join(", ")}.`,
      suggestion: `Incorporate "${tool}" more regularly in ${topDomainCategories.join("/")} tasks to leverage its full potential.`,
    });
  }
  return spots;
}

/**
 * Detect pattern blind spots: missing exploration, deep-work, quick-iteration.
 * source: cortex@ed33435 mcp_server/core/blindspot_detector.py _detect_pattern_blind_spots:179-210
 */
function detectPatternBlindSpots(
  domainConversations: ConversationRecord[],
  allConversations: ConversationRecord[],
): BlindSpot[] {
  const total = domainConversations.length;
  if (total === 0) return [];

  const explorationCats = new Set(["research", "architecture"]);
  const domainExplorationCount = domainConversations.filter(
    (conv) => [...getCategories(conv)].some((cat) => explorationCats.has(cat)),
  ).length;
  const globalExpRatio = globalExplorationRatio(allConversations);

  const spots: BlindSpot[] = checkExplorationGap(
    domainExplorationCount / total,
    globalExpRatio,
  );

  const [domainShort, domainLong] = countDurationBuckets(domainConversations);
  const [globalShort, globalLong] = countDurationBuckets(allConversations);
  const globalTotal = allConversations.length || 1;

  spots.push(
    ...checkDurationGaps(
      total,
      domainShort,
      domainLong,
      globalShort / globalTotal,
      globalLong / globalTotal,
    ),
  );

  return spots;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Detect blind spots for a single domain.
 *
 * precondition: domainConversations is the array for this domain only;
 *               allConversations includes all domains (used for global ratios)
 * postcondition: returns a flat array of BlindSpot entries (no duplicates within type)
 *
 * source: cortex@ed33435 mcp_server/core/blindspot_detector.py:218-231
 */
export function detectBlindSpotsFull(
  domainConversations: ConversationRecord[],
  allConversations: ConversationRecord[],
): BlindSpot[] {
  const topCategories = getTopDomainCategories(domainConversations);

  return [
    ...detectCategoryBlindSpots(domainConversations),
    ...detectToolBlindSpots(domainConversations, topCategories),
    ...detectPatternBlindSpots(domainConversations, allConversations),
  ];
}
