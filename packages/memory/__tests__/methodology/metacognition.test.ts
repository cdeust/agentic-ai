/**
 * Unit tests for metacognition.ts (gap detection)
 *
 * Invariant assertions:
 *   - detectAllGaps: sorted descending by severity
 *   - detectIsolatedEntities: severity = 0.6 for degree 0, 0.4 for degree 1
 *   - detectLowConfidence: returns [] when all memories have high confidence
 *   - detectMissingConnections: bidirectional check (a,b) == (b,a)
 *
 * source: cortex@ed33435 mcp_server/core/metacognition.py
 */

import { describe, it, expect } from "vitest";
import {
  detectAllGaps,
  detectIsolatedEntities,
  detectLowConfidence,
  detectMissingConnections,
  detectStaleRegions,
  detectUnresolvedErrors,
} from "../../src/methodology/metacognition.js";

describe("detectIsolatedEntities", () => {
  it("returns [] when all entities have >= 2 connections", () => {
    const entities = [{ id: 1, name: "A" }];
    const counts = new Map([[1, 5]]);
    expect(detectIsolatedEntities(entities, counts)).toEqual([]);
  });

  it("reports severity 0.6 for degree 0", () => {
    const entities = [{ id: 1, name: "Isolated" }];
    const result = detectIsolatedEntities(entities, new Map());
    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe(0.6);
    expect(result[0]?.type).toBe("isolated_entity");
  });

  it("reports severity 0.4 for degree 1", () => {
    const entities = [{ id: 2, name: "OneDeg" }];
    const result = detectIsolatedEntities(entities, new Map([[2, 1]]));
    expect(result[0]?.severity).toBe(0.4);
  });
});

describe("detectStaleRegions", () => {
  it("returns [] when all memories are fresh (heat >= threshold)", () => {
    const mems = [{ heat: 0.8, domain: "api" }, { heat: 0.5, domain: "api" }];
    expect(detectStaleRegions(mems)).toEqual([]);
  });

  it("reports stale region when domain has >= 2 stale memories", () => {
    const mems = [
      { heat: 0.1, domain: "backend" },
      { heat: 0.2, domain: "backend" },
    ];
    const result = detectStaleRegions(mems, 0.3, 2);
    expect(result).toHaveLength(1);
    expect(result[0]?.type).toBe("stale_region");
  });

  it("does not report when only 1 stale memory in domain (minStale=2)", () => {
    const mems = [{ heat: 0.1, domain: "backend" }];
    expect(detectStaleRegions(mems, 0.3, 2)).toEqual([]);
  });

  it("severity capped at 0.9", () => {
    const mems = Array.from({ length: 20 }, () => ({ heat: 0.1, domain: "big" }));
    const result = detectStaleRegions(mems, 0.3, 2);
    expect(result[0]?.severity).toBeLessThanOrEqual(0.9);
  });
});

describe("detectLowConfidence", () => {
  it("returns [] when all memories have confidence >= threshold", () => {
    const mems = [{ confidence: 0.8 }, { confidence: 0.6 }];
    expect(detectLowConfidence(mems, 0.5)).toEqual([]);
  });

  it("returns a gap when there are low-confidence memories", () => {
    const mems = [{ confidence: 0.3 }, { confidence: 0.4 }];
    const result = detectLowConfidence(mems, 0.5);
    expect(result).toHaveLength(1);
    expect(result[0]?.type).toBe("low_confidence");
  });
});

describe("detectMissingConnections", () => {
  it("returns [] when all co-occurring pairs have edges", () => {
    const pairs: Array<[string, string]> = [["A", "B"]];
    const existing = new Set(["A|||B"]);
    expect(detectMissingConnections(pairs, existing)).toEqual([]);
  });

  it("treats (A,B) and (B,A) as same pair", () => {
    const pairs: Array<[string, string]> = [["B", "A"]];
    const existing = new Set(["A|||B"]);
    expect(detectMissingConnections(pairs, existing)).toEqual([]);
  });

  it("reports missing connection", () => {
    const pairs: Array<[string, string]> = [["X", "Y"]];
    const result = detectMissingConnections(pairs, new Set());
    expect(result).toHaveLength(1);
    expect(result[0]?.type).toBe("missing_connection");
  });
});

describe("detectUnresolvedErrors", () => {
  it("returns [] when all errors are resolved", () => {
    const errors = [{ id: 1, name: "err1" }];
    const resolved = new Set([1]);
    expect(detectUnresolvedErrors(errors, resolved)).toEqual([]);
  });

  it("reports unresolved errors with severity 0.5", () => {
    const errors = [{ id: 1, name: "err1" }, { id: 2, name: "err2" }];
    const result = detectUnresolvedErrors(errors, new Set([1]));
    expect(result).toHaveLength(1);
    expect(result[0]?.severity).toBe(0.5);
    expect(result[0]?.entities).toContain("err2");
  });
});

describe("detectAllGaps — sorted by severity descending", () => {
  it("invariant: output is sorted descending by severity", () => {
    const entities = [
      { id: 1, name: "A" },
      { id: 2, name: "B" },
    ];
    const relCounts = new Map([[1, 0], [2, 1]]);
    const mems = [{ heat: 0.1, domain: "x" }, { heat: 0.05, domain: "x" }];

    const result = detectAllGaps(
      entities,
      relCounts,
      mems,
      [],
      new Set(),
      [],
      new Set(),
    );

    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1]!.severity).toBeGreaterThanOrEqual(result[i]!.severity);
    }
  });
});
