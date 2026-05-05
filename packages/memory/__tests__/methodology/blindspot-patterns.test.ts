/**
 * Unit tests for blindspot-patterns.ts
 *
 * Invariant assertions:
 *   - checkExplorationGap: returns [] or 1 "pattern" BlindSpot
 *   - countDurationBuckets: short/long counts are non-negative and consistent
 *   - checkDurationGaps: zero or more BlindSpots of type "pattern"
 *
 * source: cortex@ed33435 mcp_server/core/blindspot_patterns.py
 */

import { describe, it, expect } from "vitest";
import {
  checkDurationGaps,
  checkExplorationGap,
  countDurationBuckets,
} from "../../src/methodology/blindspot-patterns.js";

describe("checkExplorationGap", () => {
  it("returns [] when domain and global ratios are both low", () => {
    const result = checkExplorationGap(0.1, 0.1);
    expect(result).toEqual([]);
  });

  it("returns high-severity blind spot when domain has zero exploration and global >= 40%", () => {
    const result = checkExplorationGap(0, 0.5);
    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe("high");
    expect(result[0]?.type).toBe("pattern");
    expect(result[0]?.value).toBe("exploration");
  });

  it("returns medium severity when domain ratio is well below global", () => {
    // domain = 0.04 < global * 0.25 (0.25 * 0.2 = 0.05), global >= 0.2
    const result = checkExplorationGap(0.04, 0.25);
    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe("medium");
  });

  it("returns [] when domain ratio is at global * 0.25 boundary", () => {
    // domain exactly at global * 0.25 — NOT strictly less
    const result = checkExplorationGap(0.05, 0.2);
    expect(result).toEqual([]);
  });

  it("returns [] when domain has no exploration and global < 0.4", () => {
    const result = checkExplorationGap(0, 0.3);
    expect(result).toEqual([]);
  });
});

describe("countDurationBuckets", () => {
  it("returns [0, 0] for empty array", () => {
    expect(countDurationBuckets([])).toEqual([0, 0]);
  });

  it("counts short (<10 min) and long (>30 min) sessions correctly", () => {
    const convs = [
      { durationMinutes: 5 },   // short
      { durationMinutes: 15 },  // neither
      { durationMinutes: 45 },  // long
      { durationMinutes: 9 },   // short (9 < 10)
      { durationMinutes: 31 },  // long (31 > 30)
    ];
    const [short, long] = countDurationBuckets(convs);
    expect(short).toBe(2);
    expect(long).toBe(2);
  });

  it("ignores zero or negative durations", () => {
    expect(countDurationBuckets([{ durationMinutes: 0 }, { duration: -1 }])).toEqual([0, 0]);
  });

  it("falls back to 'duration' field", () => {
    const [short] = countDurationBuckets([{ duration: 5 }]);
    expect(short).toBe(1);
  });
});

describe("checkDurationGaps", () => {
  it("returns [] when domain has both short and long sessions", () => {
    expect(checkDurationGaps(10, 2, 3, 0.4, 0.4)).toEqual([]);
  });

  it("reports deep-work gap when domain has no long sessions and global >= 30%", () => {
    const result = checkDurationGaps(10, 2, 0, 0.3, 0.35);
    const deepWork = result.find((g) => g.value === "deep-work");
    expect(deepWork).toBeDefined();
    expect(deepWork?.severity).toBe("medium");
  });

  it("reports quick-iteration gap when domain has no short sessions and global >= 30%", () => {
    const result = checkDurationGaps(10, 0, 3, 0.35, 0.3);
    const qi = result.find((g) => g.value === "quick-iteration");
    expect(qi).toBeDefined();
    expect(qi?.severity).toBe("low");
  });

  it("does not report deep-work gap when global < 30%", () => {
    const result = checkDurationGaps(10, 1, 0, 0.3, 0.2);
    expect(result.find((g) => g.value === "deep-work")).toBeUndefined();
  });
});
