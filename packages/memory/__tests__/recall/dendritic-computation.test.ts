import { describe, it, expect } from "vitest";
import {
  branchSubunit,
  somaOutput,
  computeDendriticIntegration,
  computeClusterPriming,
  updateBranchPlasticity,
  computeBranchStatistics,
  branchToDict,
  branchFromDict,
  makeDendriticBranch,
} from "../../src/recall/dendritic-computation.js";

describe("branchSubunit — Poirazi (2003) Layer 1", () => {
  it("returns 0 for n <= 0", () => {
    expect(branchSubunit(0)).toBe(0.0);
    expect(branchSubunit(-1)).toBe(0.0);
  });
  it("is non-negative for positive n", () => {
    for (const n of [0.5, 1, 3.6, 5, 10]) expect(branchSubunit(n)).toBeGreaterThanOrEqual(0);
  });
  it("is monotone increasing in n", () => {
    let prev = branchSubunit(0.1);
    for (const n of [0.5, 1, 2, 3.6, 5, 8, 12]) { const curr = branchSubunit(n); expect(curr).toBeGreaterThan(prev); prev = curr; }
  });
  it("matches Poirazi formula at n=3.6", () => { expect(branchSubunit(3.6)).toBeCloseTo(1.727, 2); });
});

describe("somaOutput — Poirazi (2003) Layer 2", () => {
  it("returns 0 for x <= 0", () => { expect(somaOutput(0)).toBe(0.0); expect(somaOutput(-1)).toBe(0.0); });
  it("is monotone increasing for x > 0", () => {
    let prev = somaOutput(0.1);
    for (const x of [1, 5, 10, 20, 30, 50]) { const curr = somaOutput(x); expect(curr).toBeGreaterThan(prev); prev = curr; }
  });
  it("approaches 0.96*x for large x", () => { expect(somaOutput(1000)).toBeCloseTo(960, 0); });
});

describe("computeDendriticIntegration", () => {
  it("returns [0, false] for empty scores", () => { const [s, sp] = computeDendriticIntegration(5, 10, []); expect(s).toBe(0.0); expect(sp).toBe(false); });
  it("spike when activeCount > 3.6", () => { const [, sp] = computeDendriticIntegration(4, 10, [0.8, 0.9, 0.7, 0.85]); expect(sp).toBe(true); });
  it("no spike when activeCount <= 3.6", () => { const [, sp] = computeDendriticIntegration(3, 10, [0.8]); expect(sp).toBe(false); });
  it("score is non-negative", () => { const [s] = computeDendriticIntegration(5, 10, [0.5, 0.6]); expect(s).toBeGreaterThanOrEqual(0); });
});

describe("computeClusterPriming", () => {
  it("returns empty Map if memory not in branch", () => { expect(computeClusterPriming(99, makeDendriticBranch({ memoryIds: [1, 2, 3] })).size).toBe(0); });
  it("priming boost positive", () => { for (const [, b] of computeClusterPriming(1, makeDendriticBranch({ memoryIds: [1, 2, 3] }))) expect(b).toBeGreaterThan(0); });
  it("priming decays with distance", () => {
    const b = makeDendriticBranch({ memoryIds: [1, 2, 3, 4, 5] });
    const p = computeClusterPriming(1, b);
    const near = p.get(2)!; const far = p.get(5)!;
    expect(near).toBeGreaterThan(far);
  });
});

describe("updateBranchPlasticity", () => {
  it("LTP increases plasticity", () => { const u = updateBranchPlasticity(makeDendriticBranch({ plasticity: 0.5 }), true, false); expect(u.plasticity).toBeGreaterThan(0.5); expect(u.plasticity).toBeLessThanOrEqual(1.0); });
  it("LTD decreases plasticity", () => { const u = updateBranchPlasticity(makeDendriticBranch({ plasticity: 0.5 }), false, true); expect(u.plasticity).toBeLessThan(0.5); expect(u.plasticity).toBeGreaterThanOrEqual(0.0); });
  it("decay toward 0.5", () => { const u = updateBranchPlasticity(makeDendriticBranch({ plasticity: 1.0 }), false, false); expect(u.plasticity).toBeLessThan(1.0); expect(u.plasticity).toBeGreaterThan(0.5); });
  it("spike count increments on LTP", () => { expect(updateBranchPlasticity(makeDendriticBranch({ spikeCount: 3 }), true, false).spikeCount).toBe(4); });
});

describe("computeBranchStatistics", () => {
  it("zeros for empty", () => { expect(computeBranchStatistics([]).total_branches).toBe(0); });
  it("counts orphans", () => { expect(computeBranchStatistics([makeDendriticBranch({ memoryIds: [1] }), makeDendriticBranch({ memoryIds: [2, 3] }), makeDendriticBranch({ memoryIds: [] })]).orphan_branches).toBe(2); });
});

describe("serialization", () => {
  it("round-trip identity", () => {
    const b = makeDendriticBranch({ branchId: "b1", domain: "test", memoryIds: [1, 2, 3], entitySignature: new Set(["A", "B"]), tagSignature: new Set(["x"]), avgHeat: 0.7, plasticity: 0.85, spikeCount: 2 });
    const r = branchFromDict(branchToDict(b) as Record<string, unknown>);
    expect(r.branchId).toBe("b1"); expect(r.memoryIds).toEqual([1, 2, 3]); expect([...r.entitySignature].sort()).toEqual(["A", "B"]); expect(r.plasticity).toBe(0.85);
  });
});
