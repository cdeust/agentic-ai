/**
 * Cascade stages — pure function tests.
 *
 * Rederived from cited papers:
 *
 * 1. Stage-adjusted decay (Kandel 2001):
 *    decay_distance = 1 - 0.95 = 0.05
 *    LABILE: adjusted_distance = 0.05 * 2.0 = 0.10; factor = 1 - 0.10 = 0.90
 *    CONSOLIDATED: adjusted_distance = 0.05 * 0.5 = 0.025; factor = 1 - 0.025 = 0.975
 *    Labile decays faster (0.90 < 0.95), consolidated decays slower (0.975 > 0.95).
 *
 * 2. Permastore floor (Bahrick 1984):
 *    CONSOLIDATED heat_floor = 0.10. Memories at consolidated stage always
 *    retain at least 10% heat even after decades without rehearsal.
 *    Bahrick (1984) showed 30-year retention plateau — modeled as floor=0.10.
 *
 * 3. Interference resistance:
 *    LABILE (vulnerability=0.9): with similarity=0.8:
 *      raw_threat = 0.8 * 0.9 = 0.72; resistance = 1 - 0.72 = 0.28
 *    CONSOLIDATED (vulnerability=0.05): with similarity=0.8:
 *      raw_threat = 0.8 * 0.05 = 0.04; resistance = 1 - 0.04 = 0.96
 */

import { describe, it, expect } from "vitest";
import {
  getHeatFloor,
  getStagePropertiesByName,
  computeStageAdjustedDecay,
  computeInterferenceResistance,
  stageToDict,
} from "../../src/consolidation/cascade-stages.js";

describe("getHeatFloor", () => {
  it("labile: 0.0 — can decay to zero", () => {
    expect(getHeatFloor("labile")).toBe(0.0);
  });

  it("early_ltp: 0.0 — still reversible", () => {
    expect(getHeatFloor("early_ltp")).toBe(0.0);
  });

  it("late_ltp: 0.05 — partial structural support", () => {
    expect(getHeatFloor("late_ltp")).toBe(0.05);
  });

  it("consolidated: 0.10 — permastore (Bahrick 1984)", () => {
    // Rederived: Bahrick (1984) showed 30-year retention plateau.
    // This is modeled as a minimum heat floor of 0.10 for consolidated memories.
    expect(getHeatFloor("consolidated")).toBe(0.10);
  });

  it("reconsolidating: 0.05 — was consolidated, retains partial support", () => {
    expect(getHeatFloor("reconsolidating")).toBe(0.05);
  });

  it("unknown stage defaults to labile floor (0.0)", () => {
    expect(getHeatFloor("unknown_stage")).toBe(0.0);
  });
});

describe("getStagePropertiesByName", () => {
  it("LABILE has decayMultiplier=2.0 — decays 2x faster", () => {
    const props = getStagePropertiesByName("labile");
    expect(props.decayMultiplier).toBe(2.0);
  });

  it("CONSOLIDATED has decayMultiplier=0.5 — decays 2x slower", () => {
    const props = getStagePropertiesByName("consolidated");
    expect(props.decayMultiplier).toBe(0.5);
  });

  it("CONSOLIDATED has highest plasticity resistance (lowest plasticity=0.1)", () => {
    const props = getStagePropertiesByName("consolidated");
    expect(props.plasticity).toBe(0.1);
  });

  it("RECONSOLIDATING has high interference vulnerability (0.8)", () => {
    const props = getStagePropertiesByName("reconsolidating");
    expect(props.interferenceVulnerability).toBe(0.8);
  });
});

describe("computeStageAdjustedDecay (Kandel 2001)", () => {
  it("LABILE: decay_factor lower than base (decays faster)", () => {
    // Rederived from Kandel 2001 stage multiplier:
    // decay_distance = 1 - 0.95 = 0.05
    // adjusted = 0.05 * 2.0 = 0.10; result = 1 - 0.10 = 0.90
    const result = computeStageAdjustedDecay(0.95, "labile");
    expect(result).toBeCloseTo(0.90, 5);
  });

  it("CONSOLIDATED: decay_factor higher than base (decays slower)", () => {
    // Rederived: adjusted = 0.05 * 0.5 = 0.025; result = 1 - 0.025 = 0.975
    const result = computeStageAdjustedDecay(0.95, "consolidated");
    expect(result).toBeCloseTo(0.975, 5);
  });

  it("EARLY_LTP: decay_factor slightly faster than base (multiplier=1.2)", () => {
    // adjusted = 0.05 * 1.2 = 0.06; result = 1 - 0.06 = 0.94
    const result = computeStageAdjustedDecay(0.95, "early_ltp");
    expect(result).toBeCloseTo(0.94, 5);
  });

  it("labile decays faster than consolidated at same base", () => {
    const labile = computeStageAdjustedDecay(0.95, "labile");
    const consolidated = computeStageAdjustedDecay(0.95, "consolidated");
    expect(labile).toBeLessThan(consolidated);
  });

  it("result is always clamped to [0, 1]", () => {
    // Very high decay distance should not go below 0
    const result = computeStageAdjustedDecay(0.1, "labile");
    expect(result).toBeGreaterThanOrEqual(0.0);
    // Near-zero distance should not exceed 1
    const result2 = computeStageAdjustedDecay(0.999, "consolidated");
    expect(result2).toBeLessThanOrEqual(1.0);
  });
});

describe("computeInterferenceResistance", () => {
  it("LABILE (vulnerability=0.9) with similarity=0.8 → low resistance ≈ 0.28", () => {
    // Rederived: raw_threat = 0.8 * 0.9 = 0.72; resistance = 1 - 0.72 = 0.28
    const result = computeInterferenceResistance("labile", 0.8);
    expect(result).toBeCloseTo(0.28, 5);
  });

  it("CONSOLIDATED (vulnerability=0.05) with similarity=0.8 → high resistance ≈ 0.96", () => {
    // Rederived: raw_threat = 0.8 * 0.05 = 0.04; resistance = 1 - 0.04 = 0.96
    const result = computeInterferenceResistance("consolidated", 0.8);
    expect(result).toBeCloseTo(0.96, 5);
  });

  it("zero similarity → full resistance (no threat)", () => {
    const result = computeInterferenceResistance("labile", 0.0);
    expect(result).toBe(1.0);
  });

  it("consolidated always more resistant than labile for same similarity", () => {
    const labile = computeInterferenceResistance("labile", 0.5);
    const consolidated = computeInterferenceResistance("consolidated", 0.5);
    expect(consolidated).toBeGreaterThan(labile);
  });
});

describe("stageToDict serialization", () => {
  it("returns correct shape with stage and properties", () => {
    const d = stageToDict("labile", 0.5, 2);
    expect(d.stage).toBe("labile");
    expect(d.hours_in_stage).toBe(0.5);
    expect(d.replay_count).toBe(2);
    expect(d.decay_multiplier).toBe(2.0);
    expect(d.plasticity).toBe(1.0);
  });
});
