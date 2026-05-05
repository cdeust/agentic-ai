/**
 * Unit tests for ablation.ts
 * source: cortex@ed33435 mcp_server/core/ablation.py
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isMechanismDisabled,
  Mechanism,
  AblationConfig,
  computeAblationDeltas,
  computeImpactScore,
  generateInterpretation,
  createAblationResult,
  neutralEncodingStrength,
  neutralRetrievalStrength,
  neutralLtpModulation,
  neutralSchemaMatch,
  neutralInterferenceScore,
  neutralSeparationIndex,
  neutralHippocampalDependency,
  neutralScalingFactor,
} from "../../src/consolidation/ablation.js";

describe("isMechanismDisabled", () => {
  beforeEach(() => {
    delete process.env["CORTEX_ABLATE_CONSOLIDATION_CASCADE"];
    delete process.env["CORTEX_ABLATE_OSCILLATORY_CLOCK"];
  });

  afterEach(() => {
    delete process.env["CORTEX_ABLATE_CONSOLIDATION_CASCADE"];
    delete process.env["CORTEX_ABLATE_OSCILLATORY_CLOCK"];
  });

  it("returns false when env var not set", () => {
    expect(isMechanismDisabled(Mechanism.CASCADE)).toBe(false);
  });

  it("returns true when env var is 1", () => {
    process.env["CORTEX_ABLATE_CONSOLIDATION_CASCADE"] = "1";
    expect(isMechanismDisabled(Mechanism.CASCADE)).toBe(true);
  });

  it("returns false when env var is 0", () => {
    process.env["CORTEX_ABLATE_CONSOLIDATION_CASCADE"] = "0";
    expect(isMechanismDisabled(Mechanism.CASCADE)).toBe(false);
  });
});

describe("AblationConfig", () => {
  it("isEnabled returns true for non-disabled mechanisms", () => {
    const cfg = new AblationConfig();
    expect(cfg.isEnabled(Mechanism.CASCADE)).toBe(true);
  });

  it("disable returns new config with mechanism disabled", () => {
    const cfg = new AblationConfig();
    const cfg2 = cfg.disable(Mechanism.CASCADE);
    expect(cfg2.isEnabled(Mechanism.CASCADE)).toBe(false);
    // original unchanged
    expect(cfg.isEnabled(Mechanism.CASCADE)).toBe(true);
  });

  it("enable re-enables a disabled mechanism", () => {
    const cfg = new AblationConfig([Mechanism.CASCADE]);
    const cfg2 = cfg.enable(Mechanism.CASCADE);
    expect(cfg2.isEnabled(Mechanism.CASCADE)).toBe(true);
  });

  it("disableAllExcept disables everything else", () => {
    const cfg = new AblationConfig().disableAllExcept(
      Mechanism.CASCADE as Parameters<AblationConfig["disableAllExcept"]>[0],
    );
    expect(cfg.isEnabled(Mechanism.CASCADE)).toBe(true);
    expect(cfg.isEnabled(Mechanism.HOPFIELD)).toBe(false);
  });
});

describe("computeAblationDeltas", () => {
  it("returns signed differences", () => {
    const baseline = { recall_at_10: 0.8, precision: 0.7 };
    const ablation = { recall_at_10: 0.6, precision: 0.75 };
    const deltas = computeAblationDeltas(baseline, ablation);
    expect(deltas["recall_at_10"]).toBeCloseTo(-0.2, 5);
    expect(deltas["precision"]).toBeCloseTo(0.05, 5);
  });

  it("handles keys only in one dict", () => {
    const deltas = computeAblationDeltas({ a: 1 }, { b: 2 });
    expect(deltas["a"]).toBe(-1); // ablation=0 - baseline=1 = -1
    expect(deltas["b"]).toBe(2); // ablation=2 - baseline=0 = 2
  });
});

describe("computeImpactScore", () => {
  it("returns 0 for empty deltas", () => {
    expect(computeImpactScore({})).toBe(0);
  });

  it("returns value in (0,1) for non-zero deltas", () => {
    const score = computeImpactScore({ x: 0.5 });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

describe("createAblationResult", () => {
  it("populates all fields", () => {
    const result = createAblationResult(
      "cascade",
      { recall: 0.8 },
      { recall: 0.6 },
    );
    expect(result.mechanism).toBe("cascade");
    expect(result.deltas["recall"]).toBeCloseTo(-0.2, 5);
    expect(result.impact_score).toBeGreaterThan(0);
    expect(result.interpretation).toBeTruthy();
  });
});

describe("neutral values", () => {
  it("all return expected defaults", () => {
    expect(neutralEncodingStrength()).toBe(1.0);
    expect(neutralRetrievalStrength()).toBe(1.0);
    expect(neutralLtpModulation()).toBe(1.0);
    expect(neutralSchemaMatch()).toBe(0.0);
    expect(neutralInterferenceScore()).toBe(0.0);
    expect(neutralSeparationIndex()).toBe(0.0);
    expect(neutralHippocampalDependency()).toBe(0.5);
    expect(neutralScalingFactor()).toBe(1.0);
  });
});
