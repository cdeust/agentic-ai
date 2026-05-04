/**
 * recall.ts — MCP tool adapters for the recall topic.
 *
 * Pattern: Tool-as-Adapter — wraps @agentic/memory recall functions behind
 * the McpServer.registerTool boundary.
 *
 * Tools registered (4):
 *   recall, recall_hierarchical, navigate_memory, drill_down
 *
 * Phase 7 Group D — DI wiring:
 *   - recall: calls real recallHandler with MemoryStore + EmbeddingEngine.
 *   - recall_hierarchical: calls real recallHierarchicalHandler.
 *   - navigate_memory: calls real graph navigate handler via GraphPort.
 *   - drill_down: throws PortPendingError — blocked on fractal port.
 *     Blocker: mcp_server/core/fractal.py::drill_down not yet ported to TS.
 *
 * source: worktrees/port-inventory-cortex/inventory/MCP_TOOLS.md §Tier1Memory §Nav
 * source: packages/memory/src/recall/recall-handler.ts (recallHandler)
 * source: packages/memory/src/recall/recall-hierarchical-handler.ts
 * source: packages/memory/src/graph/handlers/navigate-memory.ts (handler)
 * source: cortex@ed33435 mcp_server/handlers/drill_down.py (deferred)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { recallHandler, DEFAULT_RECALL_SETTINGS } from "@agentic/memory/recall/recall-handler.js";
import { recallHierarchicalHandler } from "@agentic/memory/recall/recall-hierarchical-handler.js";
import type { MemoryStore, EmbeddingEngine } from "@agentic/memory/recall/port.js";
import { handler as navigateMemoryHandler } from "@agentic/memory/graph/handlers/navigate-memory.js";
import type { GraphPort } from "@agentic/memory/graph/port.js";

// ── Named constants ───────────────────────────────────────────────────────────
const RECALL_MAX_RESULTS_CAP = 100; // source: MCP_TOOLS.md §recall max_results cap=100
const RECALL_DEFAULT_RESULTS = 10; // source: MCP_TOOLS.md §recall default max_results=10
const RECALL_MIN_HEAT_DEFAULT = 0.05; // source: MCP_TOOLS.md §recall min_heat default=0.05
const RECALL_CLUSTER_THRESHOLD_DEFAULT = 0.6; // source: MCP_TOOLS.md §recall_hierarchical cluster_threshold default=0.6
const NAVIGATE_MAX_DEPTH_CAP = 5; // source: MCP_TOOLS.md §navigate_memory max_depth cap=5

// ── PortPendingError ──────────────────────────────────────────────────────────

class PortPendingError extends Error {
  constructor(handlerName: string, blocker: string) {
    super(`${handlerName} requires ${blocker} — not yet ported to TypeScript.`);
    this.name = "PortPendingError";
  }
}

// ── Dependency bundle ─────────────────────────────────────────────────────────

export interface RecallDeps {
  store: MemoryStore;
  embedder: EmbeddingEngine | null;
  graphPort: GraphPort;
}

// ── Error envelope helper ─────────────────────────────────────────────────────

function errorText(tool: string, err: unknown): { content: Array<{ type: "text"; text: string }> } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: `${tool}: ${message}` }) }] };
}

// ── registerRecallTools ───────────────────────────────────────────────────────

/**
 * Registers the 4 recall-topic MCP tools onto the given server instance.
 *
 * precondition:  deps.store is a live MemoryStore; deps.embedder may be null.
 * postcondition: 4 tools registered; recall/recall_hierarchical/navigate_memory
 *   call real handlers; drill_down throws PortPendingError with specific blocker.
 *
 * source: MCP_TOOLS.md §"recall", §"recall_hierarchical", §"navigate_memory",
 *         §"drill_down"
 */
export function registerRecallTools(server: McpServer, deps: RecallDeps): void {
  // ── recall ────────────────────────────────────────────────────────────────
  server.registerTool(
    "recall",
    {
      description: "Retrieve memories using multi-signal fusion (vector + BM25 + heat + spreading activation).",
      inputSchema: {
        query:       z.string().min(1).describe("Search query"),
        domain:      z.string().optional().describe("Domain filter"),
        directory:   z.string().optional().describe("Directory filter"),
        max_results: z.number().int().min(1).max(RECALL_MAX_RESULTS_CAP).default(RECALL_DEFAULT_RESULTS).describe("Max memories to return"), // source: MCP_TOOLS.md §recall max_results cap=100
        min_heat:    z.number().min(0).max(1).default(RECALL_MIN_HEAT_DEFAULT).describe("Minimum heat threshold"), // source: MCP_TOOLS.md §recall min_heat default=0.05
        agent_topic: z.string().optional().describe("Agent topic scope"),
      },
    },
    async (args) => {
      try {
        // source: packages/memory/src/recall/recall-handler.ts::recallHandler
        const response = await recallHandler(
          {
            query:       args.query,
            domain:      args.domain,
            directory:   args.directory,
            max_results: args.max_results,
            min_heat:    args.min_heat,
            agent_topic: args.agent_topic,
          },
          deps.store,
          deps.embedder,
          DEFAULT_RECALL_SETTINGS,
        );
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
      description: "Retrieve memories using fractal hierarchy — groups semantically similar results into clusters.",
      inputSchema: {
        query:             z.string().min(1).describe("Search query"),
        domain:            z.string().optional().describe("Domain filter"),
        max_results:       z.number().int().min(1).max(RECALL_MAX_RESULTS_CAP).default(RECALL_DEFAULT_RESULTS).describe("Max memories"), // source: MCP_TOOLS.md §recall_hierarchical max_results cap=100
        min_heat:          z.number().min(0).max(1).default(RECALL_MIN_HEAT_DEFAULT).describe("Minimum heat"), // source: MCP_TOOLS.md §recall_hierarchical min_heat default=0.05
        cluster_threshold: z.number().min(0).max(1).default(RECALL_CLUSTER_THRESHOLD_DEFAULT).describe("Cluster similarity threshold"),
      },
    },
    async (args) => {
      try {
        // source: packages/memory/src/recall/recall-hierarchical-handler.ts::recallHierarchicalHandler
        const response = await recallHierarchicalHandler(
          {
            query:             args.query,
            domain:            args.domain,
            max_results:       args.max_results,
            min_heat:          args.min_heat,
            cluster_threshold: args.cluster_threshold,
          },
          deps.store,
          deps.embedder,
          DEFAULT_RECALL_SETTINGS,
        );
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
      description: "Navigate memory space using Successor Representation — returns temporally and semantically adjacent memories.",
      inputSchema: {
        memory_id:      z.number().int().min(1).describe("Memory ID to navigate from"),
        max_depth:      z.number().int().min(1).max(NAVIGATE_MAX_DEPTH_CAP).default(2).describe("Traversal depth"),
        include_2d_map: z.boolean().default(false).describe("Include 2D spatial map"),
        window_hours:   z.number().min(0).default(2.0).describe("Temporal window in hours"),
      },
    },
    async (args) => {
      try {
        // source: packages/memory/src/graph/handlers/navigate-memory.ts::handler
        const response = await navigateMemoryHandler(
          {
            memory_id:      args.memory_id,
            max_depth:      args.max_depth,
            include_2d_map: args.include_2d_map,
            window_hours:   args.window_hours,
          },
          deps.graphPort,
        );
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
        // source: MCP_TOOLS.md §drill_down min_heat=0.05 default value
        min_heat:   z.number().min(0).max(1).default(RECALL_MIN_HEAT_DEFAULT).describe("Minimum heat"),
      },
    },
    async (_args) => {
      try {
        // source: cortex@ed33435 mcp_server/handlers/drill_down.py::_handler_impl
        // Blocked: requires mcp_server/core/fractal.py::drill_down — the fractal
        // cluster tree module is not yet ported to TypeScript.
        throw new PortPendingError(
          "drill_down",
          "mcp_server/core/fractal.py::drill_down — fractal cluster tree port not implemented",
        );
      } catch (err) {
        return errorText("drill_down", err);
      }
    },
  );
}
