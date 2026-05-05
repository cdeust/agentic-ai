/**
 * Unit tests for infrastructure/agent-config.ts
 *
 * Invariants:
 *   - AGENT_REGISTRY has 11 entries (matching Python source)
 *   - getAgentsForProject("cortex") returns all agents
 *   - getAllToolNames() is a superset of each agent's tool list
 *   - getAgentTopic() is case-insensitive
 *
 * source: Cortex mcp_server/infrastructure/agent_config.py
 */

import { describe, it, expect } from "vitest";
import {
  AGENT_REGISTRY,
  getAgentsForProject,
  getAllAgents,
  getAllToolNames,
  getAgentTopic,
} from "../../src/infrastructure/agent-config.js";

describe("AGENT_REGISTRY", () => {
  it("has exactly 11 entries (parity with Python source)", () => {
    // source: Cortex mcp_server/infrastructure/agent_config.py — 11 agents defined
    expect(AGENT_REGISTRY).toHaveLength(11);
  });

  it("every entry has required fields", () => {
    for (const a of AGENT_REGISTRY) {
      expect(typeof a.name).toBe("string");
      expect(typeof a.project).toBe("string");
      expect(typeof a.topic).toBe("string");
      expect(Array.isArray(a.tools)).toBe(true);
      expect(Array.isArray(a.recalls)).toBe(true);
      expect(Array.isArray(a.remembers)).toBe(true);
    }
  });
});

describe("getAgentsForProject", () => {
  it("returns all 11 agents for project cortex", () => {
    expect(getAgentsForProject("cortex")).toHaveLength(11);
  });

  it("is case-insensitive", () => {
    expect(getAgentsForProject("CORTEX")).toHaveLength(11);
  });

  it("returns empty array for unknown project", () => {
    expect(getAgentsForProject("unknown-xyz")).toHaveLength(0);
  });
});

describe("getAllAgents", () => {
  it("returns a copy — mutations do not affect the registry", () => {
    const copy = getAllAgents();
    copy.splice(0, copy.length);
    expect(AGENT_REGISTRY).toHaveLength(11);
  });
});

describe("getAllToolNames", () => {
  it("contains recall (used by every agent)", () => {
    expect(getAllToolNames().has("recall")).toBe(true);
  });

  it("contains remember (used by every agent)", () => {
    expect(getAllToolNames().has("remember")).toBe(true);
  });

  it("is a superset of each agent's tool list", () => {
    const all = getAllToolNames();
    for (const agent of AGENT_REGISTRY) {
      for (const tool of agent.tools) {
        expect(all.has(tool)).toBe(true);
      }
    }
  });
});

describe("getAgentTopic", () => {
  it("returns the topic for a known agent", () => {
    expect(getAgentTopic("Orchestrator")).toBe("orchestrator");
  });

  it("is case-insensitive", () => {
    expect(getAgentTopic("ENGINEER")).toBe("engineer");
  });

  it("returns lowercased name for unknown agent", () => {
    expect(getAgentTopic("Unknown")).toBe("unknown");
  });
});
