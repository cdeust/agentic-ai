/**
 * Tests for predictive-coding-flat.ts — 4-signal novelty computation.
 *
 * Invariant: all novelty signals return values in [0, 1].
 * Happy path: typical inputs produce expected values.
 * Error path: empty inputs produce defaults.
 */

import { describe, it, expect } from "vitest";
import {
  computeEmbeddingNovelty,
  computeEntityNovelty,
  computeTemporalNovelty,
  computeStructuralNovelty,
  computeNoveltyScore,
  describeSignals,
} from "../../src/recall/predictive-coding-flat.js";

// ── computeEmbeddingNovelty ───────────────────────────────────────────────

describe("computeEmbeddingNovelty", () => {
  it("returns 0.5 for empty similarities (no data)", () => {
    expect(computeEmbeddingNovelty([])).toBe(0.5);
  });

  it("returns 0.0 when max similarity is 1.0", () => {
    expect(computeEmbeddingNovelty([1.0, 0.5])).toBe(0.0);
  });

  it("returns 1.0 when max similarity is 0.0", () => {
    expect(computeEmbeddingNovelty([0.0, 0.0])).toBe(1.0);
  });

  it("returns intermediate value for partial similarity", () => {
    const novelty = computeEmbeddingNovelty([0.4]);
    expect(novelty).toBeCloseTo(0.6, 5);
  });
});

// ── computeEntityNovelty ──────────────────────────────────────────────────

describe("computeEntityNovelty", () => {
  it("returns 0.5 for empty entity list", () => {
    expect(computeEntityNovelty([], new Set(["A"]))).toBe(0.5);
  });

  it("returns 1.0 when all entities are new", () => {
    expect(computeEntityNovelty(["X", "Y"], new Set())).toBe(1.0);
  });

  it("returns 0.0 when all entities are known", () => {
    expect(computeEntityNovelty(["A", "B"], new Set(["A", "B"]))).toBe(0.0);
  });

  it("returns 0.5 when half new", () => {
    expect(computeEntityNovelty(["A", "B"], new Set(["A"]))).toBe(0.5);
  });
});

// ── computeTemporalNovelty ────────────────────────────────────────────────

describe("computeTemporalNovelty", () => {
  it("returns 0.8 for null (unknown = likely novel)", () => {
    expect(computeTemporalNovelty(null)).toBe(0.8);
  });

  it("returns 0.0 for 0 hours (just stored)", () => {
    expect(computeTemporalNovelty(0)).toBe(0.0);
  });

  it("returns value approaching 1.0 for large elapsed hours", () => {
    const novelty = computeTemporalNovelty(168); // 1 week
    expect(novelty).toBeGreaterThan(0.9);
    expect(novelty).toBeLessThanOrEqual(1.0);
  });

  it("is monotonically increasing with hours", () => {
    const n1 = computeTemporalNovelty(1);
    const n2 = computeTemporalNovelty(24);
    const n3 = computeTemporalNovelty(72);
    expect(n2).toBeGreaterThan(n1);
    expect(n3).toBeGreaterThan(n2);
  });
});

// ── computeStructuralNovelty ──────────────────────────────────────────────

describe("computeStructuralNovelty", () => {
  it("returns 0.7 for empty recent contents", () => {
    expect(computeStructuralNovelty("hello world", [])).toBe(0.7);
  });

  it("returns 0.0 for identical content", () => {
    const content = "hello world";
    expect(computeStructuralNovelty(content, [content])).toBe(0.0);
  });

  it("returns positive value for structurally different content", () => {
    const code = "```python\nprint('hello')\n```";
    const plain = "Just some plain text without any code blocks";
    const novelty = computeStructuralNovelty(code, [plain]);
    expect(novelty).toBeGreaterThan(0);
  });
});

// ── computeNoveltyScore ───────────────────────────────────────────────────

describe("computeNoveltyScore", () => {
  it("returns weighted sum in [0, 1]", () => {
    const score = computeNoveltyScore(0.8, 0.6, 0.5, 0.7);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it("returns 0 for all-zero inputs", () => {
    expect(computeNoveltyScore(0, 0, 0, 0)).toBe(0.0);
  });

  it("weights: embedding=0.40, entity=0.25, temporal=0.20, structural=0.15", () => {
    const score = computeNoveltyScore(1, 0, 0, 0);
    expect(score).toBeCloseTo(0.40, 5);
  });
});

// ── describeSignals ───────────────────────────────────────────────────────

describe("describeSignals", () => {
  it("returns object with all 5 keys", () => {
    const d = describeSignals(0.8, 0.6, 0.5, 0.7, 0.66);
    expect(d).toHaveProperty("embedding_novelty");
    expect(d).toHaveProperty("entity_novelty");
    expect(d).toHaveProperty("temporal_novelty");
    expect(d).toHaveProperty("structural_novelty");
    expect(d).toHaveProperty("combined_novelty");
  });

  it("rounds values to 4 decimal places", () => {
    const d = describeSignals(1/3, 1/3, 1/3, 1/3, 1/3);
    expect(String(d["embedding_novelty"]).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(4);
  });
});
