/**
 * Tests for the workflow graph schema: NodeIdFactory, edgeProvenanceDefaults,
 * validateGraph invariants.
 */

import { describe, expect, it } from "vitest";
import {
  GraphValidationError,
  NodeIdFactory,
  GLOBAL_DOMAIN_ID,
  edgeProvenanceDefaults,
  validateGraph,
  type WorkflowEdge,
  type WorkflowNode,
} from "../../src/workflow-graph/schema.js";
import { EdgeKind, NodeKind, ToolKind } from "../../src/workflow-graph/schema-enums.js";

describe("NodeIdFactory", () => {
  it("domainId returns prefixed id", () => {
    expect(NodeIdFactory.domainId("cortex")).toBe("domain:cortex");
  });

  it("domainId returns GLOBAL_DOMAIN_ID for null", () => {
    expect(NodeIdFactory.domainId(null)).toBe(GLOBAL_DOMAIN_ID);
    expect(NodeIdFactory.domainId(undefined)).toBe(GLOBAL_DOMAIN_ID);
    expect(NodeIdFactory.domainId("")).toBe(GLOBAL_DOMAIN_ID);
  });

  it("fileId is deterministic and prefixed", () => {
    const id1 = NodeIdFactory.fileId("/abs/path/file.ts");
    const id2 = NodeIdFactory.fileId("/abs/path/file.ts");
    expect(id1).toBe(id2);
    expect(id1.startsWith("file:")).toBe(true);
  });

  it("fileId differs for different paths", () => {
    expect(NodeIdFactory.fileId("/a/b.ts")).not.toBe(NodeIdFactory.fileId("/a/c.ts"));
  });

  it("skillId strips leading slash", () => {
    expect(NodeIdFactory.skillId("/recall")).toBe("skill:recall");
    expect(NodeIdFactory.skillId("recall")).toBe("skill:recall");
  });

  it("toolHubId encodes domain and tool", () => {
    expect(NodeIdFactory.toolHubId("domain:cortex", ToolKind.BASH)).toBe(
      "tool_hub:domain:cortex:Bash",
    );
  });

  it("symbolId includes file + qname hash", () => {
    const id = NodeIdFactory.symbolId("/src/a.ts", "Foo.bar");
    expect(id.startsWith("symbol:")).toBe(true);
    expect(id.length).toBeGreaterThan(10);
    // Different qname → different id.
    expect(id).not.toBe(NodeIdFactory.symbolId("/src/a.ts", "Foo.baz"));
  });
});

describe("edgeProvenanceDefaults", () => {
  it("returns structural defaults for defined_in", () => {
    const [conf, reason] = edgeProvenanceDefaults(EdgeKind.DEFINED_IN);
    expect(conf).toBe(1.0);
    expect(reason).toBe("direct-ast");
  });

  it("returns null for heuristic edge kinds", () => {
    const [conf, reason] = edgeProvenanceDefaults(EdgeKind.CALLS);
    expect(conf).toBeNull();
    expect(reason).toBeNull();
  });

  it("caller-supplied values win over defaults", () => {
    const [conf, reason] = edgeProvenanceDefaults(EdgeKind.DEFINED_IN, 0.8, "import-scope");
    expect(conf).toBe(0.8);
    expect(reason).toBe("import-scope");
  });

  it("empty-string reason normalises to null", () => {
    const [, reason] = edgeProvenanceDefaults(EdgeKind.CALLS, null, "");
    expect(reason).toBeNull();
  });
});

// ── Minimal valid graph fixture ──────────────────────────────────────────

function domainNode(id: string): WorkflowNode {
  return {
    id,
    kind: NodeKind.DOMAIN,
    label: id.slice(7),
    color: "#FCD34D",
    domain_id: id,
    size: 5.0,
    extra_domain_ids: [],
    tags: [],
  };
}

function memoryNode(id: string, domainId: string): WorkflowNode {
  return {
    id,
    kind: NodeKind.MEMORY,
    label: "test memory",
    color: "#4ADE80",
    domain_id: domainId,
    size: 1.5,
    extra_domain_ids: [],
    tags: [],
  };
}

function inDomainEdge(source: string, target: string): WorkflowEdge {
  return { source, target, kind: EdgeKind.IN_DOMAIN, weight: 1.0 };
}

describe("validateGraph", () => {
  it("accepts a minimal valid graph (domain + memory + in_domain edge)", () => {
    const dom = domainNode("domain:test");
    const mem = memoryNode("memory:1", "domain:test");
    const edge = inDomainEdge("memory:1", "domain:test");
    expect(() => validateGraph([dom, mem], [edge])).not.toThrow();
  });

  it("throws GraphValidationError on duplicate node ids", () => {
    const dom = domainNode("domain:test");
    const mem1 = memoryNode("memory:1", "domain:test");
    const mem2 = { ...mem1 };
    expect(() =>
      validateGraph([dom, mem1, mem2], [inDomainEdge("memory:1", "domain:test")]),
    ).toThrow(GraphValidationError);
  });

  it("throws on missing edge source", () => {
    const dom = domainNode("domain:test");
    const edge = inDomainEdge("memory:999", "domain:test");
    expect(() => validateGraph([dom], [edge])).toThrow(GraphValidationError);
  });

  it("throws on missing in_domain edge for non-domain node", () => {
    const dom = domainNode("domain:test");
    const mem = memoryNode("memory:1", "domain:test");
    // No in_domain edge.
    expect(() => validateGraph([dom, mem], [])).toThrow(GraphValidationError);
  });

  it("throws on symbol node with no defined_in edge", () => {
    const dom = domainNode("domain:test");
    const file: WorkflowNode = {
      id: "file:abc123",
      kind: NodeKind.FILE,
      label: "a.ts",
      color: "#06B6D4",
      domain_id: "domain:test",
      size: 1.5,
      extra_domain_ids: [],
      tags: [],
    };
    const sym: WorkflowNode = {
      id: "symbol:abc123456789",
      kind: NodeKind.SYMBOL,
      label: "Foo",
      color: "#22D3EE",
      domain_id: "domain:test",
      size: 0.9,
      extra_domain_ids: [],
      tags: [],
    };
    const fileInDomain = inDomainEdge("file:abc123", "domain:test");
    // Symbol exists but no defined_in edge → should fail.
    expect(() =>
      validateGraph([dom, file, sym], [fileInDomain]),
    ).toThrow(GraphValidationError);
  });

  it("accepts symbol node with defined_in edge to file", () => {
    const dom = domainNode("domain:test");
    const fid = NodeIdFactory.fileId("/src/a.ts");
    const sid = NodeIdFactory.symbolId("/src/a.ts", "Foo");
    const file: WorkflowNode = {
      id: fid,
      kind: NodeKind.FILE,
      label: "a.ts",
      color: "#06B6D4",
      domain_id: "domain:test",
      size: 1.5,
      extra_domain_ids: [],
      tags: [],
    };
    const sym: WorkflowNode = {
      id: sid,
      kind: NodeKind.SYMBOL,
      label: "Foo",
      color: "#22D3EE",
      domain_id: "domain:test",
      size: 0.9,
      extra_domain_ids: [],
      tags: [],
    };
    const edges: WorkflowEdge[] = [
      inDomainEdge(fid, "domain:test"),
      { source: sid, target: fid, kind: EdgeKind.DEFINED_IN, weight: 1.0 },
    ];
    expect(() => validateGraph([dom, file, sym], edges)).not.toThrow();
  });
});
