/**
 * Unit tests for the MRR + Recall@K math.
 *
 * Verifies the TS scoring matches Python's per-question and per-category
 * aggregation byte-for-byte on hand-computed cases.
 *
 * source: cortex@1ef1376 benchmarks/locomo/run_benchmark.py:115-117 — formulas.
 */

import { describe, expect, it } from "vitest";
import { scoreResults } from "../src/scoring.js";
import { buildParityReport } from "../src/report.js";
import type { CortexBaseline } from "../src/baselines.js";

describe("scoreResults — MRR math", () => {
  it("returns 0 for an empty result set", () => {
    const s = scoreResults([]);
    expect(s.overall.mrr).toBe(0);
    expect(s.overall.questions).toBe(0);
  });

  it("computes MRR = 1/rank averaged over questions", () => {
    // Hits at ranks 1, 2, 4, miss → MRR = (1 + 1/2 + 1/4 + 0) / 4 = 0.4375
    const s = scoreResults([
      { category: "single_hop", hit_rank: 1 },
      { category: "single_hop", hit_rank: 2 },
      { category: "single_hop", hit_rank: 4 },
      { category: "single_hop", hit_rank: null },
    ]);
    expect(s.overall.mrr).toBeCloseTo(0.4375, 6);
  });

  it("counts misses (hit_rank=null) as reciprocal-rank 0", () => {
    const s = scoreResults([
      { category: "x", hit_rank: null },
      { category: "x", hit_rank: null },
    ]);
    expect(s.overall.mrr).toBe(0);
    expect(s.overall.recall_at_5).toBe(0);
    expect(s.overall.recall_at_10).toBe(0);
  });
});

describe("scoreResults — Recall@K", () => {
  it("rank 5 counts as Recall@5 hit but rank 6 does not", () => {
    const s = scoreResults([
      { category: "x", hit_rank: 5 },
      { category: "x", hit_rank: 6 },
    ]);
    expect(s.overall.recall_at_5).toBe(0.5);
    expect(s.overall.recall_at_10).toBe(1.0);
  });

  it("rank 10 counts as Recall@10 hit but rank 11 does not", () => {
    const s = scoreResults([
      { category: "x", hit_rank: 10 },
      { category: "x", hit_rank: 11 },
    ]);
    expect(s.overall.recall_at_10).toBe(0.5);
  });
});

describe("scoreResults — by_category", () => {
  it("aggregates per-category and overall independently", () => {
    const s = scoreResults([
      { category: "a", hit_rank: 1 },
      { category: "a", hit_rank: 2 },
      { category: "b", hit_rank: null },
      { category: "b", hit_rank: 3 },
    ]);
    expect(s.by_category["a"]?.mrr).toBeCloseTo(0.75, 6); // (1 + 1/2) / 2
    expect(s.by_category["b"]?.mrr).toBeCloseTo(1 / 6, 6); // (0 + 1/3) / 2
    expect(s.by_category["a"]?.questions).toBe(2);
    expect(s.by_category["b"]?.questions).toBe(2);
    expect(s.overall.questions).toBe(4);
  });
});

describe("buildParityReport", () => {
  const baseline: CortexBaseline = {
    benchmark: "test",
    dataset: "tiny",
    tolerance_pp: 0.5,
    captured_from: { repo: "cortex", commit: "abc1234", date: "2026-01-01" },
    overall: { mrr: 0.8, recall_at_5: 0.85, recall_at_10: 0.9 },
    by_category: {},
  };

  it("passes when measured equals baseline", () => {
    const measured = scoreResults([
      // 10 perfect hits → MRR = 1.0; we'll bend baseline to match.
      ...Array.from({ length: 10 }, () => ({ category: "x", hit_rank: 1 as number | null })),
    ]);
    const r = buildParityReport(measured, {
      ...baseline,
      overall: { mrr: 1.0, recall_at_5: 1.0, recall_at_10: 1.0 },
    });
    expect(r.passed).toBe(true);
  });

  it("fails when overall MRR drops by more than tolerance_pp", () => {
    // Measured MRR = 0.5; baseline 0.8 → drop = 30pp ≫ 0.5pp tolerance.
    const measured = scoreResults([{ category: "x", hit_rank: 2 }]);
    const r = buildParityReport(measured, baseline);
    expect(r.passed).toBe(false);
    expect(r.deltas.find((d) => d.metric === "mrr" && d.category === "overall")?.within_tolerance).toBe(false);
  });

  it("passes improvements (positive delta) regardless of magnitude", () => {
    // Measured 100%; baseline 50%; +50pp must NOT fail (regression gate is one-sided).
    const measured = scoreResults([{ category: "x", hit_rank: 1 }]);
    const r = buildParityReport(measured, {
      ...baseline,
      overall: { mrr: 0.5, recall_at_5: 0.5, recall_at_10: 0.5 },
    });
    expect(r.passed).toBe(true);
  });
});
