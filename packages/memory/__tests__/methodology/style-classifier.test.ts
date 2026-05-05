/**
 * Unit tests for style-classifier.ts
 *
 * Invariant assertions:
 *   - classifyStyle: all numeric axes in [-1, 1]
 *   - classifyStyle: returns deterministic output for fixed input
 *   - categorical dimensions have non-empty string values
 *
 * source: cortex@ed33435 mcp_server/core/style_classifier.py
 */

import { describe, it, expect } from "vitest";
import { classifyStyle } from "../../src/methodology/style-classifier.js";

const EDIT_HEAVY_CONV = {
  toolsUsed: ["Edit", "Edit", "Edit", "Write", "Edit", "Bash"],
  durationMinutes: 8,
  summary: "implemented new feature quickly",
  filesTouched: ["src/a.ts", "src/b.ts"],
};

const READ_HEAVY_CONV = {
  toolsUsed: ["Read", "Read", "Grep", "Read", "Read", "Read"],
  durationMinutes: 45,
  summary: "analyzed architecture patterns and system design",
  filesTouched: ["src/a.ts", "src/b.ts", "src/c.ts", "lib/d.ts"],
};

describe("classifyStyle", () => {
  it("returns default style for empty input", () => {
    const style = classifyStyle([]);
    expect(style.activeReflective).toBe(0);
    expect(style.sensingIntuitive).toBe(0);
    expect(style.sequentialGlobal).toBe(0);
  });

  it("returns default style for non-array input", () => {
    const style = classifyStyle(null);
    expect(style.activeReflective).toBe(0);
  });

  it("all numeric axes are in [-1, 1] for mixed input", () => {
    const convs = [EDIT_HEAVY_CONV, READ_HEAVY_CONV];
    const style = classifyStyle(convs);
    expect(style.activeReflective).toBeGreaterThanOrEqual(-1);
    expect(style.activeReflective).toBeLessThanOrEqual(1);
    expect(style.sensingIntuitive).toBeGreaterThanOrEqual(-1);
    expect(style.sensingIntuitive).toBeLessThanOrEqual(1);
    expect(style.sequentialGlobal).toBeGreaterThanOrEqual(-1);
    expect(style.sequentialGlobal).toBeLessThanOrEqual(1);
  });

  it("is deterministic for fixed input", () => {
    const convs = [EDIT_HEAVY_CONV, READ_HEAVY_CONV];
    const style1 = classifyStyle(convs);
    const style2 = classifyStyle(convs);
    expect(style1.activeReflective).toBe(style2.activeReflective);
    expect(style1.sensingIntuitive).toBe(style2.sensingIntuitive);
    expect(style1.sequentialGlobal).toBe(style2.sequentialGlobal);
  });

  it("edit-heavy sessions bias toward active (positive activeReflective)", () => {
    // 5 edits, short session (8 min < 10 min)
    const style = classifyStyle([EDIT_HEAVY_CONV]);
    expect(style.activeReflective).toBeGreaterThan(0);
  });

  it("read-heavy sessions bias toward reflective (negative activeReflective)", () => {
    const style = classifyStyle([READ_HEAVY_CONV]);
    expect(style.activeReflective).toBeLessThan(0);
  });

  it("abstract-keyword-heavy sessions bias toward intuitive (negative sensingIntuitive)", () => {
    const conv = {
      toolsUsed: [],
      durationMinutes: 30,
      summary: "architecture pattern design abstraction framework high-level strategy",
      filesTouched: [],
    };
    const style = classifyStyle([conv]);
    expect(style.sensingIntuitive).toBeLessThanOrEqual(0);
  });

  it("categorical dimensions are non-empty strings", () => {
    const style = classifyStyle([EDIT_HEAVY_CONV]);
    expect(typeof style.problemDecomposition).toBe("string");
    expect(style.problemDecomposition!.length).toBeGreaterThan(0);
    expect(typeof style.explorationStyle).toBe("string");
    expect(typeof style.verificationBehavior).toBe("string");
  });
});
