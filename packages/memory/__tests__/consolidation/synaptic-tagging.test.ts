import { describe, it, expect } from "vitest";
import { bistableConsolidation, computeInitialZ, findTaggingCandidates, computeTagBoosts, applySynapticTags } from "../../src/consolidation/synaptic-tagging.js";

describe("bistableConsolidation — Luboeinski 2021", () => {
  it("z > 0.5 moves toward 1", () => { let z = 0.7; for (let i = 0; i < 10; i++) { const n = bistableConsolidation(z); expect(n).toBeGreaterThanOrEqual(z); z = n; } });
  it("z < 0.5 moves toward 0", () => { let z = 0.3; for (let i = 0; i < 10; i++) { const n = bistableConsolidation(z); expect(n).toBeLessThanOrEqual(z); z = n; } });
  it("z=0 stable", () => { expect(bistableConsolidation(0)).toBeCloseTo(0, 10); });
  it("z=1 stable", () => { expect(bistableConsolidation(1)).toBeCloseTo(1, 10); });
  it("output in [0,1]", () => { for (const z of [0, 0.3, 0.5, 0.7, 1.0]) { const r = bistableConsolidation(z); expect(r).toBeGreaterThanOrEqual(0); expect(r).toBeLessThanOrEqual(1); } });
});

describe("computeInitialZ", () => {
  it("no PRPs -> z < 0.5", () => { expect(computeInitialZ(false, 0.5)).toBeLessThan(0.5); });
  it("PRPs -> z >= 0.5", () => { expect(computeInitialZ(true, 0.5)).toBeGreaterThanOrEqual(0.5); });
  it("PRPs at min overlap=0.3 -> z >= 0.5", () => { expect(computeInitialZ(true, 0.3)).toBeGreaterThanOrEqual(0.5); });
});

const makeMem = (id: number, o: { importance?: number; age_hours?: number; entities?: string[] } = {}) => ({ id, importance: o.importance ?? 0.3, age_hours: o.age_hours ?? 10, entities: new Set(o.entities ?? ["A", "B"]) });

describe("findTaggingCandidates", () => {
  it("empty when importance below trigger", () => { expect(findTaggingCandidates(new Set(["A"]), 0.5, [makeMem(1)])).toHaveLength(0); });
  it("empty when no entity overlap", () => { expect(findTaggingCandidates(new Set(["X"]), 0.9, [makeMem(1)])).toHaveLength(0); });
  it("empty when too old", () => { expect(findTaggingCandidates(new Set(["A"]), 0.9, [makeMem(1, {age_hours: 100})])).toHaveLength(0); });
  it("returns candidate when all conditions met", () => { const r = findTaggingCandidates(new Set(["A", "B"]), 0.9, [makeMem(1)]); expect(r).toHaveLength(1); expect(r[0]!.memory_id).toBe(1); });
  it("respects maxPromotions", () => { const mems = Array.from({length:10}, (_,i) => makeMem(i+1)); expect(findTaggingCandidates(new Set(["A","B"]), 0.9, mems, {maxPromotions:3})).toHaveLength(3); });
});

describe("computeTagBoosts", () => {
  it("new_importance >= current", () => { expect(computeTagBoosts(0.5, 0.3, 0.2).new_importance).toBeGreaterThanOrEqual(0.3); });
  it("new_heat >= current", () => { expect(computeTagBoosts(0.5, 0.3, 0.2).new_heat).toBeGreaterThanOrEqual(0.2); });
  it("capped at 1.0", () => { expect(computeTagBoosts(1.0, 0.9, 0.9, 1.0, 2.0).new_importance).toBeLessThanOrEqual(1.0); });
});

describe("applySynapticTags", () => {
  it("returns boost fields", () => {
    const r = applySynapticTags(new Set(["A","B"]), 0.9, [{id:1,importance:0.3,age_hours:5,entities:new Set(["A","B"]),heat:0.2}]);
    expect(r).toHaveLength(1); expect(r[0]).toHaveProperty("new_importance"); expect(r[0]!.new_importance).toBeGreaterThanOrEqual(0.3);
  });
});
