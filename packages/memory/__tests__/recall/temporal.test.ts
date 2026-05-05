/**
 * Tests for temporal.ts — date parsing, recency boost, date distance.
 *
 * Invariant: all scoring functions return values in [0, 1].
 * Happy path: valid ISO dates, named month dates.
 * Error path: null, empty, future dates.
 */

import { describe, it, expect } from "vitest";
import {
  isTemporalQuery,
  extractDateHints,
  computeTemporalProximity,
  parseDate,
  normalizeDateToIso,
  computeDateDistanceScore,
  computeRecencyBoost,
} from "../../src/recall/temporal.js";

// ── isTemporalQuery ───────────────────────────────────────────────────────

describe("isTemporalQuery", () => {
  it("detects 'when' keyword", () => {
    expect(isTemporalQuery("when did this happen?")).toBe(true);
  });

  it("detects ISO date in query", () => {
    expect(isTemporalQuery("what happened on 2024-01-15?")).toBe(true);
  });

  it("returns false for non-temporal query", () => {
    expect(isTemporalQuery("how does the authentication work?")).toBe(false);
  });
});

// ── extractDateHints ──────────────────────────────────────────────────────

describe("extractDateHints", () => {
  it("extracts ISO date", () => {
    const hints = extractDateHints("on 2024-03-15 we deployed");
    expect(hints).toContain("2024-03-15");
  });

  it("extracts month name", () => {
    const hints = extractDateHints("we decided in january");
    expect(hints.some((h) => h.toLowerCase().includes("january"))).toBe(true);
  });

  it("returns empty for text without dates", () => {
    const hints = extractDateHints("hello world");
    expect(hints.length).toBe(0);
  });
});

// ── computeTemporalProximity ──────────────────────────────────────────────

describe("computeTemporalProximity", () => {
  it("returns 1.0 for exact match", () => {
    expect(computeTemporalProximity("we met on january", ["january"])).toBe(1.0);
  });

  it("returns 0 for no match", () => {
    expect(computeTemporalProximity("hello world", ["december"])).toBe(0.0);
  });

  it("returns 0 for empty hints", () => {
    expect(computeTemporalProximity("january february", [])).toBe(0.0);
  });
});

// ── parseDate ─────────────────────────────────────────────────────────────

describe("parseDate", () => {
  it("parses ISO date string", () => {
    const d = parseDate("2024-03-15");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2024);
  });

  it("parses DD Month YYYY format", () => {
    const d = parseDate("15 March 2024");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2024);
  });

  it("returns null for empty string", () => {
    expect(parseDate("")).toBeNull();
  });

  it("returns null for invalid string", () => {
    expect(parseDate("not a date at all")).toBeNull();
  });
});

// ── computeDateDistanceScore ──────────────────────────────────────────────

describe("computeDateDistanceScore", () => {
  it("returns 1.0 for exact date match", () => {
    const score = computeDateDistanceScore("2024-03-15", ["2024-03-15"]);
    expect(score).toBeCloseTo(1.0, 3);
  });

  it("returns lower score for dates further apart", () => {
    const close = computeDateDistanceScore("2024-03-15", ["2024-03-16"]);
    const far = computeDateDistanceScore("2024-03-15", ["2024-06-15"]);
    expect(close).toBeGreaterThan(far);
  });

  it("returns 0 for empty hints", () => {
    expect(computeDateDistanceScore("2024-03-15", [])).toBe(0.0);
  });

  it("returns 0 for invalid date string", () => {
    expect(computeDateDistanceScore("not-a-date", ["2024-03-15"])).toBe(0.0);
  });
});

// ── computeRecencyBoost ───────────────────────────────────────────────────

describe("computeRecencyBoost", () => {
  it("returns positive boost for very recent date", () => {
    const recent = new Date(Date.now() - 1000 * 60 * 60).toISOString(); // 1 hour ago
    const boost = computeRecencyBoost(recent);
    expect(boost).toBeGreaterThan(0);
    expect(boost).toBeLessThanOrEqual(0.15);
  });

  it("returns 0 for very old date (beyond cutoff)", () => {
    const old = new Date("2020-01-01").toISOString();
    const boost = computeRecencyBoost(old);
    expect(boost).toBe(0.0);
  });

  it("returns 0 for null", () => {
    expect(computeRecencyBoost(null)).toBe(0.0);
  });

  it("returns 0 for future date", () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString();
    expect(computeRecencyBoost(future)).toBe(0.0);
  });
});
