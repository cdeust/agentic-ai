/**
 * Unit tests for heat.ts — age-decayed initial heat.
 *
 * Validates the TS port against reference points documented in the Python
 * source (backfill_helpers.py docstring).
 *
 * source: mcp_server/handlers/backfill_helpers.py::age_decayed_heat docstring
 *         reference points (floor=0.3, halfLife=30d):
 *           age=0   → 1.000
 *           age=7   → ~0.879
 *           age=30  → ~0.650
 *           age=90  → ~0.388
 *           age=180 → ~0.311
 *           age=365 → ~0.301
 */

import { describe, it, expect } from "vitest";
import { ageDecayedHeat, computeAgeDays } from "../../src/import/heat.js";

// ── ageDecayedHeat ────────────────────────────────────────────────────────

describe("ageDecayedHeat", () => {
  it("returns 1.0 at age=0", () => {
    expect(ageDecayedHeat(0)).toBeCloseTo(1.0, 4);
  });

  it("returns ~0.895 at age=7d (half-life=30, floor=0.3)", () => {
    // source: backfill_helpers.py::age_decayed_heat formula (docstring lists 0.879 which
    //   is an authoring error — actual formula output: floor + (1-floor)*exp(-7*ln2/30) ≈ 0.895)
    // Verified: python3 -c "import math; f=0.3; print(f+(1-f)*math.exp(-7*math.log(2)/30))"
    // → 0.895467
    expect(ageDecayedHeat(7)).toBeCloseTo(0.895, 2);
  });

  it("returns ~0.650 at age=30d (half-life=30, floor=0.3)", () => {
    // source: backfill_helpers.py::age_decayed_heat docstring
    expect(ageDecayedHeat(30)).toBeCloseTo(0.650, 2);
  });

  it("returns ~0.388 at age=90d", () => {
    // source: python3 -c "import math; f=0.3; print(f+(1-f)*math.exp(-90*math.log(2)/30))"
    // → 0.387500
    expect(ageDecayedHeat(90)).toBeCloseTo(0.388, 2);
  });

  it("returns ~0.311 at age=180d", () => {
    // source: python3 -c "import math; f=0.3; print(f+(1-f)*math.exp(-180*math.log(2)/30))"
    // → 0.310937
    expect(ageDecayedHeat(180)).toBeCloseTo(0.311, 2);
  });

  it("returns ~0.300 at age=365d (approaches floor)", () => {
    // source: python3 -c "import math; f=0.3; print(f+(1-f)*math.exp(-365*math.log(2)/30))"
    // → 0.300152
    expect(ageDecayedHeat(365)).toBeCloseTo(0.300, 2);
  });

  it("clamps negative age to 0 — returns 1.0", () => {
    // source: clamped_age = max(0.0, float(age_days)) — backfill_helpers.py
    expect(ageDecayedHeat(-10)).toBeCloseTo(1.0, 4);
  });

  it("result is always in [floor, 1.0]", () => {
    for (const age of [0, 1, 7, 30, 90, 180, 365, 1000]) {
      const h = ageDecayedHeat(age);
      expect(h).toBeGreaterThanOrEqual(0.3);
      expect(h).toBeLessThanOrEqual(1.0);
    }
  });

  it("is monotone non-increasing in age", () => {
    const ages = [0, 7, 30, 90, 180, 365];
    let prev = ageDecayedHeat(0);
    for (const age of ages.slice(1)) {
      const curr = ageDecayedHeat(age);
      expect(curr).toBeLessThanOrEqual(prev);
      prev = curr;
    }
  });
});

// ── computeAgeDays ────────────────────────────────────────────────────────

describe("computeAgeDays", () => {
  it("returns 0.0 for null/undefined/empty", () => {
    expect(computeAgeDays(null)).toBe(0.0);
    expect(computeAgeDays(undefined)).toBe(0.0);
    expect(computeAgeDays("")).toBe(0.0);
  });

  it("returns 0.0 for unparseable timestamp", () => {
    // source: returns 0.0 on missing, unparseable, or future-dated input
    expect(computeAgeDays("not-a-date")).toBe(0.0);
  });

  it("returns correct age for a known timestamp", () => {
    const ts = "2025-01-01T00:00:00Z";
    const nowMs = new Date("2025-01-31T00:00:00Z").getTime();
    const age = computeAgeDays(ts, nowMs);
    expect(age).toBeCloseTo(30.0, 4);
  });

  it("returns 0.0 for future-dated timestamp (safe fallback)", () => {
    const futureTs = new Date(Date.now() + 86_400_000 * 10).toISOString();
    expect(computeAgeDays(futureTs)).toBe(0.0);
  });

  it("handles Z-suffix ISO timestamps", () => {
    const ts = "2025-06-01T12:00:00Z";
    const nowMs = new Date("2025-07-01T12:00:00Z").getTime();
    const age = computeAgeDays(ts, nowMs);
    expect(age).toBeCloseTo(30.0, 1);
  });
});
