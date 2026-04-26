/**
 * Tests for methodology-engine.ts — blind spots, bridges, persistent features.
 *
 * source: mcp_server/core/blindspot_detector.py
 * source: mcp_server/core/behavioral_crosscoder.py
 */

import { describe, it, expect } from "vitest";
import {
  detectBlindSpots,
  detectPersistentFeatures,
  compareFeatureProfiles,
  generateContext,
} from "../../src/methodology/methodology-engine.js";
import type { DomainProfile, ProfilesStore } from "../../src/methodology/types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<DomainProfile> = {}): DomainProfile {
  return {
    id: "test", label: "Test", projects: [], categories: {}, topKeywords: [],
    entryPoints: [], recurringPatterns: [],
    toolPreferences: {
      Read: { ratio: 0.3, avgPerSession: 3 },
      Edit: { ratio: 0.5, avgPerSession: 5 },
    },
    sessionShape: { avgDuration: 900_000, avgTurns: 12, avgMessages: 8, burstRatio: 0.3, explorationRatio: 0.4, dominantMode: "mixed" },
    connectionBridges: [], blindSpots: [],
    metacognitive: { activeReflective: 0.3, sensingIntuitive: 0, sequentialGlobal: 0.1 },
    confidence: 0.5, sessionCount: 10, lastUpdated: null, firstSeen: null,
    ...overrides,
  };
}

// ── detectBlindSpots ─────────────────────────────────────────────────────────

describe("detectBlindSpots", () => {
  it("returns empty array for empty conversation list", () => {
    const spots = detectBlindSpots([], []);
    expect(spots).toEqual([]);
  });

  it("detects category blind spot when category appears in <5% of sessions", () => {
    // 100 sessions, 0 of them are 'testing'
    const convs = Array(100).fill({ category: "feature" });
    const spots = detectBlindSpots(convs, convs);
    const testingSpot = spots.find((s) => s.type === "category" && s.value === "testing");
    expect(testingSpot).toBeDefined();
    expect(testingSpot?.severity).toBe("high");
  });

  it("detects tool blind spot for relevant unused tools", () => {
    // Domain has bug-fix sessions but never uses Grep
    const convs = Array(20).fill({ category: "bug-fix", toolsUsed: ["Read", "Edit"] });
    const spots = detectBlindSpots(convs, convs);
    const grepSpot = spots.find((s) => s.type === "tool" && s.value === "Grep");
    expect(grepSpot).toBeDefined();
  });

  it("detects exploration pattern gap when domain has 0% exploration but global is 50%", () => {
    const domainConvs = Array(20).fill({ category: "bug-fix" });
    // Global has 50% exploration (research/architecture)
    const exploration = Array(20).fill({ category: "research" });
    const bugFix = Array(20).fill({ category: "bug-fix" });
    const allConvs = [...exploration, ...bugFix];
    const spots = detectBlindSpots(domainConvs, allConvs);
    const explorationSpot = spots.find((s) => s.type === "pattern" && s.value === "exploration");
    expect(explorationSpot).toBeDefined();
    expect(explorationSpot?.severity).toBe("high");
  });

  it("does not flag exploration when domain ratio is within 25% of global", () => {
    const domainConvs = [
      ...Array(10).fill({ category: "research" }),
      ...Array(10).fill({ category: "bug-fix" }),
    ];
    const allConvs = [...domainConvs];
    const spots = detectBlindSpots(domainConvs, allConvs);
    const explorationSpot = spots.find((s) => s.type === "pattern" && s.value === "exploration");
    expect(explorationSpot).toBeUndefined();
  });
});

// ── detectPersistentFeatures ──────────────────────────────────────────────────

describe("detectPersistentFeatures", () => {
  it("returns empty array when dictionary is null", () => {
    expect(detectPersistentFeatures({}, null)).toEqual([]);
  });

  it("returns empty array when fewer than 2 domains", () => {
    const profiles = { "solo": makeProfile() };
    const dict = { features: [{ label: "edit-heavy" }] };
    expect(detectPersistentFeatures(profiles, dict)).toEqual([]);
  });

  it("detects feature active in all domains (persistence=1.0)", () => {
    const profiles = {
      "domainA": makeProfile({ featureActivations: { "edit-heavy": 0.8 } }),
      "domainB": makeProfile({ featureActivations: { "edit-heavy": 0.6 } }),
    };
    const dict = { features: [{ label: "edit-heavy" }] };
    const persistent = detectPersistentFeatures(profiles, dict);
    expect(persistent).toHaveLength(1);
    expect(persistent[0]?.label).toBe("edit-heavy");
    expect(persistent[0]?.persistence).toBe(1);
  });

  it("does not return feature below persistence threshold (0.5)", () => {
    const profiles = {
      "domainA": makeProfile({ featureActivations: { "edit-heavy": 0.8 } }),
      "domainB": makeProfile({ featureActivations: {} }), // not active
      "domainC": makeProfile({ featureActivations: {} }), // not active
    };
    const dict = { features: [{ label: "edit-heavy" }] };
    const persistent = detectPersistentFeatures(profiles, dict);
    // Only 1 of 3 domains → persistence = 0.33 < 0.5
    expect(persistent).toHaveLength(0);
  });
});

// ── compareFeatureProfiles ────────────────────────────────────────────────────

describe("compareFeatureProfiles", () => {
  it("returns shared features above threshold", () => {
    const a = { "edit-heavy": 0.8, "debug-oriented": 0.05 }; // edit-heavy active, debug not
    const b = { "edit-heavy": 0.6, "debug-oriented": 0.7 };
    const result = compareFeatureProfiles(a, b);
    expect(result.shared).toContain("edit-heavy");
    expect(result.uniqueToB).toContain("debug-oriented");
    expect(result.uniqueToA).toHaveLength(0);
  });

  it("handles null activations gracefully", () => {
    const result = compareFeatureProfiles(null, null);
    expect(result.shared).toEqual([]);
    expect(result.uniqueToA).toEqual([]);
    expect(result.uniqueToB).toEqual([]);
  });
});

// ── generateContext ───────────────────────────────────────────────────────────

describe("generateContext", () => {
  it("includes domain label in output", () => {
    const profile = makeProfile({ label: "Cortex Core", sessionCount: 25 });
    const ctx = generateContext("cortex", profile);
    expect(ctx).toContain("Cortex Core");
  });

  it("mentions session count", () => {
    const profile = makeProfile({ sessionCount: 42 });
    const ctx = generateContext("test", profile);
    expect(ctx).toContain("42");
  });

  it("names a cognitive style when axis is > 0.3", () => {
    const profile = makeProfile({
      metacognitive: { activeReflective: 0.8, sensingIntuitive: 0, sequentialGlobal: 0 },
    });
    const ctx = generateContext("test", profile);
    expect(ctx).toContain("active learner");
  });

  it("returns a non-empty string even for a minimal profile", () => {
    const profile = makeProfile({ sessionCount: 0 });
    const ctx = generateContext("test", profile);
    expect(ctx.length).toBeGreaterThan(0);
  });
});
