/**
 * Frozen Python Cortex baseline scores loader.
 *
 * The JSON files under parity-oracle/cortex/baselines/ capture the published
 * Python scores at a specific commit. The TS port must reproduce them within
 * the documented tolerance (default 0.5pp per Cortex design doc §8).
 *
 * source: cortex/benchmarks/results/a3_locomo_post_refactor.md
 * source: cortex/benchmarks/results/a3_longmemeval_post_refactor.md
 */

import { readFileSync } from "node:fs";

/** Metrics shape captured in the baselines JSON. */
export interface BaselineCategoryMetrics {
  readonly mrr: number;
  readonly recall_at_5?: number;
  readonly recall_at_10: number;
  readonly questions?: number;
}

export interface CortexBaseline {
  readonly benchmark: string;
  readonly dataset: string;
  readonly tolerance_pp: number;
  readonly captured_from: { readonly repo: string; readonly commit: string; readonly date: string };
  readonly overall: BaselineCategoryMetrics;
  readonly by_category: Record<string, BaselineCategoryMetrics>;
}

/**
 * Load a Cortex baseline JSON.
 *
 * precondition: path points to a JSON file in the schema written by
 *   parity-oracle/cortex/baselines/{locomo,longmemeval}.json.
 * postcondition: returned object has overall + by_category populated;
 *   every metric is in [0, 1].
 */
export function loadCortexBaseline(path: string): CortexBaseline {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as CortexBaseline;
}
