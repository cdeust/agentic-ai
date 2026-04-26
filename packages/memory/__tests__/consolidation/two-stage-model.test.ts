/**
 * Two-stage model — pure function tests.
 *
 * Rederived from cited paper:
 *
 * McClelland et al. (1995) + Ketz et al. (2023) C-HORSE:
 *   transfer_rate = 0.02 (cortical LR from C-HORSE)
 *   base_rate = 0.02 / sqrt(effective_replays)
 *   For replay_count=3 (min_replays=2): effective=2; base = 0.02/sqrt(2) ≈ 0.01414
 *   schema_factor = 1 + 0 * (2.5 - 1) = 1.0 (no schema match)
 *   importance_factor = 0.8 + 0.5 * 0.4 = 1.0
 *   delta = 0.01414 * 1.0 * 1.0 = 0.01414
 *   new_dependency = 1.0 - 0.01414 = 0.9859
 *
 * Schema acceleration (Tse et al. 2007):
 *   15x biological compressed to 2.5x for AI memory system.
 *   schema_factor = 1 + 1.0 * (2.5 - 1) = 2.5
 *   delta_schema = 0.01414 * 2.5 = 0.03535 (vs 0.01414 without schema)
 *
 * Hippocampal pressure (McClelland 1995 engineering adaptation):
 *   ratio = 100/100 = 1.0; pressure = 1/(1+exp(-8*(1.0-0.7))) = 1/(1+exp(-2.4)) ≈ 0.917
 */

import { describe, it, expect } from "vitest";
import {
  computeTransferDelta,
  updateHippocampalDependency,
  computeHippocampalPressure,
  computeConsolidationPriority,
  classifyMemoryStore,
  shouldReleaseHippocampalTrace,
  computeTransferMetrics,
  computeInterleavingSchedule,
} from "../../src/consolidation/two-stage-model.js";

describe("computeTransferDelta (Ketz et al. 2023 C-HORSE)", () => {
  it("below min_replays: no transfer", () => {
    expect(computeTransferDelta(0.8, 1)).toBe(0.0);
    expect(computeTransferDelta(0.8, 0)).toBe(0.0);
  });

  it("replay_count=3 (min=2): base = 0.02/sqrt(2) ≈ 0.01414", () => {
    // Rederived: effective_replays = 3 - 2 + 1 = 2; base = 0.02/sqrt(2) = 0.01414
    // schema=0, importance=0.5: factors = 1.0 * 1.0; delta = 0.01414
    const delta = computeTransferDelta(1.0, 3, 0.0, 0.5);
    expect(delta).toBeCloseTo(0.01414, 3);
  });

  it("schema match accelerates transfer (Tse et al. 2007 2.5x compression)", () => {
    const noSchema = computeTransferDelta(1.0, 3, 0.0, 0.5);
    const fullSchema = computeTransferDelta(1.0, 3, 1.0, 0.5);
    // schema_factor = 1 + 1.0 * (2.5 - 1) = 2.5; delta_schema = 2.5x larger
    expect(fullSchema / noSchema).toBeCloseTo(2.5, 1);
  });

  it("already cortically independent: no further transfer", () => {
    // dependency=0.04 <= HIPPOCAMPAL_RELEASE_THRESHOLD=0.05
    expect(computeTransferDelta(0.04, 10)).toBe(0.0);
  });

  it("delta never exceeds current_dependency", () => {
    const delta = computeTransferDelta(0.01, 20, 1.0, 1.0);
    expect(delta).toBeLessThanOrEqual(0.01);
  });

  it("diminishing returns: each replay reduces delta", () => {
    const d3 = computeTransferDelta(1.0, 3, 0.0, 0.5);
    const d10 = computeTransferDelta(1.0, 10, 0.0, 0.5);
    expect(d3).toBeGreaterThan(d10);
  });
});

describe("updateHippocampalDependency", () => {
  it("converges toward lower values over many replays (diminishing returns)", () => {
    // C-HORSE cortical LR = 0.02 with sqrt diminishing returns.
    // After 200 replays: base = 0.02/sqrt(n-1) where n goes 2→200.
    // Sum = 0.02 * sum(1/sqrt(k)) for k=1..199 ≈ 0.02 * 2*sqrt(199) ≈ 0.02 * 28.2 ≈ 0.564
    // So dependency should drop from 1.0 by ~0.564 → remaining ≈ 0.46
    // This is the correct C-HORSE behavior: slow cortical integration.
    let dep = 1.0;
    for (let r = 2; r <= 200; r++) {
      dep = updateHippocampalDependency(dep, r, 0.0, 0.5);
    }
    // Should be less than initial (convergence is happening)
    expect(dep).toBeLessThan(0.8);
    // But not fully cortical yet (diminishing returns slow convergence)
    expect(dep).toBeGreaterThan(0.0);
  });

  it("schema-consistent memories converge faster", () => {
    let depNoSchema = 1.0;
    let depSchema = 1.0;
    for (let r = 2; r <= 30; r++) {
      depNoSchema = updateHippocampalDependency(depNoSchema, r, 0.0, 0.5);
      depSchema = updateHippocampalDependency(depSchema, r, 1.0, 0.5);
    }
    expect(depSchema).toBeLessThan(depNoSchema);
  });
});

describe("computeHippocampalPressure", () => {
  it("empty store: near-zero pressure", () => {
    const p = computeHippocampalPressure(0, 100);
    expect(p).toBeLessThan(0.1);
  });

  it("full store (ratio=1.0): near-maximum pressure ≈ 0.917", () => {
    // Rederived: ratio=1.0; 1/(1+exp(-8*(1.0-0.7))) = 1/(1+exp(-2.4)) ≈ 0.917
    const p = computeHippocampalPressure(100, 100);
    expect(p).toBeGreaterThan(0.9);
    expect(p).toBeLessThan(1.0);
  });

  it("70% full: pressure ≈ 0.5 (inflection point)", () => {
    const p = computeHippocampalPressure(70, 100);
    expect(p).toBeCloseTo(0.5, 1);
  });

  it("capacity=0: returns 1.0 (full pressure)", () => {
    expect(computeHippocampalPressure(0, 0)).toBe(1.0);
  });
});

describe("classifyMemoryStore", () => {
  it("dependency > 0.7: hippocampal", () => {
    expect(classifyMemoryStore(0.8, "labile")).toBe("hippocampal");
  });

  it("dependency in (0.15, 0.7]: transitional", () => {
    expect(classifyMemoryStore(0.4, "early_ltp")).toBe("transitional");
  });

  it("dependency <= 0.15: cortical", () => {
    expect(classifyMemoryStore(0.1, "consolidated")).toBe("cortical");
  });
});

describe("shouldReleaseHippocampalTrace", () => {
  it("dependency < 0.05 AND consolidated AND cold: should release", () => {
    expect(shouldReleaseHippocampalTrace(0.03, "consolidated", 0.2)).toBe(true);
  });

  it("hot memory: should not release", () => {
    expect(shouldReleaseHippocampalTrace(0.03, "consolidated", 0.5)).toBe(false);
  });

  it("not consolidated: should not release", () => {
    expect(shouldReleaseHippocampalTrace(0.03, "labile", 0.1)).toBe(false);
  });
});

describe("computeConsolidationPriority", () => {
  it("transitional memories (dep≈0.5) have highest priority", () => {
    const pTransitional = computeConsolidationPriority(0.5, 0.5, 0.5, 0.5, 48);
    const pHippocampal = computeConsolidationPriority(0.9, 0.5, 0.5, 0.5, 48);
    const pCortical = computeConsolidationPriority(0.05, 0.5, 0.5, 0.5, 48);
    expect(pTransitional).toBeGreaterThan(pHippocampal);
    expect(pTransitional).toBeGreaterThan(pCortical);
  });

  it("result in [0, 1]", () => {
    const p = computeConsolidationPriority(0.5, 1.0, 1.0, 1.0, 1000);
    expect(p).toBeGreaterThanOrEqual(0.0);
    expect(p).toBeLessThanOrEqual(1.0);
  });
});

describe("computeTransferMetrics", () => {
  it("empty: returns zeros", () => {
    const m = computeTransferMetrics([]);
    expect(m.total).toBe(0);
    expect(m.avgDependency).toBe(0.0);
  });

  it("mixed store: correctly classifies", () => {
    const mems = [
      { hippocampal_dependency: 0.9, consolidation_stage: "labile" },
      { hippocampal_dependency: 0.4, consolidation_stage: "early_ltp" },
      { hippocampal_dependency: 0.05, consolidation_stage: "consolidated" },
    ];
    const m = computeTransferMetrics(mems);
    expect(m.hippocampal).toBe(1);
    expect(m.transitional).toBe(1);
    expect(m.cortical).toBe(1);
    expect(m.total).toBe(3);
  });
});

describe("computeInterleavingSchedule", () => {
  it("single candidate: returns [0]", () => {
    expect(computeInterleavingSchedule([{ domain: "a" }])).toEqual([0]);
  });

  it("two domains: alternates between them", () => {
    const candidates = [
      { domain: "a" }, { domain: "a" }, { domain: "b" }, { domain: "b" },
    ];
    const schedule = computeInterleavingSchedule(candidates);
    // Should interleave: first a, then b, then a, then b
    expect(schedule).toHaveLength(4);
    // First two should be from different domains
    const d0 = candidates[schedule[0]!]?.domain;
    const d1 = candidates[schedule[1]!]?.domain;
    expect(d0).not.toBe(d1);
  });
});
