/**
 * Episodic/semantic memory classification via regex heuristics.
 *
 * Classifies memories as "episodic" (specific events with line numbers, paths,
 * timestamps) or "semantic" (general knowledge with decision/architecture/
 * convention keywords). Used to weight retrieval results.
 *
 * NOTE: This module implements a keyword-based text classifier. The
 * episodic/semantic distinction is conceptually aligned with Complementary
 * Learning Systems (CLS) theory, but the implementation mechanism (regex)
 * bears no relationship to CLS's computational model (neural network learning).
 *
 * Pure business logic — no I/O.
 *
 * Port of: cortex@ed33435 mcp_server/core/dual_store_cls.py
 */

// ── Classification patterns ───────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/dual_store_cls.py:26-58

const SEMANTIC_TAGS = new Set([
  "rule", "convention", "preference", "standard", "architecture",
  "principle", "pattern", "guideline", "policy", "best-practice",
]);

const DECISION_RE = /\b(always|never|prefer|standard|must|should|convention|rule)\b/i;
const INSTRUCTION_RE = /\b(from now on|going forward|remember to|please always|i want you to|make sure to|do not ever|whenever you|every time you|respond in|use only|stick to)\b/i;
const ARCHITECTURE_RE = /\b(pattern|design|principle|paradigm|architecture|layer|module)\b/i;
const SPECIFIC_RE = /(line \d+|\.py:\d+|\.js:\d+|\.ts:\d+|traceback|0x[0-9a-f]+|\/Users\/|\/home\/|\/tmp\/|\.log\b|\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/i;

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Classify content as 'episodic' or 'semantic' via regex heuristics.
 *
 * Resolution order:
 *   1. Tag-based: semantic tags → "semantic"
 *   2. Specificity override: line numbers, paths, tracebacks → "episodic"
 *   3. Content keywords: decision/architecture words → "semantic"
 *   4. Default: "episodic"
 *
 * precondition:  content is a string; tags is an optional string array.
 * postcondition: returns "episodic" or "semantic".
 *
 * source: cortex@ed33435 mcp_server/core/dual_store_cls.py:62-90
 */
export function classifyMemory(
  content: string,
  tags: string[] | null = null,
  _directory = "",
): "episodic" | "semantic" {
  const tagSet = new Set((tags ?? []).map((t) => t.toLowerCase()));

  // 1. Tag-based
  for (const t of tagSet) {
    if (SEMANTIC_TAGS.has(t)) return "semantic";
  }

  // 2. Specificity override
  if (SPECIFIC_RE.test(content)) return "episodic";

  // 3. Content keywords
  if (DECISION_RE.test(content) || ARCHITECTURE_RE.test(content) || INSTRUCTION_RE.test(content)) {
    return "semantic";
  }

  return "episodic";
}

/**
 * Determine episodic vs semantic weighting from query text.
 *
 * precondition:  query is a string.
 * postcondition: returns [episodicWeight, semanticWeight]; each >= 1.
 *
 * source: cortex@ed33435 mcp_server/core/dual_store_cls.py:96-111
 */
export function autoWeight(query: string): [number, number] {
  const hasSpecific = SPECIFIC_RE.test(query);
  const hasSemantic = DECISION_RE.test(query) || ARCHITECTURE_RE.test(query);

  if (hasSpecific) return [2.0, 1.0];
  if (hasSemantic) return [1.0, 2.0];
  return [1.0, 1.0];
}
