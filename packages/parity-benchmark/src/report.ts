/**
 * Comparison report — TS measured scores vs frozen Python baseline.
 *
 * Per Cortex design doc §8, the regression gate fails when any floor metric
 * drops by more than the documented tolerance (default 0.5 percentage points).
 *
 * source: cortex/benchmarks/results/a3_locomo_post_refactor.md (gate definition)
 */

import type { BenchmarkScores, CategoryScores } from "./scoring.js";
import type { CortexBaseline, BaselineCategoryMetrics } from "./baselines.js";

export interface MetricDelta {
  readonly metric: string;
  readonly category: string;
  readonly measured: number;
  readonly baseline: number;
  /** measured - baseline; positive = improvement, negative = regression. */
  readonly delta_pp: number;
  readonly within_tolerance: boolean;
}

export interface ParityReport {
  readonly benchmark: string;
  readonly dataset: string;
  readonly captured_from: string;
  readonly tolerance_pp: number;
  readonly deltas: readonly MetricDelta[];
  readonly passed: boolean;
}

// source: cortex design doc §8 — convert ratio delta to percentage points.
function toPP(deltaRatio: number): number {
  return Math.round(deltaRatio * 1000) / 10;
}

function compareOne(
  metric: keyof BaselineCategoryMetrics,
  category: string,
  measured: CategoryScores,
  baseline: BaselineCategoryMetrics,
  toleranceRatio: number,
): MetricDelta | null {
  const baselineVal = baseline[metric];
  if (typeof baselineVal !== "number") return null;
  const measuredVal =
    metric === "mrr"
      ? measured.mrr
      : metric === "recall_at_5"
        ? measured.recall_at_5
        : metric === "recall_at_10"
          ? measured.recall_at_10
          : null;
  if (measuredVal === null) return null;
  const deltaRatio = measuredVal - baselineVal;
  return {
    metric: String(metric),
    category,
    measured: measuredVal,
    baseline: baselineVal,
    delta_pp: toPP(deltaRatio),
    within_tolerance: deltaRatio >= -toleranceRatio,
  };
}

/**
 * Build a parity report by diffing measured BenchmarkScores against the loaded baseline.
 *
 * precondition: scores and baseline cover the same categories (extras allowed; missing keys ignored).
 * postcondition: report.passed is true iff every measured metric is within tolerance
 *   (i.e. the regression direction; improvements always pass).
 */
export function buildParityReport(
  measured: BenchmarkScores,
  baseline: CortexBaseline,
): ParityReport {
  // source: cortex design doc §8 — pp tolerance converted back to ratio for math.
  const toleranceRatio = baseline.tolerance_pp / 100;
  const deltas: MetricDelta[] = [];
  for (const metric of ["mrr", "recall_at_5", "recall_at_10"] as const) {
    const overallDelta = compareOne(metric, "overall", measured.overall, baseline.overall, toleranceRatio);
    if (overallDelta) deltas.push(overallDelta);
  }
  for (const [cat, baselineCat] of Object.entries(baseline.by_category)) {
    const measuredCat = measured.by_category[cat];
    if (!measuredCat) continue;
    for (const metric of ["mrr", "recall_at_5", "recall_at_10"] as const) {
      const d = compareOne(metric, cat, measuredCat, baselineCat, toleranceRatio);
      if (d) deltas.push(d);
    }
  }
  return {
    benchmark: baseline.benchmark,
    dataset: baseline.dataset,
    captured_from: `${baseline.captured_from.repo}@${baseline.captured_from.commit} (${baseline.captured_from.date})`,
    tolerance_pp: baseline.tolerance_pp,
    deltas,
    passed: deltas.every((d) => d.within_tolerance),
  };
}

function formatPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function formatMRR(v: number): string {
  return v.toFixed(3);
}

function formatDelta(d: MetricDelta): string {
  const v = d.metric === "mrr" ? formatMRR(d.measured) : formatPct(d.measured);
  const b = d.metric === "mrr" ? formatMRR(d.baseline) : formatPct(d.baseline);
  const sign = d.delta_pp >= 0 ? "+" : "";
  const status = d.within_tolerance ? "PASS" : "FAIL";
  return `  ${d.category.padEnd(16)} ${d.metric.padEnd(12)}  ${v} vs ${b}  Δ=${sign}${d.delta_pp}pp  ${status}`;
}

/**
 * Render a parity report as a human-readable text block.
 *
 * source: cortex/benchmarks/results/a3_locomo_post_refactor.md — table format.
 */
export function renderReport(report: ParityReport): string {
  const lines: string[] = [];
  lines.push(`╔══════════════════════════════════════════════════════════════════╗`);
  lines.push(`║ Parity Benchmark — ${report.benchmark.padEnd(46)} ║`);
  lines.push(`╚══════════════════════════════════════════════════════════════════╝`);
  lines.push(`Dataset:        ${report.dataset}`);
  lines.push(`Baseline:       ${report.captured_from}`);
  lines.push(`Tolerance:      ±${report.tolerance_pp}pp (per Cortex design doc §8)`);
  lines.push(``);
  lines.push(`  category         metric        measured  baseline  delta  status`);
  lines.push(`  ──────────────── ────────────  ────────  ────────  ─────  ──────`);
  for (const d of report.deltas) {
    lines.push(formatDelta(d));
  }
  lines.push(``);
  lines.push(report.passed ? `RESULT: PASS — all metrics within tolerance.` : `RESULT: FAIL — at least one metric regressed beyond tolerance.`);
  return lines.join("\n");
}
