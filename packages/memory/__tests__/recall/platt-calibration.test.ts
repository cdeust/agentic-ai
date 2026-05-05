/**
 * Tests for platt-calibration.ts — Platt 1999 logistic calibration.
 *
 * Invariant: fitPlatt returns PlattParams only when >= MIN_SAMPLES.
 *   calibrateScore returns raw score when params is null.
 * Happy path: fit on well-separated samples.
 * Error path: too few samples, degenerate (all-same-label) samples.
 */

import { describe, it, expect } from "vitest";
import {
  MIN_SAMPLES,
  fitPlatt,
  calibrateScore,
  calibrateScores,
  pairwiseDiscrimination,
  type TrainingSample,
} from "../../src/recall/platt-calibration.js";

// Generate balanced training samples for testing
function makeSamples(n: number): TrainingSample[] {
  const samples: TrainingSample[] = [];
  for (let i = 0; i < n; i++) {
    // Label 1 for high raw scores, 0 for low raw scores
    const rawScore = (i / n) * 2 - 1; // [-1, 1]
    samples.push({ rawScore, label: rawScore > 0 ? 1 : 0 });
  }
  return samples;
}

describe("fitPlatt", () => {
  it("returns null for too few samples", () => {
    const samples = makeSamples(MIN_SAMPLES - 1);
    expect(fitPlatt(samples)).toBeNull();
  });

  it("returns null for degenerate all-positive samples", () => {
    const samples: TrainingSample[] = Array.from({ length: MIN_SAMPLES }, (_, i) => ({
      rawScore: i / MIN_SAMPLES,
      label: 1,
    }));
    expect(fitPlatt(samples)).toBeNull();
  });

  it("returns PlattParams with finite A and B for valid samples", () => {
    const samples = makeSamples(MIN_SAMPLES + 10);
    const params = fitPlatt(samples);
    expect(params).not.toBeNull();
    if (params) {
      expect(isFinite(params.A)).toBe(true);
      expect(isFinite(params.B)).toBe(true);
      expect(params.nSamples).toBe(MIN_SAMPLES + 10);
    }
  });
});

describe("calibrateScore", () => {
  it("returns raw score when params is null (no-op)", () => {
    expect(calibrateScore(0.8, null)).toBe(0.8);
  });

  it("returns calibrated score in (0, 1) for valid params", () => {
    const samples = makeSamples(MIN_SAMPLES + 10);
    const params = fitPlatt(samples);
    if (params) {
      const calibrated = calibrateScore(0.5, params);
      expect(calibrated).toBeGreaterThan(0);
      expect(calibrated).toBeLessThan(1);
    }
  });
});

describe("calibrateScores", () => {
  it("returns copy of raw scores when params is null", () => {
    const raw = [0.1, 0.5, 0.9];
    const calibrated = calibrateScores(raw, null);
    expect(calibrated).toEqual(raw);
    expect(calibrated).not.toBe(raw); // copy, not same reference
  });

  it("returns array of same length", () => {
    const samples = makeSamples(MIN_SAMPLES + 10);
    const params = fitPlatt(samples);
    const raw = [0.1, 0.5, 0.9];
    const calibrated = calibrateScores(raw, params);
    expect(calibrated).toHaveLength(raw.length);
  });
});

describe("pairwiseDiscrimination", () => {
  it("returns 0.5 for empty lists", () => {
    expect(pairwiseDiscrimination(null, [], [])).toBe(0.5);
  });

  it("returns > 0.5 when useful scores are higher", () => {
    const disc = pairwiseDiscrimination(null, [0.9, 0.8], [0.2, 0.3]);
    expect(disc).toBeGreaterThan(0.5);
  });

  it("returns 0 when not-useful scores dominate", () => {
    const disc = pairwiseDiscrimination(null, [0.1], [0.9]);
    expect(disc).toBe(0.0);
  });
});
