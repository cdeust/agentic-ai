/**
 * Tests for wiki-staleness.ts — staleness verdict.
 *
 * Invariant: decision is deterministic for same inputs.
 * Happy path: correct staleness detection.
 * Error path: fewer than MIN_FILE_REFS → never stale.
 */

import { describe, it, expect } from "vitest";
import {
  extractFileRefs,
  evaluateStaleness,
  harvestPageRefs,
  STALE_THRESHOLD,
  MIN_FILE_REFS,
} from "../../src/wiki/wiki-staleness.js";

describe("extractFileRefs", () => {
  it("extracts .py file references", () => {
    const refs = extractFileRefs("see src/auth/login.py for details");
    expect(refs).toContain("src/auth/login.py");
  });

  it("deduplicates refs", () => {
    const refs = extractFileRefs("foo.py and foo.py again");
    expect(refs.filter((r) => r === "foo.py")).toHaveLength(1);
  });

  it("returns empty for text without file refs", () => {
    expect(extractFileRefs("hello world, no files here")).toHaveLength(0);
  });

  it("extracts .ts files", () => {
    const refs = extractFileRefs("modified packages/memory/src/recall/scoring.ts");
    expect(refs.some((r) => r.endsWith(".ts"))).toBe(true);
  });
});

describe("evaluateStaleness", () => {
  it("not stale when fewer than MIN_FILE_REFS", () => {
    const decision = evaluateStaleness({
      pageId: 1,
      isStaleWas: false,
      fileRefs: ["foo.py"], // only 1 ref < MIN_FILE_REFS=2
      existence: { "foo.py": false },
    });
    expect(decision.isStaleNow).toBe(false);
  });

  it("stale when >= STALE_THRESHOLD of refs are missing", () => {
    const decision = evaluateStaleness({
      pageId: 1,
      isStaleWas: false,
      fileRefs: ["a.py", "b.py", "c.py", "d.py"],
      existence: { "a.py": false, "b.py": false, "c.py": true, "d.py": true },
      // 2/4 missing = 0.5 >= STALE_THRESHOLD
    });
    expect(decision.isStaleNow).toBe(true);
  });

  it("not stale when all refs exist", () => {
    const decision = evaluateStaleness({
      pageId: 1,
      isStaleWas: false,
      fileRefs: ["a.py", "b.py"],
      existence: { "a.py": true, "b.py": true },
    });
    expect(decision.isStaleNow).toBe(false);
  });

  it("detects transition", () => {
    const decision = evaluateStaleness({
      pageId: 1,
      isStaleWas: true,
      fileRefs: ["a.py", "b.py"],
      existence: { "a.py": true, "b.py": true },
    });
    expect(decision.transitioned).toBe(true);
    expect(decision.isStaleNow).toBe(false);
  });

  it("is deterministic", () => {
    const opts = {
      pageId: 1,
      isStaleWas: false,
      fileRefs: ["a.py", "b.py"],
      existence: { "a.py": false, "b.py": true },
    };
    const d1 = evaluateStaleness(opts);
    const d2 = evaluateStaleness(opts);
    expect(d1.isStaleNow).toBe(d2.isStaleNow);
    expect(d1.rationale).toBe(d2.rationale);
  });
});

describe("harvestPageRefs", () => {
  it("collects refs from lead and sections", () => {
    const page = {
      lead: "See src/auth.py for details",
      sections: { "Implementation": "Also uses src/db.py" },
    };
    const refs = harvestPageRefs(page, []);
    expect(refs.some((r) => r.includes("auth.py"))).toBe(true);
    expect(refs.some((r) => r.includes("db.py"))).toBe(true);
  });

  it("combines claim evidence with inline refs", () => {
    const page = { lead: "See foo.ts" };
    const refs = harvestPageRefs(page, ["bar.py"]);
    expect(refs).toContain("bar.py");
    expect(refs.some((r) => r.includes("foo.ts"))).toBe(true);
  });

  it("deduplicates across sources", () => {
    const page = { lead: "See foo.py here" };
    const refs = harvestPageRefs(page, ["foo.py"]);
    expect(refs.filter((r) => r === "foo.py")).toHaveLength(1);
  });
});
