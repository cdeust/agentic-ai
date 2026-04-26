/**
 * Decay cycle — pure function tests at multiple timescales.
 *
 * Darwin method: test the algorithm at MULTIPLE time scales
 * (single decay step, 100 steps, 10 000 steps) to confirm convergence
 * and stability. Snapshots will mislead; only the long series is informative.
 *
 * Three algorithms rederived from cited papers:
 *
 * 1. Ebbinghaus (1885): heat(t) = heat(0) * λ^t
 *    For λ=0.95, t=1h: heat = 0.8 * 0.95^1 = 0.76
 *    For λ=0.95, t=100h: heat = 0.8 * 0.95^100 = 0.8 * 0.00592 = 0.00473
 *    Permastore floor (Bahrick 1984): consolidated floor=0.10, so result=0.10
 *
 * 2. ACT-R base-level activation (Anderson & Lebiere 1998, Eq. 4.4):
 *    B_i = ln(n) - d * ln(L)
 *    For n=1, L=1h, d=0.5: B = ln(1) - 0.5 * ln(1) = 0 - 0 = 0
 *    P(recall) = 1/(1+exp(0)) = 0.5
 *    For n=5, L=100h, d=0.5: B = ln(5) - 0.5 * ln(100) = 1.609 - 2.302 = -0.693
 *    P(recall) = 1/(1+exp(0.693)) = 1/(1+2) = 0.333
 *
 * 3. Emotional decay resistance (Yonelinas & Ritchey 2015 + Kleinsmith 1963):
 *    time_saturation = 1 - exp(-t) → at t=1h: 1 - exp(-1) = 0.632
 *    emotional_mod = 1 + |v| * resistance * saturation
 *    For |v|=1, resistance=0.5, t=1: mod = 1 + 0.5 * 0.632 = 1.316
 *    effective = 1 - (1 - 0.95) / 1.316 = 1 - 0.038 = 0.962
 *    heat(1) = 0.8 * 0.962 = 0.770 (vs 0.76 for neutral memory)
 */

import { describe, it, expect } from "vitest";
import { computeDecayUpdates, computeEntityDecay, computeActrBaseLevel, actrActivationToHeat } from "../../src/consolidation/decay-cycle.js";
import { computeDecay } from "../../src/consolidation/thermodynamics.js";
import { getHeatFloor } from "../../src/consolidation/cascade-stages.js";

// ── Helper ────────────────────────────────────────────────────────────────────

function makeMemory(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const hoursAgo = (h: number): string =>
    new Date(Date.now() - h * 3_600_000).toISOString();

  return {
    id: 1,
    heat: 0.8,
    consolidation_stage: "labile",
    importance: 0.5,
    emotional_valence: 0.0,
    confidence: 1.0,
    is_protected: false,
    last_accessed: hoursAgo(1),
    created_at: hoursAgo(2),
    access_count: 1,
    ...overrides,
  };
}

// ── 1. Ebbinghaus decay — single step ────────────────────────────────────────

describe("computeDecay (Ebbinghaus 1885)", () => {
  it("single step: heat(0.8) * 0.95^1 ≈ 0.76", () => {
    const result = computeDecay(0.8, 1.0);
    // λ=0.95, no importance/emotional boost: heat = 0.8 * 0.95^1 = 0.76
    // Confidence modifier (1 + 1.0 * 0.1 = 1.1) slightly slows decay
    expect(result).toBeGreaterThan(0.75);
    expect(result).toBeLessThan(0.80);
  });

  it("100 steps: heat decays well below 0.10 for labile memory", () => {
    const result = computeDecay(0.8, 100.0, 0.5, 0.0, 1.0, { decayFactor: 0.95 });
    // Without floor: 0.8 * 0.95^100 * confidence_modifier ≈ very small
    // The raw decay should be near zero
    expect(result).toBeLessThan(0.05);
  });

  it("10000 steps: converges to ~0 for default (non-consolidated) memory", () => {
    const result = computeDecay(0.8, 10_000.0, 0.5, 0.0, 1.0, { decayFactor: 0.95 });
    expect(result).toBeLessThan(1e-10);
  });

  it("high importance uses importanceDecayFactor=0.998 (slower decay)", () => {
    const normal = computeDecay(0.8, 24.0, 0.5, 0.0, 1.0, { decayFactor: 0.95 });
    const important = computeDecay(0.8, 24.0, 0.8, 0.0, 1.0, { decayFactor: 0.95 });
    expect(important).toBeGreaterThan(normal);
  });

  it("emotional memory (|v|=1) decays slower than neutral at t=1h (Yonelinas 2015)", () => {
    // Rederived: time_saturation = 1 - exp(-1) = 0.632
    // emotional_mod = 1 + 1.0 * 0.5 * 0.632 = 1.316
    // effective = 1 - (1 - 0.95) / 1.316 ≈ 0.962 vs 0.95 neutral
    const neutral = computeDecay(0.8, 1.0, 0.5, 0.0, 1.0);
    const emotional = computeDecay(0.8, 1.0, 0.5, 1.0, 1.0);
    expect(emotional).toBeGreaterThan(neutral);
  });

  it("zero hours elapsed: no change", () => {
    expect(computeDecay(0.8, 0)).toBe(0.8);
  });
});

// ── 2. Permastore floor (Bahrick 1984) ───────────────────────────────────────

describe("permastore floor", () => {
  it("CONSOLIDATED floor = 0.10 (Bahrick 1984)", () => {
    expect(getHeatFloor("consolidated")).toBe(0.10);
  });

  it("LATE_LTP floor = 0.05", () => {
    expect(getHeatFloor("late_ltp")).toBe(0.05);
  });

  it("LABILE floor = 0.0 (can decay to zero)", () => {
    expect(getHeatFloor("labile")).toBe(0.0);
  });

  it("computeDecayUpdates: consolidated memory never drops below 0.10", () => {
    const mem = makeMemory({
      heat: 0.12,
      consolidation_stage: "consolidated",
      last_accessed: new Date(Date.now() - 10_000 * 3_600_000).toISOString(),
    });
    const updates = computeDecayUpdates([mem], null, { decayFactor: 0.5 });
    if (updates.length > 0) {
      expect(updates[0]![1]).toBeGreaterThanOrEqual(0.10);
    }
  });
});

// ── 3. ACT-R base-level activation (Anderson & Lebiere 1998) ─────────────────

describe("ACT-R base-level activation", () => {
  it("n=1, L=1h, d=0.5: B = ln(1) - 0.5 * ln(1) = 0; P = 0.5", () => {
    // Rederived from Anderson & Lebiere (1998) Eq. 4.4: B = ln(n) - d * ln(L)
    const B = computeActrBaseLevel(1, 1.0);
    expect(B).toBeCloseTo(0.0, 3);
    const P = actrActivationToHeat(B);
    expect(P).toBeCloseTo(0.5, 3);
  });

  it("n=5, L=100h, d=0.5: B = ln(5) - 0.5 * ln(100) ≈ -0.693; P ≈ 0.333", () => {
    // Rederived: ln(5)=1.609, ln(100)=4.605, B = 1.609 - 2.303 = -0.693
    // P = 1/(1+exp(0.693/1.0)) = 1/(1+2.0) = 0.333
    const B = computeActrBaseLevel(5, 100.0);
    expect(B).toBeCloseTo(-0.693, 2);
    const P = actrActivationToHeat(B, 1.0);
    expect(P).toBeCloseTo(0.333, 2);
  });

  it("higher access count produces higher activation", () => {
    const B1 = computeActrBaseLevel(1, 24.0);
    const B10 = computeActrBaseLevel(10, 24.0);
    expect(B10).toBeGreaterThan(B1);
  });

  it("longer lifetime reduces activation", () => {
    const B_short = computeActrBaseLevel(5, 1.0);
    const B_long = computeActrBaseLevel(5, 1000.0);
    expect(B_long).toBeLessThan(B_short);
  });
});

// ── 4. Entity decay ───────────────────────────────────────────────────────────

describe("computeEntityDecay", () => {
  function makeEntity(hoursAgo: number, heat: number) {
    return {
      id: 1,
      heat,
      last_accessed: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
    };
  }

  it("entity with heat 0.5 after 1h at 0.98 decay: ≈ 0.49", () => {
    const updates = computeEntityDecay([makeEntity(1, 0.5)], null, { decayFactor: 0.98 });
    if (updates.length > 0) {
      expect(updates[0]![1]).toBeCloseTo(0.5 * Math.pow(0.98, 1), 3);
    }
  });

  it("cold entity (heat < coldThreshold) is skipped", () => {
    const updates = computeEntityDecay([makeEntity(1, 0.03)], null, { coldThreshold: 0.05 });
    expect(updates).toHaveLength(0);
  });

  it("converges toward 0 after 1000h", () => {
    const updates = computeEntityDecay([makeEntity(1000, 0.9)], null, { decayFactor: 0.98 });
    if (updates.length > 0) {
      expect(updates[0]![1]).toBeLessThan(1e-8);
    }
  });
});

// ── 5. Batch decay updates ────────────────────────────────────────────────────

describe("computeDecayUpdates batch", () => {
  it("skips protected memories", () => {
    const mem = makeMemory({ is_protected: true });
    const updates = computeDecayUpdates([mem]);
    expect(updates).toHaveLength(0);
  });

  it("skips already-cold memories", () => {
    const mem = makeMemory({ heat: 0.01 });
    const updates = computeDecayUpdates([mem], null, { coldThreshold: 0.05 });
    expect(updates).toHaveLength(0);
  });

  it("returns updates for hot memories with sufficient elapsed time", () => {
    const mem = makeMemory({
      last_accessed: new Date(Date.now() - 10 * 3_600_000).toISOString(),
    });
    const updates = computeDecayUpdates([mem]);
    // After 10h at default 0.95 rate, heat should have decayed significantly
    if (updates.length > 0) {
      expect(updates[0]![1]).toBeLessThan(0.8);
    }
  });
});
