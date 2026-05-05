/**
 * Tests for ablation.ts — Mechanism enum, isMechanismDisabled, AblationConfig,
 * computeAblationDeltas, computeImpactScore, neutral* helpers.
 *
 * Invariant: isMechanismDisabled reads process.env; env is never contaminated.
 * Happy path: each exported function produces the correct value.
 * Error path: edge cases (empty deltas, degenerate inputs).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  Mechanism,
  isMechanismDisabled,
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
} from "../../src/recall/ablation.js";

// ── isMechanismDisabled ─────────────────────────────────────────────────

describe("isMechanismDisabled", () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env["CORTEX_ABLATE_HOPFIELD"];
    delete process.env["CORTEX_ABLATE_HOPFIELD"];
  });

  afterEach(() => {
    if (saved !== undefined) {
      process.env["CORTEX_ABLATE_HOPFIELD"] = saved;
    } else {
      delete process.env["CORTEX_ABLATE_HOPFIELD"];
    }
  });

  it("returns false when env var is not set", () => {
    expect(isMechanismDisabled(Mechanism.HOPFIELD)).toBe(false);
  });

  it("returns true when env var is '1'", () => {
    process.env["CORTEX_ABLATE_HOPFIELD"] = "1";
    expect(isMechanismDisabled(Mechanism.HOPFIELD)).toBe(true);
  });

  it("returns false when env var is '0'", () => {
    process.env["CORTEX_ABLATE_HOPFIELD"] = "0";
    expect(isMechanismDisabled(Mechanism.HOPFIELD)).toBe(false);
  });

  it("accepts string mechanism name", () => {
    process.env["CORTEX_ABLATE_HOPFIELD"] = "1";
    expect(isMechanismDisabled("HOPFIELD")).toBe(true);
  });
});

// ── AblationConfig ───────────────────────────────────────────────────────

describe("AblationConfig", () => {
  it("starts with empty disabled set", () => {
    const cfg = new AblationConfig();
    expect(cfg.disabled.size).toBe(0);
  });

  it("disable returns new config without mutating", () => {
    const cfg = new AblationConfig();
    const cfg2 = cfg.disable("foo");
    expect(cfg.disabled.has("foo")).toBe(false);
    expect(cfg2.disabled.has("foo")).toBe(true);
  });

  it("enable removes from disabled set", () => {
    const cfg = new AblationConfig(new Set(["foo"]));
    const cfg2 = cfg.enable("foo");
    expect(cfg2.disabled.has("foo")).toBe(false);
  });

  it("disableAllExcept keeps only specified", () => {
    const cfg = new AblationConfig().disableAllExcept(Mechanism.HOPFIELD);
    expect(cfg.disabled.has(String(Mechanism.HOPFIELD))).toBe(false);
    expect(cfg.disabled.size).toBeGreaterThan(0);
  });
});

// ── computeAblationDeltas ─────────────────────────────────────────────────

describe("computeAblationDeltas", () => {
  it("computes signed differences", () => {
    const deltas = computeAblationDeltas({ mrr: 0.8, r10: 0.9 }, { mrr: 0.7, r10: 0.95 });
    expect(deltas["mrr"]).toBeCloseTo(-0.1, 5);
    expect(deltas["r10"]).toBeCloseTo(0.05, 5);
  });

  it("handles keys present in only one set", () => {
    const deltas = computeAblationDeltas({ a: 1.0 }, { b: 0.5 });
    expect(deltas["a"]).toBeCloseTo(-1.0, 5);
    expect(deltas["b"]).toBeCloseTo(0.5, 5);
  });

  it("returns empty object for empty inputs", () => {
    const deltas = computeAblationDeltas({}, {});
    expect(Object.keys(deltas).length).toBe(0);
  });
});

// ── computeImpactScore ────────────────────────────────────────────────────

describe("computeImpactScore", () => {
  it("returns 0 for empty deltas", () => {
    expect(computeImpactScore({})).toBe(0.0);
  });

  it("returns value in (0, 1) for non-zero deltas", () => {
    const score = computeImpactScore({ mrr: 0.1 });
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("larger deltas produce higher impact", () => {
    const small = computeImpactScore({ x: 0.01 });
    const large = computeImpactScore({ x: 0.5 });
    expect(large).toBeGreaterThan(small);
  });
});

// ── createAblationResult ──────────────────────────────────────────────────

describe("createAblationResult", () => {
  it("computes consistent fields", () => {
    const result = createAblationResult(
      "HOPFIELD",
      { mrr: 0.8, r10: 0.9 },
      { mrr: 0.75, r10: 0.92 },
    );
    expect(result.mechanism).toBe("HOPFIELD");
    expect(result.deltas["mrr"]).toBeCloseTo(-0.05, 5);
    expect(result.impactScore).toBeGreaterThanOrEqual(0);
    expect(result.interpretation.length).toBeGreaterThan(0);
  });
});

// ── Neutral values ────────────────────────────────────────────────────────

describe("neutral values", () => {
  it("neutralEncodingStrength returns 1.0", () => expect(neutralEncodingStrength()).toBe(1.0));
  it("neutralRetrievalStrength returns 1.0", () => expect(neutralRetrievalStrength()).toBe(1.0));
  it("neutralLtpModulation returns 1.0", () => expect(neutralLtpModulation()).toBe(1.0));
  it("neutralSchemaMatch returns 0.0", () => expect(neutralSchemaMatch()).toBe(0.0));
  it("neutralInterferenceScore returns 0.0", () => expect(neutralInterferenceScore()).toBe(0.0));
  it("neutralSeparationIndex returns 0.0", () => expect(neutralSeparationIndex()).toBe(0.0));
  it("neutralHippocampalDependency returns 0.5", () => expect(neutralHippocampalDependency()).toBe(0.5));
  it("neutralScalingFactor returns 1.0", () => expect(neutralScalingFactor()).toBe(1.0));
});
