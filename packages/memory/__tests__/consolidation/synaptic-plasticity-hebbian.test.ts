import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { computeBcmPhi, computeLtp, computeLtd, updateBcmThreshold, applyHebbianUpdate, computeStdpUpdate, applyStdpBatch, MAX_WEIGHT, MIN_WEIGHT } from "../../src/consolidation/synaptic-plasticity-hebbian.js";

describe("computeBcmPhi — BCM 1982 Eq. 3", () => {
  it("positive when post > theta (LTP)", () => { expect(computeBcmPhi(0.8, 0.5)).toBeGreaterThan(0); });
  it("negative when 0 < post < theta (LTD)", () => { expect(computeBcmPhi(0.3, 0.5)).toBeLessThan(0); });
  it("zero at threshold", () => { expect(computeBcmPhi(0.5, 0.5)).toBeCloseTo(0, 10); });
});

describe("computeLtp", () => {
  it("increases weight in LTP zone", () => { expect(computeLtp(1.0, 1.0, 1.0, 0.8, 0.5)).toBeGreaterThan(1.0); });
  it("no change when phi <= 0", () => { expect(computeLtp(1.0, 1.0, 1.0, 0.3, 0.5)).toBe(1.0); });
  it("bounded by MAX_WEIGHT", () => { expect(computeLtp(MAX_WEIGHT - 0.001, 1.0, 1.0, 2.0, 0.1, 1.0, MAX_WEIGHT)).toBeLessThanOrEqual(MAX_WEIGHT); });
});

describe("computeLtd", () => {
  it("activity-based LTD", () => { expect(computeLtd(1.0, 0, 0.02, MIN_WEIGHT, 0.3, 0.5)).toBeLessThan(1.0); });
  it("inactivity decay", () => { expect(computeLtd(1.0, 24.0, 0.02, MIN_WEIGHT, 0, 0.5)).toBeLessThan(1.0); });
  it("never below MIN_WEIGHT", () => { expect(computeLtd(MIN_WEIGHT + 0.001, 1000, 1.0, MIN_WEIGHT)).toBeGreaterThanOrEqual(MIN_WEIGHT); });
  it("no change when time=0 and no activity", () => { expect(computeLtd(0.8, 0, 0.02, MIN_WEIGHT, 0, 0.5)).toBe(0.8); });
});

describe("updateBcmThreshold", () => {
  it("EMA formula", () => { expect(updateBcmThreshold(0.5, 0.8, 0.9)).toBeCloseTo(0.9 * 0.5 + 0.1 * 0.64, 10); });
  it("increases toward activity^2 when above", () => { expect(updateBcmThreshold(0.1, 0.9, 0.95)).toBeGreaterThan(0.1); });
  it("decreases when below", () => { expect(updateBcmThreshold(0.9, 0.1, 0.95)).toBeLessThan(0.9); });
});

describe("applyHebbianUpdate", () => {
  it("co-accessed edges LTP", () => { const r = applyHebbianUpdate([{source_entity_id:1,target_entity_id:2,weight:0.5}], new Set(["1,2"]), new Map([[1,0.8],[2,0.8]]), new Map([[1,0.5],[2,0.5]])); expect(r[0]!.weight).toBeGreaterThanOrEqual(0.5); });
  it("non-co-accessed LTD", () => { const r = applyHebbianUpdate([{source_entity_id:1,target_entity_id:2,weight:1.0}], new Set(), new Map(), new Map(), 24); expect(r[0]!.weight).toBeLessThan(1.0); expect(r[0]!.action).toBe("ltd"); });
  it("result has weight/delta/action", () => { const r = applyHebbianUpdate([{source_entity_id:1,target_entity_id:2,weight:0.8}], new Set(), new Map(), new Map()); expect(r[0]).toHaveProperty("weight"); expect(r[0]).toHaveProperty("delta"); expect(r[0]).toHaveProperty("action"); });
});

describe("computeStdpUpdate — Bi & Poo 1998", () => {
  it("causal (dt > 0) -> LTP", () => { expect(computeStdpUpdate(1.0, 5.0)).toBeGreaterThan(1.0); });
  it("anti-causal (dt < 0) -> LTD", () => { expect(computeStdpUpdate(1.0, -5.0)).toBeLessThan(1.0); });
  it("dt near 0 -> no change", () => { expect(computeStdpUpdate(1.0, 0.0)).toBe(1.0); });
  it("LTP > LTD magnitude (A+ > A-)", () => { expect(computeStdpUpdate(1.0, 10.0) - 1.0).toBeGreaterThan(1.0 - computeStdpUpdate(1.0, -10.0)); });
  it("bounded by [MIN_WEIGHT, MAX_WEIGHT]", () => { expect(computeStdpUpdate(MIN_WEIGHT + 0.001, -1000)).toBeGreaterThanOrEqual(MIN_WEIGHT); expect(computeStdpUpdate(MAX_WEIGHT - 0.001, 1000)).toBeLessThanOrEqual(MAX_WEIGHT); });
});

describe("applyStdpBatch", () => {
  it("causal direction", () => { expect(applyStdpBatch([{source_entity_id:1,target_entity_id:2,delta_t_hours:5,current_weight:1.0}])[0]!.direction).toBe("causal"); });
  it("anti-causal direction", () => { expect(applyStdpBatch([{source_entity_id:1,target_entity_id:2,delta_t_hours:-5,current_weight:1.0}])[0]!.direction).toBe("anti-causal"); });
});

// ── D-14 regression: ablation guard ──────────────────────────────────────────
// This test would have caught D-14: applyHebbianUpdate was returning raw edges
// (missing weight/delta/action keys) when ablation was active, causing
// downstream KeyError in the consolidation handler.
// source: cortex@ed33435 mcp_server/core/synaptic_plasticity_hebbian.py:170-185

describe("applyHebbianUpdate — ablation guard (D-14)", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env["CORTEX_ABLATE_SYNAPTIC_PLASTICITY"];
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env["CORTEX_ABLATE_SYNAPTIC_PLASTICITY"];
    } else {
      process.env["CORTEX_ABLATE_SYNAPTIC_PLASTICITY"] = originalEnv;
    }
  });

  it("ablated: every result has weight, delta=0, action='none' (no-op shape)", () => {
    process.env["CORTEX_ABLATE_SYNAPTIC_PLASTICITY"] = "1";
    const edges = [
      { source_entity_id: 1, target_entity_id: 2, weight: 0.8 },
      { source_entity_id: 3, target_entity_id: 4, weight: 1.2 },
    ];
    const result = applyHebbianUpdate(
      edges,
      new Set(["1,2"]),
      new Map([[1, 0.9], [2, 0.9]]),
      new Map([[2, 0.5]]),
    );
    expect(result).toHaveLength(2);
    for (const r of result) {
      // postcondition: weight preserved, delta=0, action="none"
      expect(r).toHaveProperty("weight");
      expect(r.delta).toBe(0.0);
      expect(r.action).toBe("none");
    }
    // weight must be the original edge weight (unchanged)
    expect(result[0]!.weight).toBe(0.8);
    expect(result[1]!.weight).toBe(1.2);
  });

  it("not ablated: co-accessed edges produce LTP (non-zero delta)", () => {
    delete process.env["CORTEX_ABLATE_SYNAPTIC_PLASTICITY"];
    const edges = [{ source_entity_id: 1, target_entity_id: 2, weight: 0.5 }];
    const result = applyHebbianUpdate(
      edges,
      new Set(["1,2"]),
      new Map([[1, 0.9], [2, 0.9]]),
      new Map([[2, 0.5]]),
    );
    expect(result[0]!.action).toBe("ltp");
    expect(result[0]!.delta).toBeGreaterThan(0);
  });
});
