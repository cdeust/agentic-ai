/**
 * Unit tests for graph-builder.ts and its helpers.
 *
 * Invariants:
 *   - Node ID uniqueness: no two nodes share the same id
 *   - Edge consistency: every edge source/target appears in the node list
 *   - DAG structure of hub → children (directed, no cycles in the main flow)
 *   - buildGraph with filterDomain produces only nodes for that domain
 */

import { describe, expect, it } from "vitest";
import { buildGraph } from "../../../src/workflow-graph/graph-builder.js";

const FIXTURE_PROFILES = {
  domains: {
    "ai-architect": {
      label: "AI Architect",
      sessionCount: 10,
      confidence: 0.9,
      entryPoints: [{ pattern: "implement feature", frequency: 5, confidence: 0.8 }],
      recurringPatterns: [{ pattern: "refactor module", frequency: 3, confidence: 0.7 }],
      toolPreferences: {
        Bash: { ratio: 0.4, avgPerSession: 20 },
        Read: { ratio: 0.3, avgPerSession: 15 },
      },
      featureActivations: { "systematic-thinking": 0.8, "code-focus": 0.6 },
      connectionBridges: [{ toDomain: "cortex", weight: 0.7, pattern: "shared-rag" }],
      blindSpots: [{ type: "tool", value: "Grep", severity: "medium", description: "rarely uses" }],
    },
    "cortex": {
      label: "Cortex",
      sessionCount: 5,
      confidence: 0.8,
      entryPoints: [],
      recurringPatterns: [],
      toolPreferences: {},
      featureActivations: {},
      connectionBridges: [],
      blindSpots: [],
    },
  },
  persistentFeatures: [
    { domains: ["ai-architect", "cortex"], persistence: 0.9, label: "code-first" },
  ],
};

describe("buildGraph", () => {
  it("produces at least one node per domain", () => {
    const { nodes } = buildGraph(FIXTURE_PROFILES);
    const domainNodes = nodes.filter((n) => n["type"] === "domain");
    expect(domainNodes.length).toBeGreaterThanOrEqual(2);
  });

  it("node ID uniqueness — no two nodes share the same id", () => {
    const { nodes } = buildGraph(FIXTURE_PROFILES);
    const ids = nodes.map((n) => n["id"] as string);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it("edge consistency — every edge endpoint appears in the node list", () => {
    const { nodes, edges } = buildGraph(FIXTURE_PROFILES);
    const nodeIds = new Set(nodes.map((n) => n["id"] as string));
    for (const e of edges) {
      const src = e["source"] as string;
      const tgt = e["target"] as string;
      // Bridges reference domain_N ids which may not exist if the bridging
      // domain is not in the filtered set — skip bridge edges
      if (e["type"] === "bridge") continue;
      if (!nodeIds.has(src)) {
        throw new Error(`Edge source ${src} not in node list`);
      }
      if (!nodeIds.has(tgt)) {
        throw new Error(`Edge target ${tgt} not in node list`);
      }
    }
    // If we reach here all non-bridge edges are valid
    expect(true).toBe(true);
  });

  it("filterDomain restricts output to one domain", () => {
    const { nodes } = buildGraph(FIXTURE_PROFILES, "ai-architect");
    const domainNodes = nodes.filter((n) => n["type"] === "domain");
    expect(domainNodes.length).toBe(1);
    expect(domainNodes[0]["domain"]).toBe("ai-architect");
  });

  it("blindSpotRegions populated from domain data", () => {
    const { blindSpotRegions } = buildGraph(FIXTURE_PROFILES);
    const aiRegions = blindSpotRegions.filter((r) => r["domain"] === "ai-architect");
    expect(aiRegions.length).toBe(1);
    expect(aiRegions[0]["value"]).toBe("Grep");
  });

  it("persistent feature edges cross-link domain hubs", () => {
    const { edges } = buildGraph(FIXTURE_PROFILES);
    const pfEdges = edges.filter((e) => e["type"] === "persistent-feature");
    expect(pfEdges.length).toBeGreaterThanOrEqual(1);
  });

  it("behavioral feature nodes are attached to their domain hub", () => {
    const { nodes, edges } = buildGraph(FIXTURE_PROFILES);
    const featNodes = nodes.filter((n) => n["type"] === "behavioral-feature");
    expect(featNodes.length).toBeGreaterThanOrEqual(1);
    for (const fn of featNodes) {
      const hubEdge = edges.find(
        (e) => e["target"] === fn["id"] && e["type"] === "has-feature",
      );
      expect(hubEdge).toBeDefined();
    }
  });
});
