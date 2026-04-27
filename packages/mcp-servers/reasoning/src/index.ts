/**
 * @agentic/mcp-server-reasoning — Composition root stub.
 *
 * STATUS: port-pending
 *
 * PATTERN: Stub-First Composition Root (see docs/PATTERNS.md)
 *
 * This package exposes the zetetic genius/team agent dispatcher as an MCP
 * server. Each "genius" (Alexander, Dijkstra, Knuth, etc.) is a named
 * reasoning agent with a canonical prompt identity. The MCP server will
 * expose a dispatch tool that routes a reasoning request to the appropriate
 * genius agent.
 *
 * The actual prompts are inventoried in:
 *   worktrees/port-inventory-zetetic/
 *
 * Phase 5 lands this stub so the workspace topology is stable.
 * A dedicated worktree (port/reasoning-server or Phase 6) will:
 *   1. Import the @agentic/reasoning package (to be created from zetetic-team-subagents).
 *   2. Register MCP tools: dispatch_genius, list_geniuses, run_panel.
 *   3. Wire the Anthropic SDK for sub-agent invocation.
 *
 * source: worktrees/port-inventory-zetetic/ — prompt inventory
 * source: docs/PHASE_PLAN.md §Phase2 (zetetic-team-subagents migration)
 */

// Stub export — satisfies TypeScript's "no empty module" requirement.
export const PORT_STATUS = "pending" as const;
