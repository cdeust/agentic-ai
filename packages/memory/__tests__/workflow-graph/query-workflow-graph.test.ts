/**
 * Tests for queryWorkflowGraph — BFS neighbourhood, edge/node filtering,
 * cap logic. Uses in-memory graph fixtures; no builder dependency.
 */

import { describe, expect, it } from "vitest";
import {
  applyFilters,
  queryWorkflowGraph,
} from "../../src/workflow-graph/handlers/query-workflow-graph.js";
import type { WorkflowGraphPayload } from "../../src/workflow-graph/handlers/workflow-graph.js";

// ── Fixture ───────────────────────────────────────────────────────────────

function minimalGraph(): WorkflowGraphPayload {
  return {
    nodes: [
      { id: "domain:test", kind: "domain", size: 5.0 },
      { id: "memory:1", kind: "memory", size: 1.5, heat: 0.8 },
      { id: "memory:2", kind: "memory", size: 1.2, heat: 0.3 },
      { id: "file:abc", kind: "file", size: 1.0, heat: 0.1 },
    ],
    edges: [
      { source: "memory:1", target: "domain:test", kind: "in_domain", weight: 1.0 },
      { source: "memory:2", target: "domain:test", kind: "in_domain", weight: 1.0 },
      { source: "file:abc", target: "domain:test", kind: "in_domain", weight: 1.0 },
      {
        source: "memory:1",
        target: "file:abc",
        kind: "tool_used_file",
        weight: 2.0,
      },
    ],
    links: [],
    meta: { schema: "workflow_graph.v1" },
  };
}

describe("queryWorkflowGraph", () => {
  it("returns the full graph with no filters", () => {
    const g = minimalGraph();
    const result = queryWorkflowGraph(g, {});
    expect(result.nodes).toHaveLength(4);
    expect(result.edges).toHaveLength(4);
    expect(result.meta["filtered"]).toBe(true);
  });

  it("filters nodes by kind", () => {
    const g = minimalGraph();
    const result = queryWorkflowGraph(g, { node_kind: "memory" });
    const kinds = result.nodes.map((n) => n["kind"]);
    expect(kinds.every((k) => k === "memory")).toBe(true);
    // Edges referencing domain:test or file:abc should be pruned.
    for (const e of result.edges) {
      const nodeIds = new Set(result.nodes.map((n) => String(n["id"])));
      expect(nodeIds.has(String(e["source"]))).toBe(true);
      expect(nodeIds.has(String(e["target"]))).toBe(true);
    }
  });

  it("filters edges by kind", () => {
    const g = minimalGraph();
    const result = queryWorkflowGraph(g, { edge_kind: "in_domain" });
    expect(result.edges.every((e) => e["kind"] === "in_domain")).toBe(true);
  });

  it("BFS depth=1 around a node returns direct neighbours only", () => {
    const g = minimalGraph();
    const result = queryWorkflowGraph(g, {
      neighbour_of: "memory:1",
      depth: 1,
    });
    const ids = new Set(result.nodes.map((n) => String(n["id"])));
    expect(ids.has("memory:1")).toBe(true);
    expect(ids.has("domain:test")).toBe(true); // 1 hop via in_domain
    expect(ids.has("file:abc")).toBe(true); // 1 hop via tool_used_file
    // memory:2 is NOT reachable in 1 hop from memory:1.
    expect(ids.has("memory:2")).toBe(false);
  });

  it("BFS depth=2 includes two-hop neighbours", () => {
    const g = minimalGraph();
    // Add a chain: memory:1 → file:abc → file:xyz
    g.nodes.push({ id: "file:xyz", kind: "file", size: 1.0, heat: 0.05 });
    g.edges.push({
      source: "file:xyz",
      target: "domain:test",
      kind: "in_domain",
      weight: 1.0,
    });
    g.edges.push({
      source: "file:abc",
      target: "file:xyz",
      kind: "tool_used_file",
      weight: 1.0,
    });
    const result = queryWorkflowGraph(g, {
      neighbour_of: "memory:1",
      depth: 2,
    });
    const ids = new Set(result.nodes.map((n) => String(n["id"])));
    expect(ids.has("file:xyz")).toBe(true); // 2 hops
  });

  it("limit_nodes caps results and reports truncated_nodes in meta", () => {
    const g = minimalGraph();
    const result = queryWorkflowGraph(g, { limit_nodes: 2 });
    expect(result.nodes.length).toBeLessThanOrEqual(2);
    expect(result.meta["truncated_nodes"]).toBeGreaterThan(0);
  });

  it("depth is clamped to 1–2", () => {
    const g = minimalGraph();
    // depth=5 should be clamped to 2; should not throw.
    expect(() =>
      queryWorkflowGraph(g, { neighbour_of: "memory:1", depth: 5 }),
    ).not.toThrow();
  });

  it("filters meta includes applied filters", () => {
    const g = minimalGraph();
    const result = queryWorkflowGraph(g, {
      node_kind: ["memory", "file"],
      edge_kind: "tool_used_file",
    });
    const filter = result.meta["filter"] as Record<string, unknown>;
    expect(Array.isArray(filter["node_kind"])).toBe(true);
    expect((filter["node_kind"] as string[]).sort()).toEqual(["file", "memory"]);
    expect(filter["edge_kind"]).toEqual(["tool_used_file"]);
  });
});

describe("applyFilters edge cases", () => {
  it("unknown neighbour_of seed returns empty graph", () => {
    const g = minimalGraph();
    const result = applyFilters(g, {
      nodeKinds: null,
      edgeKinds: null,
      neighbourOf: "domain:nonexistent",
      depth: 1,
      limitNodes: 500,
    });
    // Only the seed node (if it doesn't exist, BFS finds nothing).
    expect(result.nodes).toHaveLength(0);
  });
});
