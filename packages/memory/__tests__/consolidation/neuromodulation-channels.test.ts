/**
 * Tests for neuromodulation-channels.ts
 *
 * Verifies: DA RPE clamping [0,3]; NE habituation; 5-HT EMA; cross-coupling bounds.
 */

import { describe, it, expect } from "vitest";
import {
  computeDopamineRpe,
  computeNorepinephrineArousal,
  computeSerotoninExploration,
  applyCrossCoupling,
} from "../../src/consolidation/neuromodulation-channels.js";

describe("computeDopamineRpe", () => {
  it("positive outcome raises DA above baseline", () => {
    const [da] = computeDopamineRpe(true, false, 0.8, 0.5);
    expect(da).toBeGreaterThan(1.0);
  });

  it("negative outcome lowers DA below 1.0", () => {
    const [da] = computeDopamineRpe(false, true, 0.5, 0.5);
    expect(da).toBeLessThanOrEqual(1.0);
  });

  it("DA is clamped to [0.0, 3.0] — Schultz 1997 bounds", () => {
    const [da] = computeDopamineRpe(true, false, 1.0, 0.1);
    expect(da).toBeGreaterThanOrEqual(0.0);
    expect(da).toBeLessThanOrEqual(3.0);
  });

  it("updated baseline stays in [0.1, 0.9]", () => {
    for (const importance of [0, 0.5, 1.0]) {
      const [, newBaseline] = computeDopamineRpe(true, false, importance, 0.5);
      expect(newBaseline).toBeGreaterThanOrEqual(0.1);
      expect(newBaseline).toBeLessThanOrEqual(0.9);
    }
  });
});

describe("computeNorepinephrineArousal", () => {
  it("error triggers NE burst", () => {
    const [ne0] = computeNorepinephrineArousal(false, 1.0, 0.0);
    const [ne1] = computeNorepinephrineArousal(true, 1.0, 0.0);
    expect(ne1).toBeGreaterThan(ne0);
  });

  it("NE stays in [0.3, 2.0]", () => {
    for (const err of [true, false]) {
      const [ne] = computeNorepinephrineArousal(err, 1.0, 0.5);
      expect(ne).toBeGreaterThanOrEqual(0.3);
      expect(ne).toBeLessThanOrEqual(2.0);
    }
  });

  it("adaptation increases on repeated errors", () => {
    let adapt = 0.0;
    for (let i = 0; i < 5; i++) {
      const [, newAdapt] = computeNorepinephrineArousal(true, 1.0, adapt);
      expect(newAdapt).toBeGreaterThanOrEqual(adapt);
      adapt = newAdapt;
    }
  });
});

describe("computeSerotoninExploration", () => {
  it("high novelty raises 5-HT toward 1.8", () => {
    const ser = computeSerotoninExploration(0.0, 10, 10, 0.5);
    expect(ser).toBeGreaterThan(0.5);
  });

  it("high schema match lowers 5-HT toward 0.3", () => {
    const ser = computeSerotoninExploration(1.0, 0, 10, 1.5);
    expect(ser).toBeLessThan(1.5);
  });
});

describe("applyCrossCoupling", () => {
  it("returns all four channels", () => {
    const [da, ne, ach, ser] = applyCrossCoupling(1.0, 1.0, 1.0, 1.0);
    expect(da).toBeDefined();
    expect(ne).toBeDefined();
    expect(ach).toBeDefined();
    expect(ser).toBeDefined();
  });

  it("DA stays in [0, 3]", () => {
    const [da] = applyCrossCoupling(3.0, 2.0, 2.0, 0.3);
    expect(da).toBeGreaterThanOrEqual(0.0);
    expect(da).toBeLessThanOrEqual(3.0);
  });

  it("NE, ACh, 5-HT stay in [0.3, 2.0]", () => {
    const [, ne, ach, ser] = applyCrossCoupling(1.5, 1.5, 1.5, 1.5);
    for (const v of [ne, ach, ser]) {
      expect(v).toBeGreaterThanOrEqual(0.3);
      expect(v).toBeLessThanOrEqual(2.0);
    }
  });
});
