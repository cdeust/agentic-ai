/**
 * navigation.ts — MCP tool adapters for the graph navigation topic.
 *
 * Tools registered (2):
 *   get_causal_chain, detect_gaps
 *
 * source: worktrees/port-inventory-cortex/inventory/MCP_TOOLS.md §Tier2Nav
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ── Error envelope helper ─────────────────────────────────────────────────────

function errorText(tool: string, err: unknown): { content: Array<{ type: "text"; text: string }> } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: `${tool}: ${message}` }) }] };
}

// ── registerNavigationTools ───────────────────────────────────────────────────

/**
 * Registers graph navigation MCP tools.
 *
 * source: MCP_TOOLS.md §"get_causal_chain", §"detect_gaps"
 */
export function registerNavigationTools(server: McpServer): void {
  // ── get_causal_chain ──────────────────────────────────────────────────────
  server.registerTool(
    "get_causal_chain",
    {
      description:
        "Trace entity relationships through the knowledge graph.",
      inputSchema: {
        entity_name:        z.string().optional().describe("Entity name to start from"),
        memory_id:          z.number().int().optional().describe("Memory ID to start from"),
        relationship_types: z.array(z.string()).optional().describe("Relationship types to traverse"),
        max_depth:          z.number().int().min(1).max(10).default(3).describe("Max traversal depth"),
        direction:          z.enum(["incoming", "outgoing", "both"]).default("both").describe("Traversal direction"),
      },
    },
    async (_args) => {
      try {
        const response = {
          chain:         [],
          relationships: [],
          root_entity:   null,
          note: "get_causal_chain: GraphStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("get_causal_chain", err);
      }
    },
  );

  // ── detect_gaps ───────────────────────────────────────────────────────────
  server.registerTool(
    "detect_gaps",
    {
      description:
        "Identify knowledge gaps in the memory store (entity gaps, domain gaps, temporal gaps).",
      inputSchema: {
        domain:                z.string().optional().describe("Domain scope"),
        include_entity_gaps:   z.boolean().default(true).describe("Include entity coverage gaps"),
        include_domain_gaps:   z.boolean().default(true).describe("Include domain coverage gaps"),
        include_temporal_gaps: z.boolean().default(true).describe("Include temporal coverage gaps"),
        // source: MCP_TOOLS.md §detect_gaps default stale_threshold_days=30
        stale_threshold_days:  z.number().int().min(1).default(30).describe("Days before considered stale"),
      },
    },
    async (_args) => {
      try {
        const response = {
          entity_gaps:     [],
          domain_gaps:     [],
          temporal_gaps:   [],
          recommendations: [],
          note: "detect_gaps: MemoryStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("detect_gaps", err);
      }
    },
  );
}
