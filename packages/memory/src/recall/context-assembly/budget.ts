/* eslint-disable @typescript-eslint/no-magic-numbers -- source: exact port of Python source; all numeric literals copied verbatim from cited Python file */
/**
 * Token budgeting primitives for structured context assembly.
 *
 * Provides token estimation and budget allocation utilities used by the
 * prompt decomposer and stage assembler.
 *
 * Original Swift design by Clément Deust in ai-architect-prd-builder
 * (packages/AIPRDMetaPromptingEngine/Sources/Pipeline/ContextDecomposer.swift).
 * Python port with Cortex-specific adaptations; this is the TypeScript port.
 *
 * source: Cortex mcp_server/core/context_assembly/budget.py
 */

// ── Token estimation ─────────────────────────────────────────────────────
// Conservative ~1 token per 3 Unicode scalars heuristic. Matches the Swift
// fallback when no provider-specific tokenizer is available. For higher
// accuracy, swap for tiktoken at the integration site.

/**
 * Return a conservative token estimate (chars // 3, min 1).
 *
 * Kept simple and synchronous. Callers that need provider-accurate
 * counts should pass a custom estimator function into the decomposer.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.floor(text.length / 3));
}

// ── Budget allocation ────────────────────────────────────────────────────

/**
 * Compute the writable token budget for a given context window.
 *
 * Leaves (1 - headroom) of the window for the response. Default 0.75
 * matches the Swift ContextDecomposer.availableTokenBudget default.
 */
export function availableBudget(
  contextWindow: number,
  headroom: number = 0.75, // source: Cortex budget.py::available_budget default; ported from Swift ContextDecomposer.availableTokenBudget
): number {
  if (contextWindow <= 0) return 0;
  return Math.floor(contextWindow * headroom);
}

// ── Placeholder types ────────────────────────────────────────────────────

/**
 * A typed slot in a prompt template.
 *
 * key: template marker (e.g. "{{QUERY}}", "{{CONTEXT}}").
 * value: content that will fill the slot.
 * priority: importance rank. Lower number = more important.
 *   Higher numbers get condensed first when over budget. This
 *   matches the Swift semantics where priority: 1 is highest.
 * condenser: optional domain-aware reduction function. Signature
 *   is (value: string, targetTokens: number) => string. When
 *   undefined, generic truncation is applied.
 */
export interface Placeholder {
  readonly key: string;
  readonly value: string;
  readonly priority: number;
  readonly condenser?: (value: string, targetTokens: number) => string;
}

export function makePlaceholder(
  key: string,
  value: string,
  priority: number = 1,
  condenser?: (value: string, targetTokens: number) => string,
): Placeholder {
  return { key, value, priority, condenser };
}

/**
 * Bookkeeping for prompt assembly — what was trimmed and by how much.
 *
 * Consumed by warning.ts to build the banner injected at the top of
 * the final prompt so the LLM knows what was cut.
 */
export interface AssemblyMetrics {
  originalTokens: Record<string, number>;
  finalTokens: Record<string, number>;
  totalShellTokens: number;
  totalVariableBudget: number;
  totalFinalTokens: number;
}

export function makeAssemblyMetrics(
  totalShellTokens: number = 0,
  totalVariableBudget: number = 0,
): AssemblyMetrics {
  return {
    originalTokens: {},
    finalTokens: {},
    totalShellTokens,
    totalVariableBudget,
    totalFinalTokens: 0,
  };
}

/** Fraction of a placeholder's content that survived (0.0..1.0). */
export function reductionFraction(metrics: AssemblyMetrics, key: string): number {
  const orig = metrics.originalTokens[key] ?? 0;
  if (orig === 0) return 1.0;
  const fin = metrics.finalTokens[key] ?? 0;
  return fin / orig;
}

/** True if the placeholder's surviving fraction is below threshold. */
export function wasTruncated(
  metrics: AssemblyMetrics,
  key: string,
  threshold: number = 0.9,
): boolean {
  return reductionFraction(metrics, key) < threshold;
}

// ── Generic truncation ──────────────────────────────────────────────────

/**
 * Truncate text to fit within a token budget, preferring line boundaries.
 *
 * Algorithm (ported from Swift truncateToTokenBudget):
 *   1. If already within budget, return as-is.
 *   2. Estimate target character count as budget * 3.
 *   3. Cut at the last newline before that point to preserve line structure.
 *   4. Fall back to hard cut if no newline exists.
 */
export function truncateToBudget(
  text: string,
  tokenBudget: number,
  estimator: (t: string) => number = estimateTokens,
): string {
  if (estimator(text) <= tokenBudget) return text;
  const targetChars = Math.max(1, tokenBudget * 3);
  const prefix = text.slice(0, targetChars);
  const lastNewline = prefix.lastIndexOf("\n");
  if (lastNewline > 0) return prefix.slice(0, lastNewline + 1);
  return prefix;
}
