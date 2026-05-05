/**
 * Tests for oscillatory-phases.ts
 *
 * Verifies: Hasselmo 2002 sigmoid gate; ThetaPhase classification;
 * encoding/retrieval strength complementarity (enc + ret = 1.3);
 * gamma binding; SWR triggering.
 */

import { describe, it, expect } from "vitest";
import {
  classifyThetaPhase,
  computeEncodingStrength,
  computeRetrievalStrength,
  computeAchFromPhase,
  canBindItem,
  gammaBindingStrength,
  shouldGenerateSWR,
  computeReplayPriority,
  SUPPRESSION_X,
  GAMMA_CAPACITY,
} from "../../src/consolidation/oscillatory-phases.js";

describe("classifyThetaPhase", () => {
  it("returns encoding for phase 0.25", () => {
    expect(classifyThetaPhase(0.25)).toBe("encoding");
  });

  it("returns retrieval for phase 0.75", () => {
    expect(classifyThetaPhase(0.75)).toBe("retrieval");
  });

  it("returns transition near phase 0.5", () => {
    expect(classifyThetaPhase(0.5)).toBe("transition");
  });
});

describe("encoding + retrieval = 2 - X (Hasselmo 2002 invariant)", () => {
  // source: Hasselmo, Bodelon & Wyble (2002) Neural Computation 14:793-817
  // enc + ret = 2 - X = 1.3 at all phases
  const TARGET_SUM = 2 - SUPPRESSION_X; // 1.3

  it("holds at encoding phase 0.25", () => {
    const enc = computeEncodingStrength(0.25);
    const ret = computeRetrievalStrength(0.25);
    expect(enc + ret).toBeCloseTo(TARGET_SUM, 3);
  });

  it("holds at retrieval phase 0.75", () => {
    const enc = computeEncodingStrength(0.75);
    const ret = computeRetrievalStrength(0.75);
    expect(enc + ret).toBeCloseTo(TARGET_SUM, 3);
  });

  it("holds at transition phase 0.5", () => {
    const enc = computeEncodingStrength(0.5);
    const ret = computeRetrievalStrength(0.5);
    expect(enc + ret).toBeCloseTo(TARGET_SUM, 3);
  });
});

describe("computeAchFromPhase", () => {
  it("is high during encoding phase", () => {
    expect(computeAchFromPhase(0.25)).toBeGreaterThan(0.9);
  });

  it("approaches ACH_BASELINE during retrieval", () => {
    const ach = computeAchFromPhase(0.75);
    expect(ach).toBeLessThan(0.4);
  });
});

describe("gamma binding", () => {
  it("canBindItem returns true when below capacity", () => {
    expect(canBindItem(3, GAMMA_CAPACITY)).toBe(true);
  });

  it("canBindItem returns false when at capacity", () => {
    expect(canBindItem(GAMMA_CAPACITY, GAMMA_CAPACITY)).toBe(false);
  });

  it("gammaBindingStrength returns value in [0.5, 1.0]", () => {
    for (let i = 0; i < GAMMA_CAPACITY; i++) {
      const strength = gammaBindingStrength(i, GAMMA_CAPACITY);
      expect(strength).toBeGreaterThanOrEqual(0.5);
      expect(strength).toBeLessThanOrEqual(1.0);
    }
  });
});

describe("shouldGenerateSWR", () => {
  it("returns false when interval too short", () => {
    expect(shouldGenerateSWR(10, 0.1)).toBe(false);
  });

  it("returns false when too few operations", () => {
    expect(shouldGenerateSWR(1, 2.0)).toBe(false);
  });

  it("returns true when conditions are met", () => {
    expect(shouldGenerateSWR(20, 2.0, 5.0)).toBe(true);
  });
});

describe("computeReplayPriority", () => {
  it("returns value in [0, 1]", () => {
    const priority = computeReplayPriority(0.5, 0.8, 0.7, 2, 24.0);
    expect(priority).toBeGreaterThanOrEqual(0.0);
    expect(priority).toBeLessThanOrEqual(1.0);
  });

  it("high importance increases priority", () => {
    const high = computeReplayPriority(0.5, 1.0, 0.5, 1, 1.0);
    const low = computeReplayPriority(0.5, 0.0, 0.5, 1, 1.0);
    expect(high).toBeGreaterThan(low);
  });
});
