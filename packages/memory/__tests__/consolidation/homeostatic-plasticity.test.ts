/**
 * Homeostatic plasticity — pure function tests.
 *
 * Rederived from cited papers:
 *
 * 1. Turrigiano synaptic scaling (Tetzlaff 2011 Eq. 3):
 *    factor = 1 + alpha * (r_target - r_actual)
 *    For alpha=0.05, target=0.4, actual=0.3: factor = 1 + 0.05 * 0.1 = 1.005
 *    All heats scale by 1.005, preserving relative ordering.
 *
 * 2. BCM threshold (Bienenstock, Cooper & Munro 1982):
 *    theta_M = E[c^2]; updated via EMA: theta_new = 0.95 * theta_old + 0.05 * E[c^2]
 *    For activity levels [0.3, 0.5]: E[c^2] = (0.09 + 0.25)/2 = 0.17
 *    theta_new = 0.95 * 0.5 + 0.05 * 0.17 = 0.4750 + 0.0085 = 0.4835
 *
 * 3. Wilcox (2012) sigma-rule cohort detection:
 *    hot cohort threshold = mean + sigma * std
 *    For sigma=0.5, mean=0.4, std=0.2: threshold = 0.4 + 0.5 * 0.2 = 0.5
 *    Heats [0.3, 0.45, 0.6, 0.7] → indices 2, 3 above threshold.
 */

import { describe, it, expect } from "vitest";
import {
  computeScalingFactor,
  applySynapticScaling,
  computeBcmThreshold,
  computeLtpLtdModulation,
  computeExcitabilityAdjustment,
  applyExcitabilityBounds,
  detectHotCohort,
  applyCohortCorrection,
} from "../../src/consolidation/homeostatic-plasticity.js";

describe("computeScalingFactor (Turrigiano 2008 / Tetzlaff 2011 Eq. 3)", () => {
  it("actual < target: factor > 1 (boost)", () => {
    // Rederived: factor = 1 + 0.05 * (0.4 - 0.3) = 1 + 0.005 = 1.005
    const factor = computeScalingFactor(0.3, 0.4, 0.05);
    expect(factor).toBeCloseTo(1.005, 5);
  });

  it("actual > target: factor < 1 (dampen)", () => {
    // Rederived: factor = 1 + 0.05 * (0.4 - 0.6) = 1 - 0.01 = 0.99
    const factor = computeScalingFactor(0.6, 0.4, 0.05);
    expect(factor).toBeCloseTo(0.99, 5);
  });

  it("actual == target: factor == 1.0 (no-op)", () => {
    const factor = computeScalingFactor(0.4, 0.4, 0.05);
    expect(factor).toBe(1.0);
  });
});

describe("applySynapticScaling", () => {
  it("preserves relative ordering (Turrigiano key finding)", () => {
    const heats = [0.2, 0.5, 0.8];
    const factor = 1.05;
    const scaled = applySynapticScaling(heats, factor);
    // Relative ordering preserved: 0.21 < 0.525 < 0.84
    expect(scaled[0]).toBeLessThan(scaled[1]!);
    expect(scaled[1]).toBeLessThan(scaled[2]!);
  });

  it("clamps to [0, 1]", () => {
    const scaled = applySynapticScaling([0.95, 0.99], 1.1);
    for (const h of scaled) {
      expect(h).toBeLessThanOrEqual(1.0);
      expect(h).toBeGreaterThanOrEqual(0.0);
    }
  });
});

describe("computeBcmThreshold (BCM 1982)", () => {
  it("known input: [0.3, 0.5], current=0.5 → EMA update", () => {
    // Rederived: E[c^2] = (0.09 + 0.25) / 2 = 0.17
    // theta_new = 0.95 * 0.5 + 0.05 * 0.17 = 0.475 + 0.0085 = 0.4835
    const result = computeBcmThreshold([0.3, 0.5], 0.5);
    expect(result).toBeCloseTo(0.4835, 4);
  });

  it("empty activity levels: returns current threshold unchanged", () => {
    expect(computeBcmThreshold([], 0.42)).toBe(0.42);
  });

  it("high activity → higher threshold (prevents LTP saturation)", () => {
    const lowActivity = computeBcmThreshold([0.1, 0.2], 0.5);
    const highActivity = computeBcmThreshold([0.8, 0.9], 0.5);
    expect(highActivity).toBeGreaterThan(lowActivity);
  });
});

describe("computeLtpLtdModulation (BCM phi function)", () => {
  it("c > theta: LTP multiplier > 1, LTD multiplier < 1", () => {
    const [ltp, ltd] = computeLtpLtdModulation(0.7, 0.4);
    // phi = 0.7 * (0.7 - 0.4) = 0.21; ltp = 1 + 0.21 = 1.21; ltd = 1 - 0.21 = 0.79
    expect(ltp).toBeGreaterThan(1.0);
    expect(ltd).toBeLessThan(1.0);
  });

  it("c < theta: LTD multiplier > 1, LTP multiplier < 1", () => {
    const [ltp, ltd] = computeLtpLtdModulation(0.2, 0.4);
    // phi = 0.2 * (0.2 - 0.4) = -0.04; |phi|=0.04; ltd = 1.04; ltp = 0.96
    expect(ltd).toBeGreaterThan(1.0);
    expect(ltp).toBeLessThan(1.0);
  });

  it("c == theta: both multipliers = 1.0", () => {
    const [ltp, ltd] = computeLtpLtdModulation(0.4, 0.4);
    expect(ltp).toBeCloseTo(1.0, 5);
    expect(ltd).toBeCloseTo(1.0, 5);
  });

  it("both multipliers always in [0, 2]", () => {
    for (const c of [0.0, 0.3, 0.5, 0.8, 1.0]) {
      const [ltp, ltd] = computeLtpLtdModulation(c, 0.4);
      expect(ltp).toBeGreaterThanOrEqual(0.0);
      expect(ltp).toBeLessThanOrEqual(2.0);
      expect(ltd).toBeGreaterThanOrEqual(0.0);
      expect(ltd).toBeLessThanOrEqual(2.0);
    }
  });
});

describe("detectHotCohort (Wilcox 2012 sigma rule)", () => {
  it("known input: mean=0.4, std=0.2, sigma=0.5 → threshold=0.5", () => {
    // Rederived: threshold = 0.4 + 0.5 * 0.2 = 0.5
    // heats [0.3, 0.45, 0.6, 0.7] → indices 2, 3 above 0.5
    const heats = [0.3, 0.45, 0.6, 0.7];
    const result = detectHotCohort(heats, 0.4, 0.2, 0.5);
    expect(result).toEqual([2, 3]);
  });

  it("empty heats → empty cohort", () => {
    expect(detectHotCohort([], 0.4, 0.2)).toEqual([]);
  });

  it("std=0 → empty cohort (degenerate distribution)", () => {
    expect(detectHotCohort([0.5, 0.5, 0.5], 0.5, 0)).toEqual([]);
  });
});

describe("applyCohortCorrection (Hinton & Salakhutdinov 2006)", () => {
  it("hot cohort pulled toward target; others unchanged", () => {
    const heats = [0.3, 0.8];
    const corrected = applyCohortCorrection(heats, [1], 0.4, 0.3);
    // cohort index 1: delta = 0.3 * (0.8 - 0.4) = 0.12; new = 0.8 - 0.12 = 0.68
    expect(corrected[0]).toBe(0.3); // unchanged
    expect(corrected[1]).toBeCloseTo(0.68, 5);
  });

  it("repeated application converges toward target (multi-value distribution)", () => {
    // Need a distribution with non-zero std for detectHotCohort to fire.
    // Use [0.2, 0.3, 0.9] — the 0.9 value is the hot cohort.
    let heats = [0.2, 0.3, 0.9];
    for (let i = 0; i < 30; i++) {
      const mean = heats.reduce((s, h) => s + h, 0) / heats.length;
      const variance = heats.reduce((s, h) => s + Math.pow(h - mean, 2), 0) / heats.length;
      const std = Math.sqrt(variance);
      if (std <= 0) break;
      const cohort = detectHotCohort(heats, mean, std, 0.5);
      if (cohort.length > 0) {
        heats = applyCohortCorrection(heats, cohort, 0.4, 0.3);
      } else {
        break;
      }
    }
    // The hot value (index 2) should have been pulled toward 0.4
    // (started at 0.9, target=0.4, strength=0.3 per cycle)
    expect(heats[2]).toBeLessThan(0.9);
    expect(heats[2]).toBeGreaterThan(0.0);
  });
});

describe("excitability regulation", () => {
  it("more active than target: negative adjustment (dampen)", () => {
    // targetActiveFraction=0.3, 5 of 5 are active → fraction=1.0
    // deviation = 0.3 - 1.0 = -0.7; adjustment = -0.07
    const adj = computeExcitabilityAdjustment([0.6, 0.7, 0.8, 0.9, 1.0], {
      targetActiveFraction: 0.3,
      activeThreshold: 0.5,
    });
    expect(adj).toBeLessThan(0);
  });

  it("applyExcitabilityBounds: clamps to [0.1, 0.9]", () => {
    expect(applyExcitabilityBounds(0.05, -0.1)).toBe(0.1);
    expect(applyExcitabilityBounds(0.95, 0.1)).toBe(0.9);
  });
});
