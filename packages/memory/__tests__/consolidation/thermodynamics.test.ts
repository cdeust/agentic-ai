/**
 * Thermodynamics — pure function tests at multiple timescales.
 *
 * Rederived from cited papers (3 algorithms):
 *
 * 1. Ebbinghaus (1885) — see decay-cycle.test.ts for decay.
 *    compute_surprise: novelty = 1 - max_similarity.
 *
 * 2. Edmundson (1969) — four-feature importance scoring.
 *    importance = (w_cue * cue + w_key * key + w_title * title + w_loc * loc) / (w_cue+w_key+w_title+w_loc)
 *    Validated weights: w_cue=2, w_key=1, w_title=1, w_loc=1 (sum=5).
 *    Content "error: failed to connect" should score high on cue feature.
 *
 * 3. Yonelinas & Ritchey (2015) + Kleinsmith & Kaplan (1963):
 *    Emotional crossover effect: emotional advantage grows with delay.
 *    At t=0: no advantage. At t=1h: partial advantage (0.632 saturation).
 *    At t>>1: near-full advantage.
 */

import { describe, it, expect } from "vitest";
import {
  computeSurprise,
  applySurpriseBoost,
  computeImportance,
  computeDecay,
  computeSessionCoherence,
  computeMetamemoryConfidence,
  isErrorContent,
  isDecisionContent,
} from "../../src/consolidation/thermodynamics.js";

describe("computeSurprise", () => {
  it("no existing memories: returns 0.5 (baseline)", () => {
    expect(computeSurprise("anything", [])).toBe(0.5);
  });

  it("high similarity → low surprise", () => {
    const result = computeSurprise("content", [0.95, 0.90]);
    expect(result).toBeCloseTo(0.05, 5);
  });

  it("low similarity → high surprise", () => {
    const result = computeSurprise("content", [0.1]);
    expect(result).toBeCloseTo(0.9, 5);
  });

  it("identical memory → 0 surprise", () => {
    expect(computeSurprise("content", [1.0])).toBe(0.0);
  });
});

describe("applySurpriseBoost", () => {
  it("applies boost capped at 1.0", () => {
    expect(applySurpriseBoost(0.9, 0.5, 0.3)).toBe(1.0); // 0.9 + 0.15 > 1.0
  });

  it("partial boost", () => {
    expect(applySurpriseBoost(0.5, 0.5, 0.3)).toBeCloseTo(0.65, 5);
  });
});

describe("computeImportance (Edmundson 1969)", () => {
  it("error/decision keywords score higher than filler text", () => {
    const error = computeImportance("error: failed to connect to database — regression detected");
    const filler = computeImportance("maybe this is just a minor note about btw");
    // Rederived: error content hits bonus words (error, failed, regression),
    // filler hits stigma words (maybe, minor, just, note, btw).
    expect(error).toBeGreaterThan(filler);
  });

  it("code block presence boosts cue score", () => {
    const withCode = computeImportance("fixed `error` in the auth service");
    const withoutCode = computeImportance("fixed error in the auth service");
    expect(withCode).toBeGreaterThanOrEqual(withoutCode);
  });

  it("normalized to [0, 1]", () => {
    const score = computeImportance("critical security vulnerability architecture refactor migration");
    expect(score).toBeGreaterThanOrEqual(0.0);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it("empty content → 0", () => {
    expect(computeImportance("")).toBe(0.0);
  });

  it("tags boost title feature when they are bonus words", () => {
    const withTags = computeImportance("generic note", ["critical", "security"]);
    const withoutTags = computeImportance("generic note");
    expect(withTags).toBeGreaterThanOrEqual(withoutTags);
  });
});

describe("computeDecay (Ebbinghaus 1885 + modulation)", () => {
  it("known input: 0.8 * 0.95^1 ≈ 0.76 (with confidence modifier)", () => {
    // Rederived: base = 0.95 (importance=0.5), no emotional mod
    // Confidence mod: 1 + 1.0 * 0.1 = 1.1
    // effective = 1 - (1 - 0.95) / 1.1 = 1 - 0.04545 = 0.95455
    // heat(1) = 0.8 * 0.95455^1 ≈ 0.764
    const result = computeDecay(0.8, 1.0, 0.5, 0.0, 1.0);
    expect(result).toBeGreaterThan(0.76);
    expect(result).toBeLessThan(0.77);
  });

  it("emotional resistance crossover: t=1h emotional > neutral", () => {
    // Rederived (Yonelinas & Ritchey 2015 + Kleinsmith & Kaplan 1963):
    // time_saturation = 1 - exp(-1) ≈ 0.6321
    // emotional_mod = 1 + 1.0 * 0.5 * 0.6321 = 1.3161
    // Neutral effective = 0.95455 (from above with confidence=1)
    // Emotional effective = 1 - (1 - 0.95455) / 1.3161 ≈ 0.9655
    const neutral = computeDecay(0.8, 1.0, 0.5, 0.0, 1.0);
    const emotional = computeDecay(0.8, 1.0, 0.5, 1.0, 1.0);
    expect(emotional).toBeGreaterThan(neutral);
  });

  it("at t=0, returns currentHeat unchanged", () => {
    expect(computeDecay(0.7, 0)).toBe(0.7);
  });

  it("100h cascade: heat near zero for λ=0.95, labile memory", () => {
    const result = computeDecay(1.0, 100.0, 0.5, 0.0, 1.0, { decayFactor: 0.95 });
    // 0.95^100 ≈ 0.00592; with confidence mod, still very small
    expect(result).toBeLessThan(0.01);
  });

  it("10000h: converges to essentially 0", () => {
    const result = computeDecay(1.0, 10_000.0, 0.5, 0.0, 1.0, { decayFactor: 0.95 });
    expect(result).toBeLessThan(1e-100);
  });
});

describe("computeSessionCoherence", () => {
  it("memory created 1h ago in a 4h window gets freshness boost", () => {
    const recentIso = new Date(Date.now() - 3_600_000).toISOString();
    const result = computeSessionCoherence(0.5, recentIso, 0.2, 4.0);
    // freshness = 1 - 1/4 = 0.75; boost = 0.2 * 0.75 = 0.15; result = 0.65
    expect(result).toBeCloseTo(0.65, 2);
  });

  it("memory outside window: no boost", () => {
    const oldIso = new Date(Date.now() - 5 * 3_600_000).toISOString();
    expect(computeSessionCoherence(0.5, oldIso, 0.2, 4.0)).toBe(0.5);
  });
});

describe("computeMetamemoryConfidence", () => {
  it("fewer than 4 accesses: returns null", () => {
    expect(computeMetamemoryConfidence(3, 2)).toBeNull();
  });

  it("5 accesses, 4 useful: returns 0.8", () => {
    expect(computeMetamemoryConfidence(5, 4)).toBeCloseTo(0.8, 5);
  });
});

describe("content classification", () => {
  it("isErrorContent: detects error keywords", () => {
    expect(isErrorContent("Failed to connect to database")).toBe(true);
    expect(isErrorContent("everything is fine")).toBe(false);
  });

  it("isDecisionContent: detects decision keywords", () => {
    expect(isDecisionContent("We decided to use PostgreSQL")).toBe(true);
    expect(isDecisionContent("just a regular note")).toBe(false);
  });
});
