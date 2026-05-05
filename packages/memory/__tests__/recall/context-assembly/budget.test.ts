/**
 * Unit tests for budget.ts — token estimation, budget allocation, truncation.
 * Verifies graph invariants: deterministic output, postconditions hold.
 */

import { describe, expect, it } from "vitest";
import {
  availableBudget,
  estimateTokens,
  makeAssemblyMetrics,
  makePlaceholder,
  reductionFraction,
  truncateToBudget,
  wasTruncated,
} from "../../../src/recall/context-assembly/budget.js";

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("returns at least 1 for non-empty string", () => {
    expect(estimateTokens("hi")).toBeGreaterThanOrEqual(1);
  });

  it("is approximately chars/3", () => {
    const text = "a".repeat(30);
    expect(estimateTokens(text)).toBe(10);
  });
});

describe("availableBudget", () => {
  it("returns 0 for zero window", () => {
    expect(availableBudget(0)).toBe(0);
  });

  it("returns 75% of window by default", () => {
    expect(availableBudget(1000)).toBe(750);
  });

  it("respects custom headroom", () => {
    expect(availableBudget(1000, 0.5)).toBe(500);
  });
});

describe("truncateToBudget", () => {
  it("returns text as-is when within budget", () => {
    const t = "hello world";
    expect(truncateToBudget(t, 100)).toBe(t);
  });

  it("truncates long text to fit budget", () => {
    const t = "a".repeat(300); // 100 tokens
    const result = truncateToBudget(t, 50);
    expect(estimateTokens(result)).toBeLessThanOrEqual(50);
  });

  it("prefers line boundary over hard cut", () => {
    const t = "line one\nline two\n" + "a".repeat(300);
    const result = truncateToBudget(t, 5);
    // Should cut at a newline boundary
    expect(result.endsWith("\n")).toBe(true);
  });
});

describe("makePlaceholder", () => {
  it("defaults priority to 1", () => {
    const p = makePlaceholder("{{K}}", "value");
    expect(p.priority).toBe(1);
    expect(p.condenser).toBeUndefined();
  });

  it("accepts custom priority and condenser", () => {
    const cond = (v: string, _: number): string => v.slice(0, 5);
    const p = makePlaceholder("{{K}}", "value", 3, cond);
    expect(p.priority).toBe(3);
    expect(p.condenser).toBe(cond);
  });
});

describe("AssemblyMetrics", () => {
  it("reductionFraction returns 1.0 when original is 0", () => {
    const m = makeAssemblyMetrics();
    expect(reductionFraction(m, "missing")).toBe(1.0);
  });

  it("reductionFraction computes surviving fraction correctly", () => {
    const m = makeAssemblyMetrics();
    m.originalTokens["K"] = 100;
    m.finalTokens["K"] = 80;
    expect(reductionFraction(m, "K")).toBeCloseTo(0.8);
  });

  it("wasTruncated uses 0.9 threshold by default", () => {
    const m = makeAssemblyMetrics();
    m.originalTokens["K"] = 100;
    m.finalTokens["K"] = 85; // 0.85 < 0.9 → truncated
    expect(wasTruncated(m, "K")).toBe(true);

    m.finalTokens["K"] = 95; // 0.95 >= 0.9 → not truncated
    expect(wasTruncated(m, "K")).toBe(false);
  });
});
