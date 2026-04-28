/**
 * narrative.ts — MCP tool adapters for the narrative + story topic.
 *
 * Tools registered (3):
 *   narrative, get_project_story, unified_search
 *
 * Phase 7 Group C: LlmClient is now accepted as an optional dependency.
 * The MemoryStore adapter is still a Phase 5 stub; the LLM client enables
 * the prose-polish pass once both are wired.
 *
 * source: worktrees/port-inventory-cortex/inventory/MCP_TOOLS.md
 *         §Tier1Memory (narrative), §Tier2Advanced (get_project_story),
 *         §Tier1Memory (unified_search)
 */

import type { LlmClient } from "@agentic/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ── Named constants for schema parameters ──────────────────────────────────

// source: MCP_TOOLS.md §"get_project_story" — max_chapters constraint
const MAX_CHAPTERS_MAX = 20;
const MAX_CHAPTERS_DEFAULT = 5;

// source: MCP_TOOLS.md §"unified_search" — max_results constraint
const MAX_RESULTS_MAX = 50;
const MAX_RESULTS_DEFAULT = 10;

// source: Cormack & Clarke (2009) "Reciprocal Rank Fusion" — k=60
// canonical value from MCP_TOOLS.md §unified_search
const RRF_K_DEFAULT = 60;

// ── Error envelope helper ─────────────────────────────────────────────────────

function errorText(tool: string, err: unknown): { content: Array<{ type: "text"; text: string }> } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: `${tool}: ${message}` }) }] };
}

// ── registerNarrativeTools ────────────────────────────────────────────────────

/**
 * Registers narrative and search MCP tools.
 *
 * Precondition:  server is a valid McpServer instance.
 * Postcondition: 3 tools are registered; the narrative tool will use
 *                llmClient for prose-polish when a MemoryStore adapter is
 *                also wired (Phase 5 prerequisite for the full narrative
 *                pipeline).  When llmClient is null the tools degrade
 *                gracefully — no PortPendingError is thrown.
 *
 * source: MCP_TOOLS.md §"narrative", §"get_project_story", §"unified_search"
 * source: docs/PHASE_7_TRACKING.md §Group C — LLM client DI
 */
export function registerNarrativeTools(
  server: McpServer,
  llmClient: LlmClient | null = null,
): void {
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
        // source: packages/memory/src/narrative/handlers/narrative.ts
        // MemoryStore adapter not yet injected (Phase 5 stub).
        // LLM client is wired (Phase 7 Group C); prose-polish will activate
        // once the store is available.
        const clientNote = llmClient !== null
          ? "LLM client available (prose-polish ready)"
          : "LLM client absent (graceful degradation)";
        return {
          content: [{
            type: "text" as const,
            text: `# Project Narrative\n\n_narrative: MemoryStore adapter not yet injected (Phase 5 stub). ${clientNote}_`,
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
        max_chapters: z.number().int().min(1).max(MAX_CHAPTERS_MAX).default(MAX_CHAPTERS_DEFAULT).describe("Max chapters"),
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
      description: // source: docs/ADR/0046 — unified search design
        "RRF-fuse Cortex memory recall with AP code search (ADR-0046 P3).",
      inputSchema: {
        query:       z.string().min(1).describe("Search query"),
        domain:      z.string().optional().describe("Domain filter"),
        max_results: z.number().int().min(1).max(MAX_RESULTS_MAX).default(MAX_RESULTS_DEFAULT).describe("Max results"),
        // source: Cormack & Clarke (2009) "Reciprocal Rank Fusion" — k=60 canonical value
        k:           z.number().int().min(1).default(RRF_K_DEFAULT).describe("RRF k parameter"),
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
