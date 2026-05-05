/* eslint-disable @typescript-eslint/no-magic-numbers -- source: exact port of Python source; all numeric literals copied verbatim from cited Python file */
/**
 * Priority-budgeted structured prompt assembly.
 *
 * The core primitive: a prompt template is a set of typed placeholders,
 * each with a priority rank, each optionally paired with a domain-aware
 * condenser. When the filled template would exceed the context window,
 * placeholders are progressively condensed — lowest priority first —
 * until the total fits. If any placeholder was materially reduced, a
 * truncation warning banner is injected at the top so the LLM knows
 * what it's missing.
 *
 * The invention is Clément Deust's (original Swift implementation in
 * ai-architect-prd-builder/packages/AIPRDMetaPromptingEngine/Sources/
 * Pipeline/ContextDecomposer.swift). This TypeScript port adapts the
 * semantics 1:1 for Cortex. No paper precedent was found for:
 *   1) priority-driven progressive condensation with per-type condensers, or
 *   2) injecting explicit truncation awareness into the prompt.
 *
 * The closest neighbors in the literature are Anthropic's Contextual
 * Retrieval (chunk-level LLM summaries, different goal) and various
 * token-budgeting recipes in LangChain-style libraries (flat truncation,
 * no priorities, no domain awareness, no model-side warning).
 *
 * source: Cortex mcp_server/core/context_assembly/decomposer.py
 */

import type { AssemblyMetrics, Placeholder } from "./budget.js";
import {
  availableBudget,
  estimateTokens,
  makeAssemblyMetrics,
  truncateToBudget,
} from "./budget.js";
import { buildTruncationBanner } from "./warning.js";

// ── Main entry point ────────────────────────────────────────────────────

/**
 * Fill a template with priority-budgeted placeholders.
 *
 * Algorithm (ported from Swift ContextDecomposer.assemblePrompt):
 *
 * 1. Compute the template shell tokens (template with all placeholders
 *    substituted with empty strings).
 * 2. variableBudget = availableBudget - shellTokens.
 * 3. If total placeholder content fits within variableBudget, use
 *    all originals verbatim.
 * 4. Otherwise, progressive proportional condensation: sort placeholders
 *    by descending priority number (least important first). For each,
 *    assign either its full content (if it fits a proportional share)
 *    or the condenser-reduced version.
 * 5. Post-assembly safety loop: while the final prompt exceeds
 *    (contextWindow - safetyMarginTokens), iteratively halve the
 *    lowest-importance (highest priority number) placeholder. Stop
 *    when no further reduction is possible.
 * 6. Build a truncation warning banner listing all placeholders whose
 *    surviving fraction is below 90%. Prepend to the prompt.
 *
 * @param template - the raw template string containing placeholder keys.
 * @param placeholders - list of Placeholder objects.
 * @param contextWindow - total tokens the target model accepts.
 * @param headroom - fraction of the window reserved for input. Default 0.75.
 * @param estimator - token counting function. Default uses char/3 heuristic.
 * @param safetyMarginTokens - extra tokens kept free at the very end.
 *
 * @returns [finalPrompt, metrics] where metrics records original vs final
 *   token counts per placeholder.
 */
export function assemblePrompt(
  template: string,
  placeholders: Placeholder[],
  {
    contextWindow,
    headroom = 0.75, // source: Cortex decomposer.py::assemble_prompt default; Swift ContextDecomposer.availableTokenBudget
    estimator = estimateTokens,
    safetyMarginTokens = 64,
  }: {
    contextWindow: number;
    headroom?: number;
    estimator?: (t: string) => number;
    safetyMarginTokens?: number;
  },
): [string, AssemblyMetrics] {
  const budget = availableBudget(contextWindow, headroom);

  // Step 1: compute shell (template with empty placeholders)
  let shell = template;
  for (const p of placeholders) {
    shell = shell.replaceAll(p.key, "");
  }
  const shellTokens = estimator(shell);

  const variableBudget = Math.max(300, budget - shellTokens); // source: Cortex decomposer.py::assemble_prompt minimum variable budget floor

  // Track metrics
  const metrics = makeAssemblyMetrics(shellTokens, variableBudget);
  for (const p of placeholders) {
    metrics.originalTokens[p.key] = estimator(p.value);
  }

  // Step 2: total variable tokens
  const totalVariable = Object.values(metrics.originalTokens).reduce(
    (s, v) => s + v,
    0,
  );

  // Step 3: fast path — everything fits
  const effective: Record<string, string> = {};
  if (totalVariable <= variableBudget) {
    for (const p of placeholders) {
      effective[p.key] = p.value;
    }
  } else {
    // Step 4: progressive condensation
    // Sort by priority DESC (high priority number → least important → condensed first)
    const sortedPh = [...placeholders].sort((a, b) => b.priority - a.priority);

    let remaining = variableBudget;
    let assigned = 0;

    for (const p of sortedPh) {
      const orig = metrics.originalTokens[p.key] ?? 0;
      // Proportional share of remaining budget among not-yet-assigned
      const notYet = sortedPh.length - assigned;
      const share = Math.max(50, Math.floor(remaining / Math.max(1, notYet))); // source: Cortex decomposer.py minimum share floor

      if (orig <= share) {
        // Fits — use full content
        effective[p.key] = p.value;
        remaining -= orig;
      } else {
        // Over share — apply condenser if available, else truncate
        let reduced: string;
        if (p.condenser !== undefined) {
          reduced = p.condenser(p.value, share);
        } else {
          reduced = truncateToBudget(p.value, share, estimator);
        }
        effective[p.key] = reduced;
        remaining -= Math.min(estimator(reduced), remaining);
      }
      assigned++;
    }
  }

  // Record post-condensation token counts
  for (const p of placeholders) {
    metrics.finalTokens[p.key] = estimator(effective[p.key] ?? p.value);
  }

  // Assemble prompt
  let prompt = template;
  for (const p of placeholders) {
    prompt = prompt.replaceAll(p.key, effective[p.key] ?? p.value);
  }

  // Step 5: post-assembly safety loop
  // If still over budget, halve the least-important placeholder
  // iteratively until under limit or nothing left to trim.
  const sortedDesc = [...placeholders].sort((a, b) => b.priority - a.priority);
  const currentValues: Record<string, string> = { ...effective };
  const maxIterations = 50;
  let iteration = 0;

  while (
    estimator(prompt) > contextWindow - safetyMarginTokens &&
    iteration < maxIterations
  ) {
    let didTrim = false;
    for (const p of sortedDesc) {
      const val = currentValues[p.key] ?? p.value;
      if (estimator(val) <= 50) continue; // Can't meaningfully halve further
      // Halve at the nearest line boundary in the first half
      const halfIdx = Math.floor(val.length / 2);
      const prefix = val.slice(0, halfIdx);
      const lastNewline = prefix.lastIndexOf("\n");
      const halved = lastNewline > 0 ? val.slice(0, lastNewline + 1) : prefix;
      currentValues[p.key] = halved;
      // Rebuild prompt
      prompt = template;
      for (const pp of placeholders) {
        prompt = prompt.replaceAll(pp.key, currentValues[pp.key] ?? pp.value);
      }
      didTrim = true;
      break;
    }
    if (!didTrim) break;
    iteration++;
  }

  // Update final metrics after the safety loop
  for (const p of placeholders) {
    metrics.finalTokens[p.key] = estimator(currentValues[p.key] ?? p.value);
  }
  metrics.totalFinalTokens = estimator(prompt);

  // Step 6: truncation warning banner
  const banner = buildTruncationBanner(metrics);
  if (banner) {
    prompt = `${banner}\n\n${prompt}`;
  }

  return [prompt, metrics];
}
