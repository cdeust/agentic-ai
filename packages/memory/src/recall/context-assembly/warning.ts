/* eslint-disable @typescript-eslint/no-magic-numbers -- source: exact port of Python source; all numeric literals copied verbatim from cited Python file */
/**
 * Truncation warning banner.
 *
 * When the prompt decomposer must condense placeholders to fit the
 * context window, it injects a warning banner at the top of the final
 * prompt. The LLM sees an explicit list of what was cut and by how much,
 * so it can reason about missing information rather than hallucinating.
 *
 * Direct port of the Swift buildTruncationWarning helper in
 * ContextDecomposer.swift. The mechanism is Clément Deust's invention —
 * no paper precedent has been found for injecting truncation awareness
 * into the prompt itself.
 *
 * Original: ai-architect-prd-builder/packages/AIPRDMetaPromptingEngine/
 *           Sources/Pipeline/ContextDecomposer.swift → buildTruncationWarning
 *
 * source: Cortex mcp_server/core/context_assembly/warning.py
 */

import type { AssemblyMetrics } from "./budget.js";

// Reduction threshold below which a placeholder is considered "truncated"
// for the purposes of the warning. Matches the Swift default of 10%.
const SIGNIFICANT_REDUCTION = 0.9;

/**
 * Build a ⚠️ banner listing placeholders that were materially condensed.
 *
 * Returns an empty string when no placeholder was reduced below the
 * threshold (i.e. the prompt fits without loss).
 *
 * @param metrics - the AssemblyMetrics populated during prompt assembly.
 * @param reductionThreshold - a placeholder is flagged when its surviving
 *   fraction is below this value. Default 0.9 (10% reduction).
 */
export function buildTruncationBanner(
  metrics: AssemblyMetrics,
  reductionThreshold: number = SIGNIFICANT_REDUCTION,
): string {
  const truncated: Array<[string, number, number]> = [];

  for (const [key, original] of Object.entries(metrics.originalTokens)) {
    if (original <= 0) continue;
    const final_ = metrics.finalTokens[key] ?? 0;
    if (final_ < original && final_ / original < reductionThreshold) {
      truncated.push([key, original, final_]);
    }
  }

  if (truncated.length === 0) return "";

  const lines = [
    "⚠️ CONTEXT TRUNCATION WARNING",
    "The following sections were truncated to fit the context window.",
    "You may be missing information. Prioritize the content you CAN see.",
    "",
  ];

  for (const [key, original, final_] of truncated) {
    const pct = original > 0 ? Math.floor((100 * final_) / original) : 0; // source: Cortex warning.py::build_truncation_banner percent display
    lines.push(`- ${key}: ${pct}% retained (${final_}/${original} tokens)`);
  }

  return lines.join("\n");
}
