/**
 * Unit tests for emergence-tracker.ts and emergence-metrics.ts
 *
 * Invariant assertions:
 *   - computeSpacingBenefit: [0, 1]; returns 0.5 for < 3 accesses
 *   - computeTestingBenefit: retrieval_fraction in [0, 1]
 *   - computeSchemaAccelerationMetric: ratio_defined=false when no consistent memories
 *   - computeForgettingCurve: r_squared in [0, 1]
 *   - attribution sums: generateEmergenceReport returns a complete report
 *
 * source: cortex@ed33435 mcp_server/core/emergence_tracker.py
 * source: cortex@ed33435 mcp_server/core/emergence_metrics.py
 */

import { describe, it, expect } from "vitest";
import {
  computeSpacingBenefit,
  computeTestingBenefit,
  computeSchemaAccelerationMetric,
  computePhaseLockingBenefit,
} from "../../src/methodology/emergence-tracker.js";
import {
  computeForgettingCurve,
  generateEmergenceReport,
} from "../../src/methodology/emergence-metrics.js";

describe("computeSpacingBenefit", () => {
  it("returns 0.5 for fewer than 3 accesses", () => {
    expect(computeSpacingBenefit([], 0.5)).toBe(0.5);
    expect(computeSpacingBenefit([1], 0.5)).toBe(0.5);
    expect(computeSpacingBenefit([1, 2], 0.5)).toBe(0.5);
  });

  it("returns 1.0 for perfectly equally spaced accesses", () => {
    // Equal intervals of 10h: CV = 0, regularity = 1
    const result = computeSpacingBenefit([0, 10, 20, 30], 0.7);
    expect(result).toBeCloseTo(1.0, 3);
  });

  it("returns 0 for massed accesses (all at same time)", () => {
    // All accesses at hour 5: intervals = [0, 0, ...], meanInterval < 0.01
    const result = computeSpacingBenefit([5, 5, 5, 5], 0.5);
    expect(result).toBe(0);
  });

  it("result is in [0, 1]", () => {
    const result = computeSpacingBenefit([0, 1, 10, 100], 0.5);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });
});

describe("computeTestingBenefit", () => {
  it("returns zero benefit for zero total interactions", () => {
    const result = computeTestingBenefit(0, 0, 0.8);
    expect(result.retrieval_fraction).toBe(0);
    expect(result.testing_benefit).toBe(0);
    expect(result.heat).toBe(0.8);
  });

  it("retrieval_fraction in [0, 1]", () => {
    const result = computeTestingBenefit(3, 7, 0.6);
    expect(result.retrieval_fraction).toBeCloseTo(0.3, 4);
  });

  it("testing_benefit = retrieval_fraction * heat", () => {
    const result = computeTestingBenefit(5, 5, 0.8);
    expect(result.testing_benefit).toBeCloseTo(0.5 * 0.8, 4);
  });
});

describe("computeSchemaAccelerationMetric", () => {
  it("ratio_defined=false when no consistent memories", () => {
    const result = computeSchemaAccelerationMetric([], [{ consolidation_stage: "labile" }]);
    expect(result.ratio_defined).toBe(false);
    expect(result.reason_for_undefined).toBe("no_schemas_promoted_yet");
    expect(result.acceleration_ratio).toBe(1.0);
  });

  it("ratio_defined=false when no inconsistent memories", () => {
    const result = computeSchemaAccelerationMetric(
      [{ consolidation_stage: "consolidated", hours_in_stage: 5 }],
      [],
    );
    expect(result.ratio_defined).toBe(false);
    expect(result.reason_for_undefined).toBe("no_baseline_population");
  });

  it("reports acceleration ratio > 1 when consistent memories consolidate faster", () => {
    const consistent = [{ consolidation_stage: "consolidated", hours_in_stage: 2 }];
    // Inconsistent takes longer: hours_in_stage 20 => avg = 20+24 = 44
    const inconsistent = [{ consolidation_stage: "consolidated", hours_in_stage: 20 }];
    const result = computeSchemaAccelerationMetric(consistent, inconsistent);
    expect(result.ratio_defined).toBe(true);
    expect(result.acceleration_ratio).toBeGreaterThan(1);
  });
});

describe("computePhaseLockingBenefit", () => {
  it("returns zeros for empty lists", () => {
    const result = computePhaseLockingBenefit([], []);
    expect(result.encoding_phase_count).toBe(0);
    expect(result.retrieval_phase_count).toBe(0);
    expect(result.phase_benefit).toBe(0);
  });

  it("phase_benefit = encoding_avg_heat - retrieval_avg_heat", () => {
    const enc = [{ heat: 0.8 }, { heat: 0.6 }];
    const ret = [{ heat: 0.3 }];
    const result = computePhaseLockingBenefit(enc, ret);
    expect(result.encoding_phase_avg_heat).toBeCloseTo(0.7, 4);
    expect(result.retrieval_phase_avg_heat).toBeCloseTo(0.3, 4);
    expect(result.phase_benefit).toBeCloseTo(0.4, 4);
  });
});

describe("computeForgettingCurve", () => {
  it("returns insufficient_data for < 5 data points", () => {
    const result = computeForgettingCurve([[1, 0.9], [2, 0.8]]);
    expect(result.curve_type).toBe("insufficient_data");
    expect(result.r_squared).toBe(0);
  });

  it("r_squared in [0, 1] for valid decay data", () => {
    // Exponential decay: heat = exp(-0.05 * age)
    const data: Array<[number, number]> = Array.from({ length: 20 }, (_, i) => [
      i * 5,
      Math.exp(-0.05 * i * 5),
    ]);
    const result = computeForgettingCurve(data);
    expect(result.r_squared).toBeGreaterThanOrEqual(0);
    expect(result.r_squared).toBeLessThanOrEqual(1);
  });
});

describe("generateEmergenceReport", () => {
  it("returns a complete report with all required fields", () => {
    const memories = Array.from({ length: 10 }, (_, i) => ({
      heat: 0.8 - i * 0.05,
      hours_in_stage: i * 3,
      schema_match_score: i % 2 === 0 ? 0.8 : 0.1,
      theta_phase_at_encoding: i % 2 === 0 ? 0.2 : 0.7,
      consolidation_stage: i < 5 ? "consolidated" : "labile",
      interference_score: 0.1 * i,
    }));

    const report = generateEmergenceReport(memories);
    expect(report.memory_count).toBe(10);
    expect(report.forgetting_curve).toBeDefined();
    expect(report.schema_acceleration).toBeDefined();
    expect(report.phase_locking).toBeDefined();
    expect(report.stage_distribution).toBeDefined();
    expect(typeof report.avg_interference).toBe("number");
    expect(report.timestamp).toBeDefined();
  });
});
