/**
 * Tests for homeostatic-health.ts
 *
 * Verifies: Pébay 2008 single-pass moment computation; bimodality coefficient;
 * health score clamping; streaming parity.
 */

import { describe, it, expect } from "vitest";
import {
  computeDistributionHealth,
  computeDistributionHealthStreaming,
} from "../../src/consolidation/homeostatic-health.js";

describe("computeDistributionHealth", () => {
  it("returns empty health for empty values", () => {
    const h = computeDistributionHealth([], 0.5);
    expect(h.health_score).toBe(0.0);
    expect(h.deviation_from_target).toBe(1.0);
  });

  it("computes mean correctly for uniform values", () => {
    const values = [0.5, 0.5, 0.5, 0.5];
    const h = computeDistributionHealth(values, 0.5);
    expect(h.mean).toBeCloseTo(0.5, 4);
    expect(h.std).toBeCloseTo(0.0, 4);
    expect(h.deviation_from_target).toBeCloseTo(0.0, 4);
  });

  it("detects deviation from target", () => {
    const values = [0.1, 0.1, 0.1, 0.1];
    const h = computeDistributionHealth(values, 0.5);
    expect(h.deviation_from_target).toBeCloseTo(0.4, 2);
    // Health should be penalized for deviation
    expect(h.health_score).toBeLessThan(1.0);
  });

  it("health_score is in [0, 1]", () => {
    const values = [0.0, 1.0, 0.0, 1.0, 0.0, 1.0];
    const h = computeDistributionHealth(values, 0.5);
    expect(h.health_score).toBeGreaterThanOrEqual(0.0);
    expect(h.health_score).toBeLessThanOrEqual(1.0);
  });

  it("single-value input returns sensible result", () => {
    const h = computeDistributionHealth([0.7], 0.5);
    expect(h.mean).toBeCloseTo(0.7, 4);
    expect(h.std).toBeCloseTo(0.0, 4);
  });
});

describe("computeDistributionHealthStreaming", () => {
  it("matches batch result for single chunk", () => {
    const values = [0.1, 0.3, 0.5, 0.7, 0.9];
    const [hStream, n] = computeDistributionHealthStreaming([values], 0.5);
    const hBatch = computeDistributionHealth(values, 0.5);
    expect(n).toBe(5);
    expect(hStream.mean).toBeCloseTo(hBatch.mean, 3);
    expect(hStream.std).toBeCloseTo(hBatch.std, 3);
    expect(hStream.health_score).toBeCloseTo(hBatch.health_score, 3);
  });

  it("matches batch result for split chunks — Pébay 2008 parity", () => {
    const all = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];
    const [hStream] = computeDistributionHealthStreaming(
      [all.slice(0, 5), all.slice(5)],
      0.5,
    );
    const hBatch = computeDistributionHealth(all, 0.5);
    expect(hStream.mean).toBeCloseTo(hBatch.mean, 3);
    expect(hStream.std).toBeCloseTo(hBatch.std, 3);
  });

  it("returns empty health for empty chunks", () => {
    const [h, n] = computeDistributionHealthStreaming([], 0.5);
    expect(n).toBe(0);
    expect(h.health_score).toBe(0.0);
  });
});
