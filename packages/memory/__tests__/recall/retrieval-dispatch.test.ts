/**
 * Unit tests for retrieval-dispatch.ts.
 *
 * Verifies:
 *   1. classifyTier — correct mapping from intent to tier
 *   2. wrfFuse — deterministic, correct weighting formula
 *   3. computeSignalWeights — numerical constants match Python source
 *   4. mergeMultihopResults — correct hop_weight=0.3 application
 *   5. All functions are deterministic for fixed inputs
 *
 * source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py
 */

import { describe, expect, it } from "vitest";
import {
  classifyTier,
  computeSignalWeights,
  mergeMultihopResults,
  wrfFuse,
} from "../../src/recall/retrieval-dispatch.js";
import { QueryIntent } from "../../src/recall/types.js";

// ── Numerical constant audit ──────────────────────────────────────────────

describe("numerical constants (cortex@ed33435 audit)", () => {
  it("wrfFuse default k = 60 (Cormack SIGIR 2009)", () => {
    // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:53
    const signal: Array<[number, number]> = [[1, 1.0], [2, 0.5]];
    // With k=60, score for rank 0 = weight / (60 + 1) = weight / 61
    const result = wrfFuse([[signal]], [1.0]);
    expect(result[0]![1]).toBeCloseTo(1.0 / (60 + 0 + 1), 10);
  });

  it("mergeMultihopResults hop_weight = 0.3", () => {
    // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:150
    const primary: Array<[number, number]> = [[1, 1.0]];
    const secondary: Array<[number, number]> = [[2, 1.0]];
    const result = mergeMultihopResults(primary, secondary);
    // id=2 should have score = 1.0 * 0.3 = 0.3
    const id2 = result.find(([id]) => id === 2);
    expect(id2![1]).toBeCloseTo(0.3, 10);
  });

  it("base signal weights: hopfield = vector * 0.5", () => {
    // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:78
    const w = computeSignalWeights("simple", {}, 1.0, 0.5, 0.3);
    expect(w["hopfield"]).toBeCloseTo(1.0 * 0.5, 10);
  });

  it("base signal weights: hdc = vector * 0.4", () => {
    // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:79
    const w = computeSignalWeights("simple", {}, 1.0, 0.5, 0.3);
    expect(w["hdc"]).toBeCloseTo(1.0 * 0.4, 10);
  });

  it("base signal weights: sr = heat * 0.6", () => {
    // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:80
    const w = computeSignalWeights("simple", {}, 1.0, 0.5, 0.3);
    expect(w["sr"]).toBeCloseTo(0.3 * 0.6, 10);
  });

  it("base signal weights: bm25 = fts * 0.8", () => {
    // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:82
    const w = computeSignalWeights("simple", {}, 1.0, 0.5, 0.3);
    expect(w["bm25"]).toBeCloseTo(0.5 * 0.8, 10);
  });

  it("base signal weights: ngram = fts * 0.6", () => {
    // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:83
    const w = computeSignalWeights("simple", {}, 1.0, 0.5, 0.3);
    expect(w["ngram"]).toBeCloseTo(0.5 * 0.6, 10);
  });

  it("deep weights: bm25 = fts * 1.5", () => {
    // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:95
    const w = computeSignalWeights("deep", {}, 1.0, 0.5, 0.3);
    expect(w["bm25"]).toBeCloseTo(0.5 * 1.5, 10);
  });

  it("instruction weights: bm25 = fts * 2.0", () => {
    // source: cortex@ed33435 mcp_server/core/retrieval_dispatch.py:124
    const w = computeSignalWeights("simple", {}, 1.0, 0.5, 0.3, QueryIntent.INSTRUCTION);
    expect(w["bm25"]).toBeCloseTo(0.5 * 2.0, 10);
  });
});

// ── classifyTier ──────────────────────────────────────────────────────────

describe("classifyTier", () => {
  it("maps MULTI_HOP to mixed", () => {
    expect(classifyTier(QueryIntent.MULTI_HOP)).toBe("mixed");
  });

  it("maps ENTITY to deep", () => {
    expect(classifyTier(QueryIntent.ENTITY)).toBe("deep");
  });

  it("maps INSTRUCTION to deep", () => {
    expect(classifyTier(QueryIntent.INSTRUCTION)).toBe("deep");
  });

  it("maps GENERAL to simple", () => {
    expect(classifyTier(QueryIntent.GENERAL)).toBe("simple");
  });

  it("maps TEMPORAL to simple", () => {
    expect(classifyTier(QueryIntent.TEMPORAL)).toBe("simple");
  });

  it("maps KNOWLEDGE_UPDATE to simple", () => {
    expect(classifyTier(QueryIntent.KNOWLEDGE_UPDATE)).toBe("simple");
  });
});

// ── wrfFuse ───────────────────────────────────────────────────────────────

describe("wrfFuse", () => {
  it("returns empty for no signals", () => {
    expect(wrfFuse([], [])).toEqual([]);
  });

  it("skips signals with weight <= 0", () => {
    const signal: Array<[number, number]> = [[1, 1.0]];
    const result = wrfFuse([[signal]], [0.0]);
    expect(result).toEqual([]);
  });

  it("produces sorted output descending by score", () => {
    const s1: Array<[number, number]> = [[1, 1.0], [2, 0.5]];
    const s2: Array<[number, number]> = [[2, 1.0], [1, 0.5]];
    const result = wrfFuse([s1, s2], [1.0, 1.0]);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1]![1]).toBeGreaterThanOrEqual(result[i]![1]);
    }
  });

  it("is deterministic for fixed input", () => {
    const s: Array<[number, number]> = [[3, 1.0], [1, 0.8], [2, 0.6]];
    const a = wrfFuse([s], [1.0]);
    const b = wrfFuse([s], [1.0]);
    expect(a).toEqual(b);
  });
});

// ── mergeMultihopResults ──────────────────────────────────────────────────

describe("mergeMultihopResults", () => {
  it("reinforces existing ids", () => {
    const primary: Array<[number, number]> = [[1, 1.0], [2, 0.5]];
    const secondary: Array<[number, number]> = [[1, 0.8]];
    const result = mergeMultihopResults(primary, secondary);
    const id1 = result.find(([id]) => id === 1);
    // id=1 score should be 1.0 + 0.8 * 0.3 = 1.24
    expect(id1![1]).toBeCloseTo(1.0 + 0.8 * 0.3, 10);
  });

  it("adds new ids at reduced weight", () => {
    const primary: Array<[number, number]> = [[1, 1.0]];
    const secondary: Array<[number, number]> = [[2, 0.9]];
    const result = mergeMultihopResults(primary, secondary);
    const id2 = result.find(([id]) => id === 2);
    expect(id2![1]).toBeCloseTo(0.9 * 0.3, 10);
  });

  it("is deterministic for fixed input", () => {
    const p: Array<[number, number]> = [[1, 1.0], [2, 0.8]];
    const s: Array<[number, number]> = [[2, 0.9], [3, 0.7]];
    const a = mergeMultihopResults(p, s);
    const b = mergeMultihopResults(p, s);
    expect(a).toEqual(b);
  });
});
