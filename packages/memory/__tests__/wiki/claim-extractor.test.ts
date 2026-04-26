/**
 * Unit tests for claim extractor.
 */

import { describe, it, expect } from "vitest";
import { extractClaims } from "../../src/wiki/claim-extractor.js";

describe("extractClaims", () => {
  it("returns empty for empty content", () => {
    const [claims, stats] = extractClaims("");
    expect(claims).toHaveLength(0);
    expect(stats.sentences_total).toBe(0);
  });

  it("extracts decision claims", () => {
    const content = "We decided to use pgvector for semantic search because cosine similarity is native. Decided to adopt HNSW index over flat search.";
    const [claims] = extractClaims(content);
    expect(claims.some((c) => c.claim_type === "decision")).toBe(true);
  });

  it("extracts result claims with percentage", () => {
    const content = "The benchmark achieved 92% recall@10 on the LongMemEval dataset. We measured a 40% improvement over the baseline.";
    const [claims] = extractClaims(content);
    expect(claims.some((c) => c.claim_type === "result")).toBe(true);
  });

  it("extracts limitation claims", () => {
    const content = "The system does not handle concurrent writes. Known issue: cache invalidation fails when model is reloaded.";
    const [claims] = extractClaims(content);
    expect(claims.some((c) => c.claim_type === "limitation")).toBe(true);
  });

  it("extracts evidence refs from URLs", () => {
    const content = "The approach is described at https://arxiv.org/abs/1603.09320. We implemented it using numpy.";
    const [claims] = extractClaims(content);
    const allRefs = claims.flatMap((c) => c.evidence_refs);
    expect(allRefs.some((r) => r.kind === "url")).toBe(true);
  });

  it("strips fenced code blocks before classifying", () => {
    const content = [
      "We decided to use TypeScript for the port.",
      "",
      "```python",
      "decided = True  # should not match",
      "```",
      "",
      "The decision is final.",
    ].join("\n");
    const [claims] = extractClaims(content);
    // Should find claims from prose, not from code block
    expect(claims.some((c) => c.claim_type === "decision")).toBe(true);
  });

  it("attaches memory_id and session_id from args", () => {
    const content = "We decided to use PostgreSQL because of ACID compliance.";
    const [claims] = extractClaims(content, { memory_id: 42, session_id: "sess-1" });
    expect(claims[0]?.memory_id).toBe(42);
    expect(claims[0]?.session_id).toBe("sess-1");
  });

  it("caps claim text at 1900 chars", () => {
    const longText = "decided " + "a".repeat(2000);
    const [claims] = extractClaims(longText);
    for (const c of claims) {
      expect(c.text.length).toBeLessThanOrEqual(1900);
    }
  });

  it("drops short sentences", () => {
    const content = "OK. Done. We decided to use PostgreSQL because ACID compliance is required for transactional integrity.";
    const [claims] = extractClaims(content);
    // Short sentences ("OK.", "Done.") should be dropped
    for (const c of claims) {
      expect(c.text.length).toBeGreaterThanOrEqual(12);
    }
  });

  it("returns stats", () => {
    const content = "We decided to use PostgreSQL. This is a fact. https://example.com is the source.";
    const [, stats] = extractClaims(content);
    expect(stats.sentences_total).toBeGreaterThan(0);
    expect(stats.sentences_classified + stats.sentences_dropped).toBe(stats.sentences_total);
  });
});
