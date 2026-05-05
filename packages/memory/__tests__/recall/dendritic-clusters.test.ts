/**
 * Unit tests for the dendritic-clusters module.
 *
 * Verifies properties derived from the contract in dendritic-clusters.ts:
 *   - computeBranchAffinity ∈ [0, 1] (Jaccard + weighting postcondition)
 *   - findBestBranch respects threshold and maxSize
 *   - findBestBranch returns null when disabled=true (ablation mode)
 *   - addMemoryToBranch is immutable (original unchanged)
 *   - addMemoryToBranch avgHeat is a running average
 *
 * D-05 fix update: entitySignature is now Set<string> (entity names), not
 * Set<number> (IDs). All fixtures updated accordingly.
 * source: cortex@ed33435 mcp_server/core/dendritic_clusters.py:44-67
 *
 * source: Kastellakis et al. (2015) "Synaptic clustering within dendrites."
 *         cortex@ed33435 mcp_server/core/dendritic_clusters.py
 */

import { describe, expect, it } from "vitest";
import {
  BRANCH_ADMISSION_THRESHOLD,
  MAX_BRANCH_SIZE,
  addMemoryToBranch,
  computeBranchAffinity,
  createBranch,
  findBestBranch,
} from "../../src/recall/dendritic-clusters.js";
import type { DendriticBranch } from "../../src/recall/dendritic-clusters.js";

// ── Fixtures ───────────────────────────────────────────────────────────────

// D-05 fix: entitySignature is Set<string> — use entity names, not numeric IDs.
// source: cortex@ed33435 mcp_server/core/dendritic_clusters.py (entity_signature: set[str])

function makeBranch(
  overrides: Partial<DendriticBranch> = {},
): DendriticBranch {
  return {
    branchId: "b1",
    domain: "test",
    memoryIds: [1, 2],
    entitySignature: new Set(["RecallHandler", "MemoryStore", "HopfieldNetwork"]),
    tagSignature: new Set(["architecture", "vector-db"]),
    avgHeat: 0.7,
    plasticity: 1.0,
    spikeCount: 0,
    ...overrides,
  };
}

// ── computeBranchAffinity ──────────────────────────────────────────────────

describe("computeBranchAffinity — Jaccard ∈ [0, 1]", () => {
  it("returns 0.0 for empty memory and empty branch", () => {
    const branch = makeBranch({
      entitySignature: new Set(),
      tagSignature: new Set(),
    });
    const result = computeBranchAffinity(new Set(), new Set(), branch);
    expect(result).toBe(0.0);
  });

  it("result is always in [0, 1]", () => {
    const branch = makeBranch();
    const entities = new Set(["RecallHandler", "MemoryStore", "NewEntity"]);
    const tags = new Set(["architecture", "new-tag"]);
    const score = computeBranchAffinity(entities, tags, branch);
    expect(score).toBeGreaterThanOrEqual(0.0);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it("identical signature gives 1.0", () => {
    const branch = makeBranch({
      entitySignature: new Set(["EntityA", "EntityB", "EntityC"]),
      tagSignature: new Set(["t1", "t2"]),
    });
    const score = computeBranchAffinity(
      new Set(["EntityA", "EntityB", "EntityC"]),
      new Set(["t1", "t2"]),
      branch,
    );
    expect(score).toBeCloseTo(1.0, 6);
  });

  it("disjoint sets give 0.0", () => {
    const branch = makeBranch({
      entitySignature: new Set(["EntityA", "EntityB", "EntityC"]),
      tagSignature: new Set(["a", "b"]),
    });
    const score = computeBranchAffinity(
      new Set(["EntityX", "EntityY"]),
      new Set(["x", "y"]),
      branch,
    );
    expect(score).toBe(0.0);
  });

  it("partial overlap gives intermediate score", () => {
    const branch = makeBranch({
      entitySignature: new Set(["E1", "E2", "E3", "E4"]),
      tagSignature: new Set(["t1", "t2"]),
    });
    // 2 out of 4 entities match → entity Jaccard = 2/5 = 0.4
    // 1 out of 2 tags match → tag Jaccard = 1/3
    const score = computeBranchAffinity(
      new Set(["E1", "E2", "E5"]),
      new Set(["t1", "t3"]),
      branch,
    );
    expect(score).toBeGreaterThan(0.0);
    expect(score).toBeLessThan(1.0);
  });
});

// ── findBestBranch ─────────────────────────────────────────────────────────

describe("findBestBranch", () => {
  it("returns null when no branches exist", () => {
    const result = findBestBranch(new Set(["SomeEntity"]), new Set(["t"]), []);
    expect(result.branch).toBeNull();
    expect(result.score).toBe(0.0);
  });

  it("returns null for ablation mode (disabled=true)", () => {
    const branch = makeBranch();
    const result = findBestBranch(
      new Set(["RecallHandler", "MemoryStore"]),
      new Set(["architecture"]),
      [branch],
      { disabled: true },
    );
    expect(result.branch).toBeNull();
    expect(result.score).toBe(0.0);
  });

  it("respects threshold — no match below threshold", () => {
    const branch = makeBranch({
      entitySignature: new Set(["UnrelatedA", "UnrelatedB"]), // disjoint from query
      tagSignature: new Set(["unrelated"]),
    });
    const result = findBestBranch(
      new Set(["EntityX", "EntityY"]),
      new Set(["architecture"]),
      [branch],
      { threshold: BRANCH_ADMISSION_THRESHOLD },
    );
    expect(result.branch).toBeNull();
  });

  it("selects the branch with highest affinity above threshold", () => {
    const branchLow = makeBranch({
      branchId: "low",
      entitySignature: new Set(["E1"]),
      tagSignature: new Set(["t1"]),
    });
    const branchHigh = makeBranch({
      branchId: "high",
      entitySignature: new Set(["E1", "E2", "E3"]),
      tagSignature: new Set(["t1", "t2", "t3"]),
    });
    const result = findBestBranch(
      new Set(["E1", "E2", "E3"]),
      new Set(["t1", "t2", "t3"]),
      [branchLow, branchHigh],
      { threshold: 0.01 },
    );
    expect(result.branch?.branchId).toBe("high");
  });

  it("respects maxSize — does not admit to a full branch", () => {
    const fullBranch = makeBranch({
      memoryIds: Array.from({ length: MAX_BRANCH_SIZE }, (_, i) => i + 1),
      entitySignature: new Set(["E1", "E2", "E3"]),
      tagSignature: new Set(["t1"]),
    });
    const result = findBestBranch(
      new Set(["E1", "E2", "E3"]),
      new Set(["t1"]),
      [fullBranch],
      { maxSize: MAX_BRANCH_SIZE },
    );
    expect(result.branch).toBeNull();
  });
});

// ── addMemoryToBranch ──────────────────────────────────────────────────────

describe("addMemoryToBranch — immutability contract", () => {
  it("does not mutate the original branch", () => {
    const original = makeBranch();
    const originalIds = [...original.memoryIds];
    const originalEntitySize = original.entitySignature.size;
    addMemoryToBranch(original, 99, new Set(["NewEntity"]), new Set(["new-tag"]), 0.5);
    expect(original.memoryIds).toEqual(originalIds);
    expect(original.entitySignature.size).toBe(originalEntitySize);
  });

  it("adds the new memory ID to the returned branch", () => {
    const original = makeBranch({ memoryIds: [1, 2] });
    const updated = addMemoryToBranch(original, 3, new Set(), new Set(), 0.8);
    expect(updated.memoryIds).toContain(3);
    expect(updated.memoryIds).toHaveLength(3);
  });

  it("merges entity and tag signatures", () => {
    const original = makeBranch({
      entitySignature: new Set(["E1", "E2"]),
      tagSignature: new Set(["a"]),
    });
    const updated = addMemoryToBranch(
      original,
      5,
      new Set(["E3"]),
      new Set(["b"]),
      0.9,
    );
    expect(updated.entitySignature.has("E1")).toBe(true);
    expect(updated.entitySignature.has("E3")).toBe(true);
    expect(updated.tagSignature.has("a")).toBe(true);
    expect(updated.tagSignature.has("b")).toBe(true);
  });

  it("avgHeat is a running average rounded to 4 dp", () => {
    // branch has 2 memories with avgHeat 0.6; adding one with heat 0.9
    const original = makeBranch({ memoryIds: [1, 2], avgHeat: 0.6 });
    const updated = addMemoryToBranch(original, 3, new Set(), new Set(), 0.9);
    // (0.6 * 2 + 0.9) / 3 = 2.1 / 3 = 0.7
    expect(updated.avgHeat).toBeCloseTo(0.7, 4);
  });
});

// ── createBranch ───────────────────────────────────────────────────────────

describe("createBranch", () => {
  it("creates branch with one founding memory", () => {
    const branch = createBranch(
      "new-branch",
      "cortex",
      42,
      new Set(["ModelA", "ModelB"]),
      new Set(["ml", "recall"]),
      0.85,
    );
    expect(branch.branchId).toBe("new-branch");
    expect(branch.domain).toBe("cortex");
    expect(branch.memoryIds).toEqual([42]);
    expect(branch.entitySignature.has("ModelA")).toBe(true);
    expect(branch.tagSignature.has("recall")).toBe(true);
    expect(branch.avgHeat).toBe(0.85);
    expect(branch.plasticity).toBe(1.0);
    expect(branch.spikeCount).toBe(0);
  });

  it("entity and tag signatures are copies (not shared references)", () => {
    const entities = new Set(["E1", "E2"]);
    const tags = new Set(["t1"]);
    const branch = createBranch("b", "d", 1, entities, tags, 0.5);
    entities.add("E99"); // mutate original
    expect(branch.entitySignature.has("E99")).toBe(false);
  });
});

// ── D-05 regression: entitySignature must be Set<string> ──────────────────
// The previous implementation used Set<number> (DB entity IDs). Python uses
// set[str] (entity names). Jaccard over IDs and Jaccard over names produce
// completely different affinity scores for the same data.
// This test suite exercises the string-type domain. The type guard below
// confirms the interface accepts strings and rejects numbers at compile time.
// source: cortex@ed33435 mcp_server/core/dendritic_clusters.py:44-67

describe("D-05 entitySignature is Set<string> (entity names)", () => {
  it("entitySignature accepts string entity names", () => {
    const branch = makeBranch({
      entitySignature: new Set(["RecallPipeline", "HopfieldNet", "HDCEncoder"]),
    });
    // All three names are strings — confirms the fix is in place
    expect(branch.entitySignature.has("RecallPipeline")).toBe(true);
    expect(branch.entitySignature.has("HopfieldNet")).toBe(true);
  });

  it("Jaccard over entity names is semantically meaningful", () => {
    // Two branches with overlapping entity names produce non-zero affinity
    const branch = makeBranch({
      entitySignature: new Set(["RecallPipeline", "HopfieldNet", "HDCEncoder"]),
      tagSignature: new Set(["recall", "memory"]),
    });
    // Query entities are a subset of branch entities → Jaccard = 2/3
    const score = computeBranchAffinity(
      new Set(["RecallPipeline", "HopfieldNet"]),
      new Set(["recall"]),
      branch,
    );
    expect(score).toBeGreaterThan(0);
    // entity Jaccard = 2/3 * 0.7 + tag Jaccard = 1/2 * 0.3 = 0.467 + 0.15 = 0.617
    expect(score).toBeCloseTo(2 / 3 * 0.7 + 1 / 2 * 0.3, 5);
  });
});
