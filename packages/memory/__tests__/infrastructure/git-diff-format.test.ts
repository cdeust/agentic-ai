/**
 * Unit tests for infrastructure/git-diff-format.ts
 *
 * Invariants:
 *   - parseDiffLines drops diff/index/+++/--- header lines
 *   - build/content_as_* functions respect maxLines truncation
 *   - truncated flag is true iff len(lines) > maxLines
 *
 * source: Cortex mcp_server/infrastructure/git_diff_format.py
 */

import { describe, it, expect } from "vitest";
import {
  parseDiffLines,
  buildResult,
  contentAsNew,
  contentAsDelete,
  contentAsContext,
} from "../../src/infrastructure/git-diff-format.js";

describe("parseDiffLines", () => {
  it("drops diff/index/+++/--- headers", () => {
    const raw = [
      "diff --git a/f b/f",
      "index abc..def 100644",
      "--- a/f",
      "+++ b/f",
      "@@ -1,2 +1,3 @@",
      "+new line",
      "-old line",
      " context",
    ].join("\n");
    const lines = parseDiffLines(raw);
    expect(lines.map((l) => l.type)).toEqual(["hunk", "add", "del", "ctx"]);
  });

  it("classifies hunk markers as hunk type", () => {
    const lines = parseDiffLines("@@ -0,0 +1 @@");
    expect(lines[0]?.type).toBe("hunk");
  });

  it("returns empty array for empty input", () => {
    expect(parseDiffLines("")).toEqual([]);
  });
});

describe("buildResult", () => {
  it("slices to maxLines and sets truncated", () => {
    const raw = Array.from({ length: 5 }, (_, i) => `+line${i}`).join("\n");
    const result = buildResult("f.ts", "modified", raw, 3);
    expect(result.lines).toHaveLength(3);
    expect(result.truncated).toBe(true);
    expect(result.file).toBe("f.ts");
    expect(result.diff_type).toBe("modified");
  });

  it("sets truncated=false when lines <= maxLines", () => {
    const raw = "+one\n+two";
    const result = buildResult("f.ts", "modified", raw, 10);
    expect(result.truncated).toBe(false);
  });
});

describe("contentAsNew", () => {
  it("all lines have type add and start with +", () => {
    const result = contentAsNew("f.ts", "line1\nline2", 100);
    expect(result.diff_type).toBe("new_file");
    expect(result.lines.every((l) => l.type === "add")).toBe(true);
    expect(result.lines.every((l) => l.text.startsWith("+"))).toBe(true);
  });

  it("uses custom diff_type when provided", () => {
    const result = contentAsNew("f.ts", "x", 10, "custom_type");
    expect(result.diff_type).toBe("custom_type");
  });
});

describe("contentAsDelete", () => {
  it("all lines have type del and start with -", () => {
    const result = contentAsDelete("f.ts", "line1\nline2", 100);
    expect(result.diff_type).toBe("deleted");
    expect(result.lines.every((l) => l.type === "del")).toBe(true);
    expect(result.lines.every((l) => l.text.startsWith("-"))).toBe(true);
  });
});

describe("contentAsContext", () => {
  it("all lines have type ctx and start with space", () => {
    const result = contentAsContext("f.ts", "line1\nline2", 100);
    expect(result.diff_type).toBe("unchanged");
    expect(result.lines.every((l) => l.type === "ctx")).toBe(true);
    expect(result.lines.every((l) => l.text.startsWith(" "))).toBe(true);
  });
});
