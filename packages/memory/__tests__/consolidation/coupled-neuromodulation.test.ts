import { describe, it, expect } from "vitest";
import { computeDopamineRpe, computeNorepinephrineArousal, computeSerotoninExploration, applyCrossCoupling, updateState, computeCompositeModulation, makeNeuromodulatoryState, makeOperationSignals, stateToDict, stateFromDict } from "../../src/consolidation/coupled-neuromodulation.js";

describe("computeDopamineRpe — Rescorla-Wagner RPE", () => {
  it("positive -> da > 1", () => { expect(computeDopamineRpe(true, false, 0.5, 0.5)[0]).toBeGreaterThan(1.0); });
  it("negative -> da < 1", () => { expect(computeDopamineRpe(false, true, 0.5, 0.5)[0]).toBeLessThan(1.0); });
  it("neutral -> da ~1", () => { expect(computeDopamineRpe(false, false, 0.5, 0.5)[0]).toBeCloseTo(1.0, 1); });
  it("da in [0, 3]", () => { expect(computeDopamineRpe(true, false, 1.0, 0.1)[0]).toBeLessThanOrEqual(3.0); expect(computeDopamineRpe(false, true, 1.0, 0.9)[0]).toBeGreaterThanOrEqual(0.0); });
  it("baseline increases on positive", () => { expect(computeDopamineRpe(true, false, 0.5, 0.5)[1]).toBeGreaterThan(0.5); });
});

describe("computeNorepinephrineArousal", () => {
  it("error -> ne increases", () => { expect(computeNorepinephrineArousal(true, 1.0, 0.0)[0]).toBeGreaterThan(1.0); });
  it("no error -> ne decays toward 1", () => { expect(computeNorepinephrineArousal(false, 1.5, 0.0)[0]).toBeLessThan(1.5); });
  it("ne in [0.3, 2.0]", () => { expect(computeNorepinephrineArousal(true, 2.0, 0.0)[0]).toBeLessThanOrEqual(2.0); expect(computeNorepinephrineArousal(false, 0.3, 0.0)[0]).toBeGreaterThanOrEqual(0.3); });
});

describe("applyCrossCoupling", () => {
  it("channels within bounds", () => { const [da, ne, ach, ser] = applyCrossCoupling(2.0, 1.5, 1.2, 0.8); expect(da).toBeGreaterThanOrEqual(0.0); expect(da).toBeLessThanOrEqual(3.0); expect(ne).toBeGreaterThanOrEqual(0.3); expect(ach).toBeGreaterThanOrEqual(0.3); expect(ser).toBeGreaterThanOrEqual(0.3); });
  it("at baseline no coupling change", () => { const [da, ne, ach, ser] = applyCrossCoupling(1.0, 1.0, 1.0, 1.0); expect(da).toBeCloseTo(1.0, 5); expect(ne).toBeCloseTo(1.0, 5); expect(ach).toBeCloseTo(1.0, 5); expect(ser).toBeCloseTo(1.0, 5); });
});

describe("updateState", () => {
  it("channels bounded", () => { const s = updateState(makeNeuromodulatoryState(), makeOperationSignals({errorEncountered:true,novelEntities:3,totalEntities:5})); expect(s.dopamine).toBeGreaterThanOrEqual(0.0); expect(s.dopamine).toBeLessThanOrEqual(3.0); expect(s.norepinephrine).toBeGreaterThanOrEqual(0.3); });
  it("positive outcome increases DA", () => { const s = updateState(makeNeuromodulatoryState(), makeOperationSignals({testPassed:true})); expect(s.dopamine).toBeGreaterThan(makeNeuromodulatoryState().dopamine); });
});

describe("computeCompositeModulation — Dawes 1979", () => {
  it("heat_modulation = avg of 4 channels", () => { const s = makeNeuromodulatoryState({dopamine:1.2,norepinephrine:0.8,acetylcholine:1.5,serotonin:0.9}); const r = computeCompositeModulation(s); expect(r["heat_modulation"] as number).toBeCloseTo((1.2+0.8+1.5+0.9)/4, 4); });
  it("contains cascade_gate", () => { expect(computeCompositeModulation(makeNeuromodulatoryState())).toHaveProperty("cascade_gate"); });
});

describe("serialization", () => {
  it("round-trip identity", () => { const s = makeNeuromodulatoryState({dopamine:1.5,norepinephrine:0.8,daBaseline:0.6}); const r = stateFromDict(stateToDict(s)); expect(r.dopamine).toBeCloseTo(1.5, 4); expect(r.daBaseline).toBeCloseTo(0.6, 4); });
});
