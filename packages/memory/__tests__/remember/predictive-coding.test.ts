/**
 * predictive-coding.test.ts — Unit tests for pure novelty functions.
 *
 * These are the primary correctness argument for the write gate —
 * pure functions with deterministic outputs.
 *
 * Each test is a local proof of the function's contract:
 * "given these inputs, the invariant holds."
 */

import { describe, expect, it } from "vitest";
import {
  computeEmbeddingNovelty,
  computeEntityNovelty,
  computeNoveltyScore,
  computeStructuralNovelty,
  computeTemporalNovelty,
  describeSignals,
  gateDecision,
} from "../../src/remember/predictive-coding.js";

describe("computeEmbeddingNovelty", () => {
  it("returns 0.5 for empty similarities (prior: uncertain)", () => {
    expect(computeEmbeddingNovelty([])).toBe(0.5);
  });

  it("returns 0.0 when the most similar memory is identical", () => {
    // postcondition: 1 - max([1.0]) = 0.0
    expect(computeEmbeddingNovelty([1.0])).toBe(0.0);
  });

  it("returns close to 1.0 when no similar memory exists", () => {
    // postcondition: 1 - max([0.01]) = 0.99
    expect(computeEmbeddingNovelty([0.01])).toBeCloseTo(0.99);
  });

  it("uses max of multiple similarities", () => {
    expect(computeEmbeddingNovelty([0.2, 0.8, 0.5])).toBeCloseTo(0.2);
  });

  it("clamps output to [0, 1]", () => {
    const v = computeEmbeddingNovelty([1.5]); // over-similarity
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });
});

describe("computeEntityNovelty", () => {
  it("returns 0.5 for empty entity list (prior: uncertain)", () => {
    expect(computeEntityNovelty([], new Set())).toBe(0.5);
  });

  it("returns 1.0 when all entities are new", () => {
    expect(computeEntityNovelty(["X", "Y"], new Set())).toBe(1.0);
  });

  it("returns 0.0 when all entities are known", () => {
    expect(computeEntityNovelty(["X", "Y"], new Set(["X", "Y"]))).toBe(0.0);
  });

  it("returns 0.5 when half are new", () => {
    expect(computeEntityNovelty(["X", "Y"], new Set(["X"]))).toBe(0.5);
  });
});

describe("computeTemporalNovelty", () => {
  it("returns 0.8 for null (no similar memory found)", () => {
    expect(computeTemporalNovelty(null)).toBe(0.8);
  });

  it("returns 0.0 for 0 hours (memory just written)", () => {
    expect(computeTemporalNovelty(0)).toBe(0.0);
  });

  it("returns exactly 1-exp(-1) for 24 hours", () => {
    const expected = 1 - Math.exp(-1);
    expect(computeTemporalNovelty(24)).toBeCloseTo(expected, 5);
  });

  it("approaches 1.0 for very long intervals", () => {
    expect(computeTemporalNovelty(10000)).toBeCloseTo(1.0, 3);
  });

  it("clamps to [0, 1]", () => {
    const v = computeTemporalNovelty(-1);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });
});

describe("computeStructuralNovelty", () => {
  it("returns 0.7 for empty recent contents (prior)", () => {
    expect(computeStructuralNovelty("some content", [])).toBe(0.7);
  });

  it("returns 0.0 for structurally identical content", () => {
    const c = "short";
    expect(computeStructuralNovelty(c, [c])).toBe(0.0);
  });

  it("returns > 0 for structurally different content", () => {
    const candidate = "# Heading\n```\ncode\n```\n- list item";
    const recent = ["short text without structure"];
    expect(computeStructuralNovelty(candidate, recent)).toBeGreaterThan(0);
  });
});

describe("computeNoveltyScore", () => {
  it("satisfies the weight invariant: weights sum to 1.0", () => {
    // 0.4 + 0.25 + 0.2 + 0.15 = 1.0 (convex combination)
    // A uniform input of x should produce score = x.
    const x = 0.6;
    expect(computeNoveltyScore(x, x, x, x)).toBeCloseTo(x, 5);
  });

  it("returns 0.0 for all-zero inputs", () => {
    expect(computeNoveltyScore(0, 0, 0, 0)).toBe(0.0);
  });

  it("returns 1.0 for all-one inputs", () => {
    expect(computeNoveltyScore(1, 1, 1, 1)).toBe(1.0);
  });

  it("weights embedding novelty most heavily (0.40)", () => {
    // Only embedding novelty = 1, rest = 0 → score = 0.40
    expect(computeNoveltyScore(1, 0, 0, 0)).toBeCloseTo(0.40, 5);
  });
});

describe("gateDecision", () => {
  it("returns (true, 'bypass') when bypass=true regardless of score", () => {
    const [ok, reason] = gateDecision(0, 0.9, true);
    expect(ok).toBe(true);
    expect(reason).toBe("bypass");
  });

  it("returns (true, 'high_novelty') when score >= threshold", () => {
    const [ok, reason] = gateDecision(0.5, 0.4, false);
    expect(ok).toBe(true);
    expect(reason).toBe("high_novelty");
  });

  it("returns (false, ...) when score < threshold", () => {
    const [ok, reason] = gateDecision(0.3, 0.4, false);
    expect(ok).toBe(false);
    expect(reason).toContain("below_threshold");
  });

  it("includes threshold in rejection reason", () => {
    const [, reason] = gateDecision(0.1, 0.4, false);
    expect(reason).toContain("0.4");
  });
});

describe("describeSignals", () => {
  it("rounds all values to 4 decimal places", () => {
    const result = describeSignals(0.12345, 0.6789, 0.33333, 0.11111, 0.55555);
    expect(result["embedding_novelty"]).toBe(0.1235);
    expect(result["combined_novelty"]).toBe(0.5556);
  });

  it("includes all five keys", () => {
    const result = describeSignals(0.1, 0.2, 0.3, 0.4, 0.5);
    expect(Object.keys(result)).toHaveLength(5);
  });
});
