import { describe, it, expect } from "vitest";
import { computeCalciumRise, computeCalciumDecay, propagateCalciumWave, classifyCalciumRegime, computeLtpModulation, computeHeterosynapticDepression, computeMetabolicRate, applyMetabolicModulation, CA_LOW_THRESHOLD, CA_MEDIUM_THRESHOLD, METABOLIC_BASELINE, METABOLIC_BOOST, METABOLIC_STARVATION } from "../../src/consolidation/tripartite-calcium.js";

describe("computeCalciumRise — De Pitta 2009", () => {
  it("no change with 0 events", () => { expect(computeCalciumRise(0.4, 0)).toBe(0.4); });
  it("increases with events", () => { expect(computeCalciumRise(0.0, 5)).toBeGreaterThan(0.0); });
  it("in [0, 1]", () => { for (const e of [0, 1, 5, 20]) { const c = computeCalciumRise(0.5, e); expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(1); } });
  it("monotone with events", () => { expect(computeCalciumRise(0.0, 5)).toBeGreaterThan(computeCalciumRise(0.0, 1)); });
});

describe("computeCalciumDecay", () => {
  it("no change with 0 time", () => { expect(computeCalciumDecay(0.8, 0)).toBe(0.8); });
  it("decreases elevated calcium", () => { expect(computeCalciumDecay(0.8, 5.0)).toBeLessThan(0.8); });
  it("monotone with time", () => { expect(computeCalciumDecay(0.8, 5)).toBeLessThanOrEqual(computeCalciumDecay(0.8, 1)); });
});

describe("propagateCalciumWave", () => {
  it("no propagation below LOW_THRESHOLD", () => { const n = [0.1, 0.2]; expect(propagateCalciumWave(CA_LOW_THRESHOLD - 0.01, n)).toEqual(n); });
  it("increases neighbors above LOW_THRESHOLD", () => { const n = [0.1, 0.2]; const r = propagateCalciumWave(0.8, n); for (let i = 0; i < n.length; i++) expect(r[i]).toBeGreaterThanOrEqual(n[i]!); });
  it("neighbors in [0, 1]", () => { for (const v of propagateCalciumWave(1.0, [0.9, 1.0], 0.5)) { expect(v).toBeLessThanOrEqual(1.0); } });
});

describe("classifyCalciumRegime", () => {
  it("quiescent below LOW", () => { expect(classifyCalciumRegime(CA_LOW_THRESHOLD - 0.01)).toBe("quiescent"); });
  it("facilitation between thresholds", () => { expect(classifyCalciumRegime(CA_LOW_THRESHOLD + 0.01)).toBe("facilitation"); });
  it("depression above MEDIUM", () => { expect(classifyCalciumRegime(CA_MEDIUM_THRESHOLD + 0.01)).toBe("depression"); });
});

describe("computeLtpModulation", () => {
  it("1.0 in quiescent", () => { expect(computeLtpModulation(0.0)).toBe(1.0); });
  it(">1.0 in facilitation", () => { expect(computeLtpModulation(CA_LOW_THRESHOLD + 0.1)).toBeGreaterThan(1.0); });
  it("<1.0 in depression", () => { expect(computeLtpModulation(CA_MEDIUM_THRESHOLD + 0.2)).toBeLessThan(1.0); });
  it("floor >= 0.5", () => { expect(computeLtpModulation(1.0)).toBeGreaterThanOrEqual(0.5); });
});

describe("computeHeterosynapticDepression", () => {
  it("all 1.0 below MEDIUM", () => { expect(computeHeterosynapticDepression(0.2, [0.5, 0.7])).toEqual([1.0, 1.0]); });
  it("all in [0.5, 1.0] in depression", () => { for (const v of computeHeterosynapticDepression(0.9, [0.3, 0.5, 0.8])) { expect(v).toBeGreaterThanOrEqual(0.5); expect(v).toBeLessThanOrEqual(1.0); } });
});

describe("computeMetabolicRate", () => {
  it("returns baseline at 0 time", () => { expect(computeMetabolicRate(10.0, 0)).toBe(METABOLIC_BASELINE); });
  it("bounded", () => { for (const [a, t] of [[0, 100], [100, 1]] as [number, number][]) { const r = computeMetabolicRate(a, t); expect(r).toBeGreaterThanOrEqual(METABOLIC_STARVATION); expect(r).toBeLessThanOrEqual(METABOLIC_BOOST); } });
});

describe("applyMetabolicModulation", () => {
  it("high rate -> slower decay", () => { expect(applyMetabolicModulation(0.5, METABOLIC_BOOST)).toBeGreaterThan(applyMetabolicModulation(0.5, METABOLIC_STARVATION)); });
  it("result in [0, 1]", () => { for (const rate of [0.1, 0.5, 1.0, 1.5]) { const r = applyMetabolicModulation(0.5, rate); expect(r).toBeGreaterThanOrEqual(0); expect(r).toBeLessThanOrEqual(1); } });
});
