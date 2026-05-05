/**
 * Tests for unified-search-fusion.ts — RRF fusion.
 *
 * Invariant: result.length <= topN; every item has rrf_score and source_ranks.
 * Happy path: two lists with shared and unique items.
 * Error path: empty lists, missing id_key.
 */

import { describe, it, expect } from "vitest";
import { fuse, DEFAULT_K } from "../../src/recall/unified-search-fusion.js";

const listA = [
  { id: "1", content: "memory A1", score: 0.9 },
  { id: "2", content: "memory A2", score: 0.8 },
  { id: "3", content: "memory A3", score: 0.7 },
];

const listB = [
  { id: "2", content: "memory B2", score: 0.95 },
  { id: "4", content: "memory B4", score: 0.85 },
];

describe("fuse", () => {
  it("merges two lists and produces rrf_score", () => {
    const merged = fuse([["cortex", listA], ["ap", listB]]);
    expect(merged.length).toBeGreaterThan(0);
    for (const item of merged) {
      expect(item).toHaveProperty("rrf_score");
      expect(item).toHaveProperty("source_ranks");
      expect((item["rrf_score"] as number)).toBeGreaterThan(0);
    }
  });

  it("items in both lists get higher scores", () => {
    const merged = fuse([["cortex", listA], ["ap", listB]]);
    // Item "2" is in both lists — should rank high
    const item2 = merged.find((m) => m["id"] === "2");
    const item3 = merged.find((m) => m["id"] === "3");
    expect(item2).toBeDefined();
    if (item2 && item3) {
      expect((item2["rrf_score"] as number)).toBeGreaterThan(item3["rrf_score"] as number);
    }
  });

  it("respects topN limit", () => {
    const merged = fuse([["cortex", listA], ["ap", listB]], DEFAULT_K, "id", 2);
    expect(merged.length).toBeLessThanOrEqual(2);
  });

  it("skips items with missing id_key", () => {
    const listWithMissing = [{ content: "no id here" }];
    const merged = fuse([["cortex", listWithMissing as any]]);
    expect(merged.length).toBe(0);
  });

  it("returns empty for empty inputs", () => {
    const merged = fuse([]);
    expect(merged.length).toBe(0);
  });

  it("source_ranks records correct ranks", () => {
    const merged = fuse([["cortex", listA], ["ap", listB]]);
    const item2 = merged.find((m) => m["id"] === "2");
    expect(item2?.["source_ranks"]).toHaveProperty("cortex");
    expect(item2?.["source_ranks"]).toHaveProperty("ap");
  });

  it("is deterministic for same input", () => {
    const merged1 = fuse([["cortex", listA], ["ap", listB]]);
    const merged2 = fuse([["cortex", listA], ["ap", listB]]);
    expect(merged1.map((m) => m["id"])).toEqual(merged2.map((m) => m["id"]));
  });
});
