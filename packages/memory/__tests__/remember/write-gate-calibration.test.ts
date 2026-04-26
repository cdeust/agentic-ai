/**
 * write-gate-calibration.test.ts — Unit tests for EMA calibration.
 *
 * Invariants tested:
 *   I1. CalibrationState.threshold ∈ [MIN_THRESHOLD, MAX_THRESHOLD].
 *   I2. CalibrationState.acceptanceEma ∈ [0, 1].
 *   I3. CalibrationState.totalObservations monotonically increases.
 *   I4. lastAdjustmentAt <= totalObservations.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  EMA_DECAY,
  MAX_THRESHOLD,
  MIN_SAMPLES_BEFORE_ADJUST,
  MIN_THRESHOLD,
  computeThresholdAdjustment,
  effectiveThreshold,
  observeGateDecision,
  record,
  resetAllStates,
  updateAcceptanceEma,
} from "../../src/remember/write-gate-calibration.js";

afterEach(() => {
  resetAllStates();
});

describe("updateAcceptanceEma", () => {
  it("moves toward 1.0 when accepted=true", () => {
    const ema = updateAcceptanceEma(0.5, true, 0.95);
    // EMA' = 0.95 * 0.5 + 0.05 * 1.0 = 0.475 + 0.05 = 0.525
    expect(ema).toBeCloseTo(0.525, 5);
  });

  it("moves toward 0.0 when accepted=false", () => {
    const ema = updateAcceptanceEma(0.5, false, 0.95);
    // EMA' = 0.95 * 0.5 + 0.05 * 0.0 = 0.475
    expect(ema).toBeCloseTo(0.475, 5);
  });

  it("clamps output to [0, 1]", () => {
    const ema = updateAcceptanceEma(1.0, true, 1.0); // edge: decay=1 never moves
    expect(ema).toBeGreaterThanOrEqual(0);
    expect(ema).toBeLessThanOrEqual(1);
  });

  it("uses EMA_DECAY by default", () => {
    const ema = updateAcceptanceEma(0.5, true);
    const expected = EMA_DECAY * 0.5 + (1 - EMA_DECAY) * 1.0;
    expect(ema).toBeCloseTo(expected, 5);
  });
});

describe("computeThresholdAdjustment", () => {
  it("does not adjust when within tolerance band", () => {
    // EMA = 0.50, target = 0.50, tolerance = 0.15 → no adjustment
    expect(computeThresholdAdjustment(0.4, 0.5)).toBe(0.4);
  });

  it("raises threshold when acceptance is too high (gate too permissive)", () => {
    // EMA = 0.75, target = 0.50, delta = 0.25 > 0.15 → raise
    const t = computeThresholdAdjustment(0.4, 0.75);
    expect(t).toBeGreaterThan(0.4);
  });

  it("lowers threshold when acceptance is too low (gate too strict)", () => {
    // EMA = 0.20, target = 0.50, delta = -0.30 < -0.15 → lower
    const t = computeThresholdAdjustment(0.4, 0.2);
    expect(t).toBeLessThan(0.4);
  });

  it("clamps to [MIN_THRESHOLD, MAX_THRESHOLD]", () => {
    // At ceiling
    expect(computeThresholdAdjustment(MAX_THRESHOLD, 1.0)).toBeLessThanOrEqual(
      MAX_THRESHOLD,
    );
    // At floor
    expect(computeThresholdAdjustment(MIN_THRESHOLD, 0.0)).toBeGreaterThanOrEqual(
      MIN_THRESHOLD,
    );
  });
});

describe("observeGateDecision", () => {
  it("increments totalObservations (invariant I3)", () => {
    const s0 = { domain: "", threshold: 0.4, acceptanceEma: 0.5, totalObservations: 0, lastAdjustmentAt: 0 };
    const s1 = observeGateDecision(s0, true);
    expect(s1.totalObservations).toBe(1);
  });

  it("does not adjust before MIN_SAMPLES_BEFORE_ADJUST", () => {
    let state = { domain: "", threshold: 0.4, acceptanceEma: 0.5, totalObservations: 0, lastAdjustmentAt: 0 };
    // Drive with always-accepted (high EMA) but stay below min samples.
    for (let i = 0; i < MIN_SAMPLES_BEFORE_ADJUST - 1; i++) {
      state = observeGateDecision(state, true);
    }
    expect(state.threshold).toBe(0.4); // unchanged
  });

  it("adjusts threshold after MIN_SAMPLES_BEFORE_ADJUST all-accepted", () => {
    let state = { domain: "", threshold: 0.4, acceptanceEma: 0.5, totalObservations: 0, lastAdjustmentAt: 0 };
    for (let i = 0; i < MIN_SAMPLES_BEFORE_ADJUST + 20; i++) {
      state = observeGateDecision(state, true); // all accepted
    }
    // EMA should be high → threshold raised
    expect(state.threshold).toBeGreaterThan(0.4);
  });

  it("lastAdjustmentAt <= totalObservations at all times (invariant I4)", () => {
    let state = { domain: "", threshold: 0.4, acceptanceEma: 0.5, totalObservations: 0, lastAdjustmentAt: 0 };
    for (let i = 0; i < 30; i++) {
      state = observeGateDecision(state, i % 2 === 0);
      expect(state.lastAdjustmentAt).toBeLessThanOrEqual(state.totalObservations);
    }
  });

  it("threshold stays within [MIN, MAX] invariant (invariant I1)", () => {
    let state = { domain: "", threshold: 0.4, acceptanceEma: 0.5, totalObservations: 0, lastAdjustmentAt: 0 };
    for (let i = 0; i < 200; i++) {
      state = observeGateDecision(state, true); // push toward ceiling
    }
    expect(state.threshold).toBeLessThanOrEqual(MAX_THRESHOLD);
    expect(state.threshold).toBeGreaterThanOrEqual(MIN_THRESHOLD);
  });
});

describe("record + effectiveThreshold", () => {
  it("returns defaultThreshold before any observations", () => {
    expect(effectiveThreshold("new-domain", 0.4)).toBe(0.4);
  });

  it("stores state persistently for subsequent calls", () => {
    record("test-domain", true);
    const state = effectiveThreshold("test-domain", 0.4);
    expect(typeof state).toBe("number");
  });
});
