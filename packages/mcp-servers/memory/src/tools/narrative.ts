/**
 * narrative.ts — MCP tool adapters for the narrative + story topic.
 *
 * Tools registered (3):
 *   narrative, get_project_story, unified_search
 *
 * source: worktrees/port-inventory-cortex/inventory/MCP_TOOLS.md
 *         §Tier1Memory (narrative), §Tier2Advanced (get_project_story),
 *         §Tier1Memory (unified_search)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ── Error envelope helper ─────────────────────────────────────────────────────

function errorText(tool: string, err: unknown): { content: Array<{ type: "text"; text: string }> } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: `${tool}: ${message}` }) }] };
}

// ── registerNarrativeTools ────────────────────────────────────────────────────

/**
 * Registers narrative and search MCP tools.
 *
 * source: MCP_TOOLS.md §"narrative", §"get_project_story", §"unified_search"
 */
export function registerNarrativeTools(server: McpServer): void {
  // ── narrative ─────────────────────────────────────────────────────────────
  server.registerTool(
    "narrative",
    {
      description:
        "Generate project narrative from stored memories (structured summary).",
      inputSchema: {
        directory: z.string().optional().describe("Directory scope"),
        domain:    z.string().optional().describe("Domain scope"),
        brief:     z.boolean().default(false).describe("Brief mode (condensed output)"),
      },
    },
    async (_args) => {
      try {
        // source: packages/memory/src/narrative/handlers/
        return {
          content: [{
            type: "text" as const,
            text: "# Project Narrative\n\n_narrative: MemoryStore adapter not yet injected (Phase 5 stub)_",
          }],
        };
      } catch (err) {
        return errorText("narrative", err);
      }
    },
  );

  // ── get_project_story ─────────────────────────────────────────────────────
  server.registerTool(
    "get_project_story",
    {
      description:
        "Generate a period-based autobiographical narrative (week/month/all).",
      inputSchema: {
        directory:    z.string().optional().describe("Directory scope"),
        domain:       z.string().optional().describe("Domain scope"),
        period:       z.enum(["day", "week", "month", "all"]).default("week").describe("Time period"),
        max_chapters: z.number().int().min(1).max(20).default(5).describe("Max chapters"),
      },
    },
    async (args) => {
      try {
        return {
          content: [{
            type: "text" as const,
            text: `# Project Story (${args.period})\n\n_get_project_story: MemoryStore adapter not yet injected (Phase 5 stub)_`,
          }],
        };
      } catch (err) {
        return errorText("get_project_story", err);
      }
    },
  );

  // ── unified_search ────────────────────────────────────────────────────────
  server.registerTool(
    "unified_search",
    {
      description:
        "RRF-fuse Cortex memory recall with AP code search (ADR-0046 P3).",
      inputSchema: {
        query:       z.string().min(1).describe("Search query"),
        domain:      z.string().optional().describe("Domain filter"),
        max_results: z.number().int().min(1).max(50).default(10).describe("Max results"),
        // source: Reciprocal Rank Fusion k=60 — MCP_TOOLS.md §unified_search
        // canonical value from Cormack & Clarke (2009) "Reciprocal Rank Fusion".
        k:           z.number().int().min(1).default(60).describe("RRF k parameter"),
      },
    },
    async (args) => {
      try {
        const response = {
          results: [],
          query:   args.query,
          note: "unified_search: MemoryStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("unified_search", err);
      }
    },
  );
}
