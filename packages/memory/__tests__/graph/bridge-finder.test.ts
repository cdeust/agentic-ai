/**
 * Unit tests for bridge-finder.ts
 * source: cortex@ed33435 mcp_server/core/bridge_finder.py
 */

import { describe, it, expect } from "vitest";
import { findBridges } from "../../src/graph/bridge-finder.js";

// ── No data ────────────────────────────────────────────────────────────────

describe("findBridges — empty inputs", () => {
  it("returns empty object for null inputs", () => {
    const result = findBridges(null, null, null);
    expect(result).toEqual({});
  });

  it("returns empty when no cross-domain connections", () => {
    const brainIndex = {
      memories: {
        m1: { domainId: "cortex", body: "hello", crossRefs: [] },
        m2: { domainId: "cortex", body: "world", crossRefs: [] },
      },
    };
    const result = findBridges(null, brainIndex, null);
    expect(Object.keys(result).length).toBe(0);
  });
});

// ── Structural bridges ────────────────────────────────────────────────────

describe("findBridges — structural bridges", () => {
  it("detects cross-domain structural edge", () => {
    const brainIndex = {
      memories: {
        m1: { domainId: "cortex", body: "node in cortex", crossRefs: ["m2"] },
        m2: { domainId: "ai-architect", body: "node in ai-architect", crossRefs: [] },
      },
    };
    const result = findBridges(null, brainIndex, null);
    expect("cortex" in result || "ai-architect" in result).toBe(true);
    const all = Object.values(result).flat();
    const structural = all.filter((b) => b.pattern === "structural-edge");
    expect(structural.length).toBeGreaterThan(0);
  });

  it("does not create bridge for same-domain edges", () => {
    const brainIndex = {
      memories: {
        m1: { domainId: "cortex", body: "a", crossRefs: ["m2"] },
        m2: { domainId: "cortex", body: "b", crossRefs: [] },
      },
    };
    const result = findBridges(null, brainIndex, null);
    const all = Object.values(result).flat();
    const structural = all.filter((b) => b.pattern === "structural-edge");
    expect(structural.length).toBe(0);
  });
});

// ── Analogical bridges ────────────────────────────────────────────────────

describe("findBridges — analogical bridges", () => {
  it("extracts analogy patterns from text", () => {
    const brainIndex = {
      memories: {
        m1: {
          domainId: "cortex",
          body: "This pattern is similar to how neural networks learn.",
          crossRefs: [],
        },
      },
    };
    const result = findBridges(null, brainIndex, null);
    if ("cortex" in result) {
      const analogies = result["cortex"].filter((b) => b.toDomain === "text-analogy");
      expect(analogies.length).toBeGreaterThan(0);
    }
  });
});

// ── Profile domain mapping ────────────────────────────────────────────────

describe("findBridges — profile domain mapping", () => {
  it("uses profiles to resolve domain from project", () => {
    const profiles = {
      domains: {
        "domain-a": { projects: ["proj1"] },
        "domain-b": { projects: ["proj2"] },
      },
    };
    const brainIndex = {
      memories: {
        m1: { projectId: "proj1", body: "from proj1", crossRefs: ["m2"] },
        m2: { projectId: "proj2", body: "from proj2", crossRefs: [] },
      },
    };
    const result = findBridges(profiles, brainIndex, null);
    const all = Object.values(result).flat();
    const structural = all.filter((b) => b.pattern === "structural-edge");
    expect(structural.length).toBeGreaterThan(0);
  });
});
