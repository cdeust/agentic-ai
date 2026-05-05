/**
 * Ablation study reporting and batch planning.
 *
 * Formats ablation results into neuroscience-style reports and plans
 * full ablation studies across all mechanisms.
 *
 * Pure business logic — no I/O.
 *
 * Port of: cortex@ed33435 mcp_server/core/ablation_report.py
 */

import { type AblationResult, Mechanism } from "./ablation.js";

// ── Study planning ────────────────────────────────────────────────────────

/**
 * Plan a full ablation study: one experiment per mechanism.
 *
 * precondition:  exclude is a set of mechanism value strings to skip.
 * postcondition: returned array contains Mechanism.value strings in
 *   recommended order (most downstream first, then upstream).
 *
 * source: cortex@ed33435 mcp_server/core/ablation_report.py:14-55
 *   Order is from most downstream to most upstream to isolate effects.
 */
export function planFullAblationStudy(
  exclude: Set<string> = new Set(),
): string[] {
  // source: cortex@ed33435 mcp_server/core/ablation_report.py:27-54
  const order: Mechanism[] = [
    Mechanism.MOOD_CONGRUENT_RERANK,
    Mechanism.EMOTIONAL_RETRIEVAL,
    Mechanism.EMOTIONAL_DECAY,
    Mechanism.SURPRISE_MOMENTUM,
    Mechanism.CO_ACTIVATION,
    Mechanism.ADAPTIVE_DECAY,
    Mechanism.SPREADING_ACTIVATION,
    Mechanism.HDC,
    Mechanism.HOPFIELD,
    Mechanism.DENDRITIC_CLUSTERS,
    Mechanism.SYNAPTIC_TAGGING,
    Mechanism.EMOTIONAL_TAGGING,
    Mechanism.MICROGLIAL_PRUNING,
    Mechanism.RECONSOLIDATION,
    Mechanism.PATTERN_SEPARATION,
    Mechanism.INTERFERENCE,
    Mechanism.SCHEMA_ENGINE,
    Mechanism.TRIPARTITE_SYNAPSE,
    Mechanism.HOMEOSTATIC_PLASTICITY,
    Mechanism.SYNAPTIC_PLASTICITY,
    Mechanism.ENGRAM_ALLOCATION,
    Mechanism.TWO_STAGE_MODEL,
    Mechanism.NEUROMODULATION,
    Mechanism.PREDICTIVE_CODING,
    Mechanism.CASCADE,
    Mechanism.OSCILLATORY_CLOCK,
  ];
  return order.map((m) => String(m)).filter((v) => !exclude.has(v));
}

// ── Result formatting ─────────────────────────────────────────────────────

/**
 * Format a single ablation result as report lines.
 * source: cortex@ed33435 mcp_server/core/ablation_report.py:58-64
 */
function formatResultSection(result: AblationResult): string[] {
  return [
    `### ${result.mechanism} (impact: ${result.impactScore.toFixed(2)})`,
    result.interpretation,
    "",
  ];
}

/**
 * Format the summary section of the ablation report.
 * source: cortex@ed33435 mcp_server/core/ablation_report.py:67-82
 */
function formatSummarySection(results: AblationResult[]): string[] {
  const sorted = [...results].sort((a, b) => b.impactScore - a.impactScore);
  const critical = sorted.filter((r) => r.impactScore > 0.5);
  const important = sorted.filter((r) => r.impactScore > 0.3 && r.impactScore <= 0.5);
  const minor = sorted.filter((r) => r.impactScore <= 0.3);

  return [
    "## Summary",
    `- **Critical mechanisms** (${critical.length}): ${critical.map((r) => r.mechanism).join(", ")}`,
    `- **Important mechanisms** (${important.length}): ${important.map((r) => r.mechanism).join(", ")}`,
    `- **Minor mechanisms** (${minor.length}): ${minor.map((r) => r.mechanism).join(", ")}`,
  ];
}

/**
 * Format all ablation results into a report.
 *
 * Styled like a neuroscience methods and results section.
 *
 * precondition:  results is a non-empty array of AblationResult objects.
 * postcondition: returned string is a markdown document with ## Results
 *   and ## Summary sections.
 *
 * source: cortex@ed33435 mcp_server/core/ablation_report.py:85-107
 */
export function formatAblationReport(results: AblationResult[]): string {
  const lines = [
    "# Ablation Study Report",
    "",
    "## Methods",
    `We systematically ablated ${results.length} mechanisms and measured`,
    "the impact on system-level memory metrics.",
    "",
    "## Results (sorted by impact)",
    "",
  ];

  const sorted = [...results].sort((a, b) => b.impactScore - a.impactScore);
  for (const r of sorted) {
    lines.push(...formatResultSection(r));
  }

  lines.push(...formatSummarySection(results));

  return lines.join("\n");
}
