/**
 * Tests for recall-helpers.ts
 *
 * source: cortex@ed33435 mcp_server/handlers/recall_helpers.py
 *
 * Invariants tested:
 *   1. buildExpandedQuery — expands recall → retrieve
 *   2. computeTextSignals — BM25 scores for matching terms
 *   3. computeResultBoost — zero boost for empty createdAt
 *   4. parseTags — handles string JSON, array, null
 *   5. buildResult — score boosted by recency, clamped sensibly
 *   6. buildEnhancements — knowledge_update_boost when intent matches
 */

import { describe, it, expect } from "vitest";
import {
  buildExpandedQuery,
  computeTextSignals,
  computeResultBoost,
  parseTags,
  buildResult,
  buildEnhancements,
} from "../../src/recall/recall-helpers.js";
import { QueryIntent } from "../../src/recall/types.js";
import type { RecallSettings } from "../../src/recall/recall-handler.js";
import type { MemoryItem } from "../../src/recall/types.js";

// ── Settings fixture ──────────────────────────────────────────────────────

const settings: RecallSettings = {
  WRRF_K: 60,
  CO_ACTIVATION_ENABLED: true,
  CO_ACTIVATION_MIN_SCORE: 0.3,
  CO_ACTIVATION_LEARNING_RATE: 0.01,
  STRATEGIC_ORDERING_ENABLED: true,
  STRATEGIC_TOP_FRACTION: 0.3,
  STRATEGIC_BOTTOM_FRACTION: 0.2,
  SESSION_COHERENCE_BONUS: 0.1,
  SESSION_COHERENCE_WINDOW_HOURS: 4,
  RECENCY_BOOST_MAX: 0.3,
  RECENCY_BOOST_HALFLIFE_DAYS: 7,
  RECENCY_BOOST_CUTOFF_DAYS: 30,
};

// ── Test 1: buildExpandedQuery ────────────────────────────────────────────

describe("buildExpandedQuery", () => {
  it("expands 'recall' with synonyms", () => {
    const expanded = buildExpandedQuery("recall memories");
    expect(expanded.length).toBeGreaterThan("recall memories".length);
    expect(expanded).toContain("retrieve");
  });

  it("returns original if no known triggers", () => {
    const q = "something unrecognized";
    expect(buildExpandedQuery(q)).toBe(q);
  });

  it("expands 'error' with synonyms", () => {
    const expanded = buildExpandedQuery("error in the system");
    expect(expanded).toContain("bug");
  });
});

// ── Test 2: computeTextSignals ────────────────────────────────────────────

describe("computeTextSignals", () => {
  it("returns empty arrays for empty hotMems", () => {
    const { bm25, ngram } = computeTextSignals("query", []);
    expect(bm25).toEqual([]);
    expect(ngram).toEqual([]);
  });

  it("produces positive BM25 score for matching terms", () => {
    const mems: MemoryItem[] = [
      { id: 1, content: "recall memories hot relevant important", heat_base: 0.8 } as MemoryItem,
      { id: 2, content: "unrelated content about cooking pasta", heat_base: 0.5 } as MemoryItem,
    ];
    const { bm25 } = computeTextSignals("recall hot memories", mems);
    const matchingBm25 = bm25.find(([id]) => id === 1);
    expect(matchingBm25).toBeDefined();
    expect(matchingBm25?.[1]).toBeGreaterThan(0);
  });

  it("produces positive n-gram score for shared terms", () => {
    const mems: MemoryItem[] = [
      { id: 3, content: "pgvector embedding similarity search", heat_base: 0.7 } as MemoryItem,
    ];
    const { ngram } = computeTextSignals("pgvector similarity", mems);
    const match = ngram.find(([id]) => id === 3);
    expect(match).toBeDefined();
    expect(match?.[1]).toBeGreaterThan(0);
  });
});

// ── Test 3: computeResultBoost ────────────────────────────────────────────

describe("computeResultBoost", () => {
  it("returns 0 for empty createdAt", () => {
    expect(computeResultBoost(QueryIntent.GENERAL, "", settings)).toBe(0);
  });

  it("returns positive boost for recent memory", () => {
    const recent = new Date(Date.now() - 1 * 3600 * 1000).toISOString();
    const boost = computeResultBoost(QueryIntent.GENERAL, recent, settings);
    expect(boost).toBeGreaterThan(0);
    expect(boost).toBeLessThanOrEqual(settings.RECENCY_BOOST_MAX);
  });

  it("returns 0 for very old memory beyond cutoff", () => {
    const old = new Date(Date.now() - 100 * 24 * 3600 * 1000).toISOString();
    const boost = computeResultBoost(QueryIntent.GENERAL, old, settings);
    expect(boost).toBe(0);
  });

  it("applies higher boost for KNOWLEDGE_UPDATE intent", () => {
    const recent = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const generalBoost = computeResultBoost(QueryIntent.GENERAL, recent, settings);
    const kuBoost = computeResultBoost(QueryIntent.KNOWLEDGE_UPDATE, recent, settings);
    expect(kuBoost).toBeGreaterThanOrEqual(generalBoost);
  });
});

// ── Test 4: parseTags ─────────────────────────────────────────────────────

describe("parseTags", () => {
  it("returns empty array for null", () => {
    expect(parseTags(null)).toEqual([]);
  });
  it("returns array unchanged", () => {
    expect(parseTags(["a", "b"])).toEqual(["a", "b"]);
  });
  it("parses JSON string", () => {
    expect(parseTags('["x", "y"]')).toEqual(["x", "y"]);
  });
  it("returns empty for invalid JSON string", () => {
    expect(parseTags("not-json")).toEqual([]);
  });
});

// ── Test 5: buildResult ───────────────────────────────────────────────────

describe("buildResult", () => {
  const mem: MemoryItem = {
    id: 5,
    content: "test memory content",
    heat_base: 0.6,
    domain: "cortex",
    tags: ["recall", "test"],
    store_type: "episodic",
    created_at: new Date(Date.now() - 1 * 3600 * 1000).toISOString(),
    importance: 0.7,
    surprise_score: 0.3,
  } as unknown as MemoryItem;

  it("returns memory_id correctly", () => {
    const result = buildResult(mem, 0.5, QueryIntent.GENERAL, settings);
    expect(result.memory_id).toBe(5);
  });

  it("score is positive with recency boost applied", () => {
    const result = buildResult(mem, 0.5, QueryIntent.GENERAL, settings);
    expect(result.score).toBeGreaterThan(0);
  });

  it("heat is in [0,1]", () => {
    const result = buildResult(mem, 0.5, QueryIntent.GENERAL, settings);
    expect(result.heat).toBeGreaterThanOrEqual(0);
    expect(result.heat).toBeLessThanOrEqual(1);
  });

  it("tags are returned as array", () => {
    const result = buildResult(mem, 0.5, QueryIntent.GENERAL, settings);
    expect(Array.isArray(result.tags)).toBe(true);
  });
});

// ── Test 6: buildEnhancements ─────────────────────────────────────────────

describe("buildEnhancements", () => {
  it("knowledge_update_boost=true when intent=KNOWLEDGE_UPDATE", () => {
    const result = buildEnhancements("query", QueryIntent.KNOWLEDGE_UPDATE, "pg", settings);
    expect(result.knowledge_update_boost).toBe(true);
  });

  it("knowledge_update_boost=false for GENERAL intent", () => {
    const result = buildEnhancements("query", QueryIntent.GENERAL, "pg", settings);
    expect(result.knowledge_update_boost).toBe(false);
  });

  it("query_expanded=true when expansion applies", () => {
    const result = buildEnhancements("recall everything", QueryIntent.GENERAL, "pg", settings);
    expect(result.query_expanded).toBe(true);
  });

  it("strategic_ordering reflects settings", () => {
    const result = buildEnhancements("q", QueryIntent.GENERAL, "pg", settings);
    expect(result.strategic_ordering).toBe(settings.STRATEGIC_ORDERING_ENABLED);
  });
});
