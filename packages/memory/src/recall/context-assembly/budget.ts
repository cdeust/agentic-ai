/* eslint-disable @typescript-eslint/no-magic-numbers */
/**
 * Token budgeting primitives for structured context assembly.
 *
 * Port of: cortex@ed33435 mcp_server/core/context_assembly/budget.py
 *
 * Provides token estimation and budget allocation utilities used by the
 * prompt decomposer and stage assembler.
 *
 * Original Swift design by Clément Deust in ai-architect-prd-builder
 * (packages/AIPRDMetaPromptingEngine/Sources/Pipeline/ContextDecomposer.swift).
 * Python port with Cortex-specific adaptations, then ported to TS here.
 */

// ── Token estimation ───────────────────────────────────────────────────────
// Conservative ~1 token per 3 Unicode scalars heuristic. Matches the Swift
// fallback when no provider-specific tokenizer is available.
// source: cortex@ed33435 mcp_server/core/context_assembly/budget.py:23-31

/**
 * Return a conservative token estimate (chars // 3, min 1).
 *
 * Port of: cortex@ed33435 mcp_server/core/context_assembly/budget.py::estimate_tokens
 *
 * postcondition: result >= 0; result == 0 iff text is empty
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.floor(text.length / 3)); // source: cortex@ed33435 budget.py:30 — chars // 3, min 1
}

// ── Budget allocation ──────────────────────────────────────────────────────

/**
 * Compute the writable token budget for a given context window.
 *
 * Leaves (1 - headroom) of the window for the response. Default 0.75
 * matches the Swift ContextDecomposer.availableTokenBudget default.
 *
 * Port of: cortex@ed33435 mcp_server/core/context_assembly/budget.py::available_budget
 *
 * source: cortex@ed33435 mcp_server/core/context_assembly/budget.py:38
 *   headroom = 0.75 (leaves 25% for response)
 */
export function availableBudget(
  contextWindow: number,
  headroom = 0.75, // source: cortex@ed33435 budget.py:38 — Swift ContextDecomposer default
): number {
  if (contextWindow <= 0) return 0;
  return Math.floor(contextWindow * headroom);
}

// ── Truncation ─────────────────────────────────────────────────────────────

/**
 * Truncate text to fit within a token budget, preferring line boundaries.
 *
 * Port of: cortex@ed33435 mcp_server/core/context_assembly/budget.py::truncate_to_budget
 *
 * Algorithm (ported from Swift truncateToTokenBudget):
 *   1. If already within budget, return as-is.
 *   2. Estimate target character count as budget * 3.
 *   3. Cut at the last newline before that point to preserve line structure.
 *   4. Fall back to hard cut if no newline exists.
 *
 * precondition: tokenBudget >= 0
 * postcondition: estimateTokens(result) <= tokenBudget
 */
export function truncateToBudget(text: string, tokenBudget: number): string {
  if (estimateTokens(text) <= tokenBudget) return text;
  const targetChars = Math.max(1, tokenBudget * 3); // source: cortex@ed33435 budget.py:57 — budget * 3
  const slice = text.slice(0, targetChars);
  const lastNewline = slice.lastIndexOf("\n");
  if (lastNewline > 0) {
    return slice.slice(0, lastNewline).trimEnd();
  }
  return slice.trimEnd();
}
