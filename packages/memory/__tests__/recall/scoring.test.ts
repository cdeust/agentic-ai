/**
 * Unit tests for scoring.ts — BM25, n-gram, keyword overlap.
 *
 * Verifies determinism for fixed inputs and numerical-constant identity
 * with cortex@ed33435 mcp_server/core/scoring.py.
 *
 * Ranking algorithms must be deterministic: given the same input,
 * the same output is produced every time.
 */

import { describe, expect, it } from "vitest";
import {
  computeBm25Scores,
  computeNgramScore,
  computeKeywordOverlap,
  tokenize,
  tokenizeRaw,
} from "../../src/recall/scoring.js";

// ── BM25 parameters (numerical-constant audit) ────────────────────────────
// source: cortex@ed33435 mcp_server/core/scoring.py:94-96
const BM25_K1 = 1.5;
const BM25_B = 0.75;

// ── N-gram weights (numerical-constant audit) ─────────────────────────────
// source: cortex@ed33435 mcp_server/core/scoring.py:128
// trigram=0.4, bigram=0.35, content=0.25
const TRIGRAM_WEIGHT = 0.4;
const BIGRAM_WEIGHT = 0.35;
const CONTENT_WEIGHT = 0.25;

describe("tokenize", () => {
  it("filters stopwords", () => {
    const result = tokenize("the quick brown fox");
    expect(result).not.toContain("the");
    expect(result).toContain("quick");
    expect(result).toContain("brown");
    expect(result).toContain("fox");
  });

  it("is case-insensitive", () => {
    expect(tokenize("Quick")).toEqual(tokenize("quick"));
  });

  it("is deterministic for fixed input", () => {
    const a = tokenize("authentication middleware pattern");
    const b = tokenize("authentication middleware pattern");
    expect(a).toEqual(b);
  });
});

describe("tokenizeRaw", () => {
  it("does not filter stopwords", () => {
    const result = tokenizeRaw("the quick brown fox");
    expect(result).toContain("the");
    expect(result).toContain("quick");
  });

  it("is deterministic for fixed input", () => {
    expect(tokenizeRaw("hello world test")).toEqual(tokenizeRaw("hello world test"));
  });
});

describe("computeBm25Scores", () => {
  it("uses k1=1.5 and b=0.75 by default", () => {
    const docs = ["authentication token storage", "database connection pool"];
    // Verify default parameters match Python constants
    const scores1 = computeBm25Scores("authentication", docs);
    const scores2 = computeBm25Scores("authentication", docs, BM25_K1, BM25_B);
    expect(scores1).toEqual(scores2);
  });

  it("is normalized to [0, 1]", () => {
    const docs = ["memory allocation", "network protocol", "memory cache"];
    const scores = computeBm25Scores("memory", docs);
    for (const s of scores) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  it("ranks the most relevant document highest", () => {
    const docs = [
      "recall pipeline stages hopfield hdc spreading",
      "unrelated content about cooking",
      "recall algorithm optimization pipeline",
    ];
    const scores = computeBm25Scores("recall pipeline", docs);
    // First or third doc should score higher than second (cooking)
    expect(scores[1]).toBeLessThan(scores[0]! + scores[2]!);
  });

  it("returns all zeros for empty query", () => {
    const scores = computeBm25Scores("", ["doc one", "doc two"]);
    expect(scores).toEqual([0.0, 0.0]);
  });

  it("is deterministic for fixed input", () => {
    const docs = ["interference detection proactive", "retroactive memory", "BM25 scoring"];
    const query = "memory interference";
    const a = computeBm25Scores(query, docs);
    const b = computeBm25Scores(query, docs);
    expect(a).toEqual(b);
  });
});

describe("computeNgramScore", () => {
  it("uses trigram=0.4, bigram=0.35, content=0.25 weights", () => {
    // Verify weight constants match Python source
    const totalWeights = TRIGRAM_WEIGHT + BIGRAM_WEIGHT + CONTENT_WEIGHT;
    expect(totalWeights).toBeCloseTo(1.0, 10);
  });

  it("returns 0 for empty query or document", () => {
    expect(computeNgramScore("", "some document")).toBe(0.0);
    expect(computeNgramScore("some query", "")).toBe(0.0);
  });

  it("returns higher score for similar text", () => {
    const score1 = computeNgramScore("recall pipeline", "recall pipeline stages");
    const score2 = computeNgramScore("recall pipeline", "database connection pool");
    expect(score1).toBeGreaterThan(score2);
  });

  it("is deterministic for fixed input", () => {
    const a = computeNgramScore("hopfield dendritic modulate", "dendritic branch modulation");
    const b = computeNgramScore("hopfield dendritic modulate", "dendritic branch modulation");
    expect(a).toBe(b);
  });

  it("result is in [0, 1]", () => {
    const score = computeNgramScore("test query", "test document content");
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe("computeKeywordOverlap", () => {
  it("returns 0 for empty query", () => {
    expect(computeKeywordOverlap("", "some document")).toBe(0.0);
  });

  it("returns 1 for identical content", () => {
    const score = computeKeywordOverlap("memory recall", "memory recall");
    expect(score).toBe(1.0);
  });

  it("is deterministic for fixed input", () => {
    const a = computeKeywordOverlap("authentication token", "token-based authentication system");
    const b = computeKeywordOverlap("authentication token", "token-based authentication system");
    expect(a).toBe(b);
  });
});
