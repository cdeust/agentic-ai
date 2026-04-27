/**
 * recall.ts — MCP tool adapters for the recall topic.
 *
 * Pattern: Tool-as-Adapter — wraps @agentic/memory recall functions behind
 * the McpServer.registerTool boundary. Validates input via Zod (matching the
 * Python source parameter names exactly per MCP_TOOLS.md parity constraint),
 * calls the domain function, and returns a text envelope.
 *
 * Tools registered (4):
 *   recall, recall_hierarchical, navigate_memory, drill_down
 *
 * source: worktrees/port-inventory-cortex/inventory/MCP_TOOLS.md §Tier1Memory §Nav
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ── Error envelope helper ─────────────────────────────────────────────────────

function errorText(tool: string, err: unknown): { content: Array<{ type: "text"; text: string }> } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: `${tool}: ${message}` }) }] };
}

// ── registerRecallTools ───────────────────────────────────────────────────────

/**
 * Registers the 4 recall-topic MCP tools onto the given server instance.
 *
 * Called once from src/index.ts during server startup. The server parameter
 * is the composition root's McpServer — no state is held here.
 *
 * source: MCP_TOOLS.md §"recall", §"recall_hierarchical", §"navigate_memory",
 *         §"drill_down"
 */
export function registerRecallTools(server: McpServer): void {
  // ── recall ────────────────────────────────────────────────────────────────
  server.registerTool(
    "recall",
    {
      description:
        "Retrieve memories using multi-signal fusion (vector + BM25 + heat + spreading activation).",
      inputSchema: {
        query:       z.string().min(1).describe("Search query"),
        domain:      z.string().optional().describe("Domain filter"),
        directory:   z.string().optional().describe("Directory filter"),
        max_results: z.number().int().min(1).max(100).default(10).describe("Max memories to return"),
        min_heat:    z.number().min(0).max(1).default(0.05).describe("Minimum heat threshold"),
        agent_topic: z.string().optional().describe("Agent topic scope"),
      },
    },
    async (args) => {
      try {
        // Stub: @agentic/memory recall handler requires a MemoryStore port.
        // The full wiring happens when the SQLite/PG adapter is injected.
        // source: packages/memory/src/recall/recall-handler.ts::recallHandler
        const response = {
          memories: [],
          query: args.query,
          note: "recall: MemoryStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("recall", err);
      }
    },
  );

  // ── recall_hierarchical ───────────────────────────────────────────────────
  server.registerTool(
    "recall_hierarchical",
    {
      description:
        "Retrieve memories using fractal hierarchy — groups semantically similar results into clusters.",
      inputSchema: {
        query:             z.string().min(1).describe("Search query"),
        domain:            z.string().optional().describe("Domain filter"),
        max_results:       z.number().int().min(1).max(100).default(10).describe("Max memories"),
        min_heat:          z.number().min(0).max(1).default(0.05).describe("Minimum heat"),
        cluster_threshold: z.number().min(0).max(1).default(0.6).describe("Cluster similarity threshold"),
      },
    },
    async (args) => {
      try {
        const response = {
          clusters: [],
          query: args.query,
          note: "recall_hierarchical: MemoryStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("recall_hierarchical", err);
      }
    },
  );

  // ── navigate_memory ───────────────────────────────────────────────────────
  server.registerTool(
    "navigate_memory",
    {
      description:
        "Navigate memory space using Successor Representation — returns temporally and semantically adjacent memories.",
      inputSchema: {
        memory_id:      z.number().int().min(1).describe("Memory ID to navigate from"),
        max_depth:      z.number().int().min(1).max(5).default(2).describe("Traversal depth"),
        include_2d_map: z.boolean().default(false).describe("Include 2D spatial map"),
        window_hours:   z.number().min(0).default(2.0).describe("Temporal window in hours"),
      },
    },
    async (args) => {
      try {
        const response = {
          memory: null,
          adjacent: [],
          predecessors: [],
          successors: [],
          memory_id: args.memory_id,
          note: "navigate_memory: MemoryStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("navigate_memory", err);
      }
    },
  );

  // ── drill_down ────────────────────────────────────────────────────────────
  server.registerTool(
    "drill_down",
    {
      description: "Navigate into a fractal memory cluster by cluster_id.",
      inputSchema: {
        cluster_id: z.string().min(1).describe("Cluster ID to navigate into"),
        domain:     z.string().optional().describe("Domain filter"),
        min_heat:   z.number().min(0).max(1).default(0.05).describe("Minimum heat"),
      },
    },
    async (args) => {
      try {
        const response = {
          cluster_id:  args.cluster_id,
          memories:    [],
          sub_clusters: [],
          note: "drill_down: MemoryStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("drill_down", err);
      }
    },
  );
}
