/**
 * Tests for WorkflowGraphBuilder — synthetic JSONL-shaped fixtures only.
 * No file system access. No PG store.
 */

import { describe, expect, it } from "vitest";
import { WorkflowGraphBuilder } from "../../src/workflow-graph/builder.js";
import { emptyInputs } from "../../src/workflow-graph/inputs.js";
import { EdgeKind, NodeKind } from "../../src/workflow-graph/schema-enums.js";
import { NodeIdFactory } from "../../src/workflow-graph/schema.js";

function builder(): WorkflowGraphBuilder {
  return new WorkflowGraphBuilder();
}

describe("WorkflowGraphBuilder", () => {
  it("produces at minimum the global domain node", () => {
    const b = builder();
    const [nodes] = b.build(emptyInputs());
    const domain = nodes.find((n) => n.id === "domain:__global__");
    expect(domain).toBeDefined();
    expect(domain?.kind).toBe(NodeKind.DOMAIN);
  });

  it("ingests a tool event and creates hub + deferred file node", () => {
    const b = builder();
    const inputs = emptyInputs();
    inputs.tool_events = [
      { tool: "Read", file_path: "/src/a.ts", domain: "my-project", count: 3 },
    ];
    const [nodes, edges] = b.build(inputs);
    const fid = NodeIdFactory.fileId("/src/a.ts");
    const fileNode = nodes.find((n) => n.id === fid);
    expect(fileNode).toBeDefined();
    expect(fileNode?.kind).toBe(NodeKind.FILE);
    // Should have a TOOL_USED_FILE edge from a hub to the file node.
    const toolEdge = edges.find(
      (e) => e.target === fid && e.kind === EdgeKind.TOOL_USED_FILE,
    );
    expect(toolEdge).toBeDefined();
  });

  it("ingests a memory and creates a memory node", () => {
    const b = builder();
    const inputs = emptyInputs();
    inputs.memories = [
      {
        id: 42,
        domain: "my-project",
        consolidation_stage: "episodic",
        heat: 0.5,
        content: "This is a test memory",
      },
    ];
    const [nodes] = b.build(inputs);
    const memId = NodeIdFactory.memoryId(42);
    const memNode = nodes.find((n) => n.id === memId);
    expect(memNode).toBeDefined();
    expect(memNode?.kind).toBe(NodeKind.MEMORY);
    expect(memNode?.label).toBe("This is a test memory");
  });

  it("ingests a discussion and creates a discussion node", () => {
    const b = builder();
    const inputs = emptyInputs();
    inputs.discussions = [
      {
        session_id: "abc123",
        domain: "my-project",
        title: "Port workflow graph",
        message_count: 10,
      },
    ];
    const [nodes] = b.build(inputs);
    const discNode = nodes.find((n) => n.id === "discussion:abc123");
    expect(discNode).toBeDefined();
    expect(discNode?.kind).toBe(NodeKind.DISCUSSION);
  });

  it("ingests skill and creates INVOKED_SKILL edges", () => {
    const b = builder();
    const inputs = emptyInputs();
    inputs.skill_paths = [
      { name: "recall", path: "/skills/recall.md", domains: [] },
    ];
    const [nodes, edges] = b.build(inputs);
    const skillId = NodeIdFactory.skillId("recall");
    const skillNode = nodes.find((n) => n.id === skillId);
    expect(skillNode).toBeDefined();
    const skillEdge = edges.find(
      (e) => e.target === skillId && e.kind === EdgeKind.INVOKED_SKILL,
    );
    expect(skillEdge).toBeDefined();
  });

  it("ingests an agent and creates a Task hub + agent node + SPAWNED_AGENT edge", () => {
    const b = builder();
    const inputs = emptyInputs();
    inputs.agent_events = [
      { subagent_type: "researcher", domain: "my-project", count: 2 },
    ];
    const [nodes, edges] = b.build(inputs);
    const agentId = NodeIdFactory.agentId("domain:my-project", "researcher");
    const agentNode = nodes.find((n) => n.id === agentId);
    // domain:my-project won't be created because "my-project" has no hyphen
    // → it's bucketed to global by assignDomain. Test the actual id used.
    // The builder's assignDomain maps "my-project" to domain:my-project
    // because it contains a hyphen.
    expect(agentNode).toBeDefined();
    const spawnEdge = edges.find(
      (e) => e.target === agentId && e.kind === EdgeKind.SPAWNED_AGENT,
    );
    expect(spawnEdge).toBeDefined();
  });

  it("deduplicates edges summing weights", () => {
    const b = builder();
    const inputs = emptyInputs();
    // Same tool + file + domain twice → one edge with weight 2.
    inputs.tool_events = [
      { tool: "Read", file_path: "/src/a.ts", domain: "my-project", count: 1 },
      { tool: "Read", file_path: "/src/a.ts", domain: "my-project", count: 1 },
    ];
    const [, edges] = b.build(inputs);
    const fid = NodeIdFactory.fileId("/src/a.ts");
    const toolEdges = edges.filter(
      (e) => e.target === fid && e.kind === EdgeKind.TOOL_USED_FILE,
    );
    // After dedup there should be exactly one edge.
    expect(toolEdges).toHaveLength(1);
    expect(toolEdges[0]?.weight).toBe(2);
  });

  it("INVOKED_SKILL from two different domains produces two edges (fan-out preserved)", () => {
    /**
     * Cycle-handling test: INVOKED_SKILL edges from domain:a→skill:x and
     * domain:b→skill:x have different src values so they survive dedup.
     * This is the multi-domain fan-out that makes the skill ring work.
     */
    const b = builder();
    const inputs = emptyInputs();
    inputs.skill_paths = [
      {
        name: "recall",
        path: "/skills/recall.md",
        domains: ["domain-a", "domain-b"],
      },
    ];
    const [, edges] = b.build(inputs);
    const skillId = NodeIdFactory.skillId("recall");
    const invokeEdges = edges.filter(
      (e) => e.target === skillId && e.kind === EdgeKind.INVOKED_SKILL,
    );
    // One INVOKED_SKILL edge per domain.
    expect(invokeEdges.length).toBeGreaterThanOrEqual(2);
  });

  it("ingests a hook and creates TRIGGERED_HOOK edge", () => {
    const b = builder();
    const inputs = emptyInputs();
    inputs.hook_defs = [
      { event: "PostToolUse", command: "/usr/bin/cortex-hook", domain: null },
    ];
    const [nodes, edges] = b.build(inputs);
    const hookNode = nodes.find((n) => n.kind === NodeKind.HOOK);
    expect(hookNode).toBeDefined();
    const hookEdge = edges.find(
      (e) => e.target === hookNode?.id && e.kind === EdgeKind.TRIGGERED_HOOK,
    );
    expect(hookEdge).toBeDefined();
  });

  it("file node color follows primary-tool meta-rule (Edit > Read)", () => {
    const b = builder();
    const inputs = emptyInputs();
    inputs.tool_events = [
      { tool: "Read", file_path: "/src/a.ts", domain: "my-project", count: 5 },
      { tool: "Edit", file_path: "/src/a.ts", domain: "my-project", count: 1 },
    ];
    const [nodes] = b.build(inputs);
    const fid = NodeIdFactory.fileId("/src/a.ts");
    const fileNode = nodes.find((n) => n.id === fid);
    // Edit wins over Read → emerald #10B981
    expect(fileNode?.color).toBe("#10B981");
  });
});
