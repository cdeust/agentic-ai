/**
 * Retrieval scoring — MRR + Recall@K math.
 *
 * Pure business logic — no I/O. Mirrors the formulas in
 * cortex/benchmarks/locomo/run_benchmark.py:115-117.
 *
 * source: Robertson, S. (2008). "On the variance of the average precision."
 *   J. Doc. 64(1):5-19 — the canonical Recall@K + MRR definitions used in IR.
 * source: cortex@1ef1376 benchmarks/locomo/run_benchmark.py:print_results
 */

/** A single per-question retrieval outcome. */
export interface QuestionResult {
  /** Category bucket (e.g. "single_hop", "multi_hop"). */
  readonly category: string;
  /**
   * Rank (1-based) of the first relevant retrieval. Null when no relevant
   * memory was returned within top_k. Matches the Python `hit_rank` field.
   */
  readonly hit_rank: number | null;
}

/** Aggregated metrics for one category. */
export interface CategoryScores {
  /** Mean Reciprocal Rank — sum(1/rank) / N over hits, missed counted as 0. */
  readonly mrr: number;
  /** Fraction of questions whose first relevant hit is in top 5. */
  readonly recall_at_5: number;
  /** Fraction of questions whose first relevant hit is in top 10. */
  readonly recall_at_10: number;
  /** Number of questions in this category. */
  readonly questions: number;
}

/** Full benchmark result aggregated across categories. */
export interface BenchmarkScores {
  readonly overall: CategoryScores;
  readonly by_category: Record<string, CategoryScores>;
}

// source: cortex@1ef1376 run_benchmark.py:115-117 — sum(1.0/r["hit_rank"]).
function reciprocalRank(rank: number | null): number {
  return rank !== null && rank > 0 ? 1.0 / rank : 0.0;
}

// source: cortex@1ef1376 run_benchmark.py:116-117 — recall@K is hit_rank ≤ K.
function isHitWithinK(rank: number | null, k: number): boolean {
  return rank !== null && rank > 0 && rank <= k;
}

function aggregateCategory(results: readonly QuestionResult[]): CategoryScores {
  const n = results.length;
  if (n === 0) {
    return { mrr: 0, recall_at_5: 0, recall_at_10: 0, questions: 0 };
  }
  let rrSum = 0;
  let r5 = 0;
  let r10 = 0;
  for (const r of results) {
    rrSum += reciprocalRank(r.hit_rank);
    if (isHitWithinK(r.hit_rank, 5)) r5++;
    if (isHitWithinK(r.hit_rank, 10)) r10++;
  }
  return {
    mrr: rrSum / n,
    recall_at_5: r5 / n,
    recall_at_10: r10 / n,
    questions: n,
  };
}

/**
 * Compute per-category and overall MRR + Recall@5 + Recall@10.
 *
 * precondition: results is a finite array; each hit_rank is null or a positive integer.
 * postcondition: returned scores satisfy 0 ≤ value ≤ 1; questions counts are non-negative integers.
 *
 * source: cortex@1ef1376 run_benchmark.py:109-131 — same aggregation order.
 */
export function scoreResults(results: readonly QuestionResult[]): BenchmarkScores {
  const byCategory: Record<string, QuestionResult[]> = {};
  for (const r of results) {
    const list = byCategory[r.category] ?? (byCategory[r.category] = []);
    list.push(r);
  }
  const categories: Record<string, CategoryScores> = {};
  for (const [cat, list] of Object.entries(byCategory)) {
    categories[cat] = aggregateCategory(list);
  }
  return {
    overall: aggregateCategory(results),
    by_category: categories,
  };
}
