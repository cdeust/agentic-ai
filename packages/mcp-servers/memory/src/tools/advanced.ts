/**
 * advanced.ts — MCP tool adapters for the advanced/automation topic.
 *
 * Tools registered (6):
 *   sync_instructions, create_trigger, add_rule, get_rules,
 *   assess_coverage, query_workflow_graph
 *
 * source: worktrees/port-inventory-cortex/inventory/MCP_TOOLS.md
 *         §Tier2Advanced, §Tier1Core (query_workflow_graph)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ── Error envelope helper ─────────────────────────────────────────────────────

function errorText(tool: string, err: unknown): { content: Array<{ type: "text"; text: string }> } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: `${tool}: ${message}` }) }] };
}

// ── registerAdvancedTools ─────────────────────────────────────────────────────

/**
 * Registers advanced automation and rule-engine MCP tools.
 *
 * source: MCP_TOOLS.md §"sync_instructions", §"create_trigger", §"add_rule",
 *         §"get_rules", §"assess_coverage", §"query_workflow_graph"
 */
export function registerAdvancedTools(server: McpServer): void {
  // ── sync_instructions ─────────────────────────────────────────────────────
  server.registerTool(
    "sync_instructions",
    {
      description:
        "Push top memory insights into CLAUDE.md (or similar instruction file).",
      inputSchema: {
        directory:    z.string().default("").describe("Directory containing CLAUDE.md"),
        max_insights: z.number().int().min(1).default(10).describe("Max insights to include"),
        min_heat:     z.number().min(0).max(1).default(0.3).describe("Min heat for insight inclusion"),
        dry_run:      z.boolean().default(false).describe("Preview without writing"),
      },
    },
    async (_args) => {
      try {
        const response = {
          synced:    0,
          file_path: null,
          preview:   [],
          note: "sync_instructions: MemoryStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("sync_instructions", err);
      }
    },
  );

  // ── create_trigger ────────────────────────────────────────────────────────
  server.registerTool(
    "create_trigger",
    {
      description:
        "Create a prospective memory trigger (stored in prospective_memories table).",
      inputSchema: {
        content:           z.string().min(1).describe("Trigger content"),
        trigger_condition: z.string().min(1).describe("Condition that fires the trigger"),
        trigger_type:      z.string().default("keyword").describe("Trigger type"),
        target_directory:  z.string().optional().describe("Directory scope for trigger"),
      },
    },
    async (_args) => {
      try {
        const response = {
          trigger_id: null,
          created:    false,
          note: "create_trigger: MemoryStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("create_trigger", err);
      }
    },
  );

  // ── add_rule ──────────────────────────────────────────────────────────────
  server.registerTool(
    "add_rule",
    {
      description: "Add a neuro-symbolic rule to the memory store.",
      inputSchema: {
        condition:   z.string().min(1).describe("Rule condition"),
        action:      z.string().min(1).describe("Rule action"),
        rule_type:   z.enum(["soft", "hard"]).default("soft").describe("Rule type"),
        scope:       z.enum(["global", "domain", "directory"]).default("global").describe("Rule scope"),
        scope_value: z.string().optional().describe("Scope value (domain name or directory)"),
        priority:    z.number().int().default(0).describe("Rule priority (higher = earlier)"),
      },
    },
    async (_args) => {
      try {
        const response = {
          rule_id: null,
          created: false,
          note: "add_rule: MemoryStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("add_rule", err);
      }
    },
  );

  // ── get_rules ─────────────────────────────────────────────────────────────
  server.registerTool(
    "get_rules",
    {
      description: "List active neuro-symbolic rules.",
      inputSchema: {
        scope:            z.string().optional().describe("Filter by scope"),
        rule_type:        z.string().optional().describe("Filter by type"),
        include_inactive: z.boolean().default(false).describe("Include inactive rules"),
      },
    },
    async (_args) => {
      try {
        const response = {
          rules: [],
          note: "get_rules: MemoryStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("get_rules", err);
      }
    },
  );

  // ── assess_coverage ───────────────────────────────────────────────────────
  server.registerTool(
    "assess_coverage",
    {
      description:
        "Evaluate knowledge coverage completeness for the current domain/directory.",
      inputSchema: {
        directory:  z.string().default("").describe("Directory scope"),
        domain:     z.string().default("").describe("Domain scope"),
        stale_days: z.number().int().min(1).default(14).describe("Days before a memory is stale"),
      },
    },
    async (_args) => {
      try {
        const response = {
          coverage_score: 0,
          gaps:           [],
          stale_count:    0,
          recommendations: [],
          note: "assess_coverage: MemoryStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("assess_coverage", err);
      }
    },
  );

  // ── query_workflow_graph ──────────────────────────────────────────────────
  server.registerTool(
    "query_workflow_graph",
    {
      description:
        "Return a typed subgraph of the unified workflow graph.",
      inputSchema: {
        node_kind:    z.union([z.string(), z.array(z.string())]).optional().describe("Node kind filter"),
        edge_kind:    z.union([z.string(), z.array(z.string())]).optional().describe("Edge kind filter"),
        neighbour_of: z.string().optional().describe("Node ID to find neighbours of"),
        depth:        z.number().int().optional().describe("Traversal depth"),
        domain:       z.string().optional().describe("Domain filter"),
        limit_nodes:  z.number().int().optional().describe("Max nodes to return"),
      },
    },
    async (_args) => {
      try {
        const response = {
          nodes: [],
          edges: [],
          stats: {},
          note: "query_workflow_graph: WorkflowGraphStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("query_workflow_graph", err);
      }
    },
  );
}
