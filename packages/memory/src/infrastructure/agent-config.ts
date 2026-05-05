/**
 * Agent registry — defines the team of functional agents and their Cortex
 * memory usage.
 *
 * Each agent is a Claude Code subagent defined in .claude/agents/*.md. They
 * use Cortex's MCP tools (recall, remember, etc.) as their knowledge base.
 * The registry maps each agent to the tools it uses, enabling the graph
 * builder to show agent nodes and tool ownership in the visualization.
 *
 * Key principle: recall before working, remember the why after — never
 * remember what's already in the code or git history.
 *
 * Pure configuration — no I/O.
 *
 * Layer: INFRASTRUCTURE (configuration data).
 * source: Cortex mcp_server/infrastructure/agent_config.py
 */

/** Agent registry entry. */
export interface AgentEntry {
  name: string;
  project: string;
  agent_file: string;
  topic: string;
  description: string;
  recalls: string[];
  remembers: string[];
  tools: string[];
}

// source: Cortex mcp_server/infrastructure/agent_config.py — AGENT_REGISTRY
export const AGENT_REGISTRY: AgentEntry[] = [
  // ── orchestrator ───────────────────────────────────────────────
  {
    name: "Orchestrator",
    project: "cortex",
    agent_file: "orchestrator.md",
    topic: "orchestrator",
    description:
      "Decomposes tasks, spawns specialized agents in parallel worktrees, coordinates and merges",
    recalls: [
      "recall",
      "recall_hierarchical",
      "get_causal_chain",
      "memory_stats",
      "detect_gaps",
      "get_project_story",
    ],
    remembers: ["remember", "anchor", "checkpoint", "consolidate", "narrative"],
    tools: [
      "recall",
      "recall_hierarchical",
      "get_causal_chain",
      "memory_stats",
      "detect_gaps",
      "get_project_story",
      "remember",
      "anchor",
      "checkpoint",
      "consolidate",
      "narrative",
    ],
  },
  // ── engineer ───────────────────────────────────────────────────
  {
    name: "Engineer",
    project: "cortex",
    agent_file: "engineer.md",
    topic: "engineer",
    description:
      "Clean Architecture, SOLID, root-cause problem solving — adapts to any language",
    recalls: ["recall", "get_causal_chain", "get_rules", "recall_hierarchical"],
    remembers: ["remember"],
    tools: [
      "recall",
      "get_causal_chain",
      "get_rules",
      "recall_hierarchical",
      "remember",
    ],
  },
  // ── tester ─────────────────────────────────────────────────────
  {
    name: "Tester",
    project: "cortex",
    agent_file: "tester.md",
    topic: "tester",
    description: "Test strategy, coverage analysis, fragile module detection",
    recalls: ["recall", "detect_gaps", "get_rules"],
    remembers: ["remember"],
    tools: ["recall", "detect_gaps", "get_rules", "remember"],
  },
  // ── reviewer ───────────────────────────────────────────────────
  {
    name: "Reviewer",
    project: "cortex",
    agent_file: "reviewer.md",
    topic: "reviewer",
    description: "Code review, ADR enforcement, accepted trade-off tracking",
    recalls: ["recall", "get_rules", "recall_hierarchical"],
    remembers: ["remember", "add_rule"],
    tools: ["recall", "get_rules", "recall_hierarchical", "remember", "add_rule"],
  },
  // ── ux ─────────────────────────────────────────────────────────
  {
    name: "UX",
    project: "cortex",
    agent_file: "ux.md",
    topic: "ux",
    description: "UX decisions, accessibility, design rationale, user constraints",
    recalls: ["recall", "recall_hierarchical"],
    remembers: ["remember"],
    tools: ["recall", "recall_hierarchical", "remember"],
  },
  // ── frontend ───────────────────────────────────────────────────
  {
    name: "Frontend",
    project: "cortex",
    agent_file: "frontend.md",
    topic: "frontend",
    description: "Component architecture, UX integration, frontend patterns",
    recalls: ["recall", "get_rules", "recall_hierarchical"],
    remembers: ["remember"],
    tools: ["recall", "get_rules", "recall_hierarchical", "remember"],
  },
  // ── security ───────────────────────────────────────────────────
  {
    name: "Security",
    project: "cortex",
    agent_file: "security.md",
    topic: "security",
    description:
      "Threat models, accepted risks, dependency audits, data flow analysis",
    recalls: ["recall", "get_causal_chain", "detect_gaps"],
    remembers: ["remember", "add_rule"],
    tools: ["recall", "get_causal_chain", "detect_gaps", "remember", "add_rule"],
  },
  // ── researcher ─────────────────────────────────────────────────
  {
    name: "Researcher",
    project: "cortex",
    agent_file: "researcher.md",
    topic: "researcher",
    description:
      "Paper reviews, benchmark analysis, competitive intelligence, negative results",
    recalls: ["recall", "recall_hierarchical", "detect_gaps", "assess_coverage"],
    remembers: ["remember"],
    tools: [
      "recall",
      "recall_hierarchical",
      "detect_gaps",
      "assess_coverage",
      "remember",
    ],
  },
  // ── dba ────────────────────────────────────────────────────────
  {
    name: "DBA",
    project: "cortex",
    agent_file: "dba.md",
    topic: "dba",
    description: "Schema decisions, query optimization, migration lessons",
    recalls: ["recall", "get_causal_chain", "get_rules"],
    remembers: ["remember"],
    tools: ["recall", "get_causal_chain", "get_rules", "remember"],
  },
  // ── devops ─────────────────────────────────────────────────────
  {
    name: "DevOps",
    project: "cortex",
    agent_file: "devops.md",
    topic: "devops",
    description: "Infrastructure decisions, incident postmortems, env parity",
    recalls: ["recall", "get_causal_chain", "recall_hierarchical"],
    remembers: ["remember"],
    tools: ["recall", "get_causal_chain", "recall_hierarchical", "remember"],
  },
  // ── architect ──────────────────────────────────────────────────
  {
    name: "Architect",
    project: "cortex",
    agent_file: "architect.md",
    topic: "architect",
    description:
      "ADRs, decomposition plans, refactoring strategy, project story",
    recalls: [
      "recall",
      "recall_hierarchical",
      "get_project_story",
      "get_causal_chain",
    ],
    remembers: ["remember", "anchor"],
    tools: [
      "recall",
      "recall_hierarchical",
      "get_project_story",
      "get_causal_chain",
      "remember",
      "anchor",
    ],
  },
];

// ── Lookup functions ─────────────────────────────────────────────────

/**
 * Return agents belonging to a project (case-insensitive match).
 *
 * source: Cortex mcp_server/infrastructure/agent_config.py:get_agents_for_project
 */
export function getAgentsForProject(projectKey: string): AgentEntry[] {
  const low = projectKey.toLowerCase();
  return AGENT_REGISTRY.filter((a) => a.project.toLowerCase() === low);
}

/**
 * Return all registered agents.
 *
 * source: Cortex mcp_server/infrastructure/agent_config.py:get_all_agents
 */
export function getAllAgents(): AgentEntry[] {
  return [...AGENT_REGISTRY];
}

/**
 * Return the set of all tool names owned by any agent.
 *
 * source: Cortex mcp_server/infrastructure/agent_config.py:get_all_tool_names
 */
export function getAllToolNames(): Set<string> {
  const tools = new Set<string>();
  for (const agent of AGENT_REGISTRY) {
    for (const tool of agent.tools) {
      tools.add(tool);
    }
  }
  return tools;
}

/**
 * Return the memory topic for an agent (case-insensitive).
 *
 * source: Cortex mcp_server/infrastructure/agent_config.py:get_agent_topic
 */
export function getAgentTopic(agentName: string): string {
  const low = agentName.toLowerCase();
  for (const a of AGENT_REGISTRY) {
    if (a.name.toLowerCase() === low) {
      return a.topic ?? low;
    }
  }
  return low;
}
