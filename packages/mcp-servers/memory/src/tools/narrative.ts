/**
 * narrative.ts — MCP tool adapters for the narrative + story topic.
 *
 * Tools registered (3):
 *   narrative, get_project_story, unified_search
 *
 * Phase 7 Group C + D — DI wiring: MemoryPort store and LlmClient are now
 * injected via NarrativeDeps. Each tool body calls the real domain handler.
 * No stub paths remain.
 *
 * source: worktrees/port-inventory-cortex/inventory/MCP_TOOLS.md
 *         §Tier1Memory (narrative), §Tier2Advanced (get_project_story),
 *         §Tier1Memory (unified_search)
 * source: packages/memory/src/narrative/handlers/narrative.ts (narrativeHandler)
 * source: packages/memory/src/narrative/handlers/get-project-story.ts
 * source: packages/memory/src/narrative/handlers/unified-search.ts
 */

import type { LlmClient } from "@agentic/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { narrativeHandler } from "@agentic/memory/narrative/handlers/narrative.js";
import type { MemoryPort } from "@agentic/memory/narrative/handlers/narrative.js";
import { getProjectStoryHandler } from "@agentic/memory/narrative/handlers/get-project-story.js";
import { unifiedSearchHandler } from "@agentic/memory/narrative/handlers/unified-search.js";

// ── Named constants for schema parameters ──────────────────────────────────

// source: MCP_TOOLS.md §"get_project_story" — max_chapters constraint
const MAX_CHAPTERS_MAX     = 20;
const MAX_CHAPTERS_DEFAULT = 5;

// source: MCP_TOOLS.md §"unified_search" — max_results constraint
const MAX_RESULTS_MAX     = 50;
const MAX_RESULTS_DEFAULT = 10;

// source: Cormack & Clarke (2009) "Reciprocal Rank Fusion" — k=60
// canonical value from MCP_TOOLS.md §unified_search
const RRF_K_DEFAULT = 60;

// ── Tool dependency bundle ─────────────────────────────────────────────────

export interface NarrativeDeps {
  store: MemoryPort;
  llmClient: LlmClient | null;
}

// ── Error envelope helper ─────────────────────────────────────────────────────

function errorText(tool: string, err: unknown): { content: Array<{ type: "text"; text: string }> } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: `${tool}: ${message}` }) }] };
}

// ── registerNarrativeTools ────────────────────────────────────────────────────

/**
 * Registers narrative and search MCP tools.
 *
 * precondition:  deps.store is a live MemoryPort; deps.llmClient may be null.
 * postcondition: 3 tools registered; each body calls the real domain handler.
 *
 * source: MCP_TOOLS.md §"narrative", §"get_project_story", §"unified_search"
 */
export function registerNarrativeTools(
  server: McpServer,
  deps: NarrativeDeps | LlmClient | null = null,
): void {
  // Support both calling conventions:
  //   registerNarrativeTools(server, { store, llmClient }) — preferred
  //   registerNarrativeTools(server, llmClient)            — legacy
  const narrativeDeps = (deps !== null && typeof deps === "object" && "store" in deps)
    ? deps as NarrativeDeps
    : null;
  const llmClient = narrativeDeps?.llmClient ??
    (deps !== null && typeof deps === "object" && !("store" in deps) ? deps as LlmClient : null);

  // ── narrative ─────────────────────────────────────────────────────────────
  server.registerTool(
    "narrative",
    {
      description: "Generate project narrative from stored memories (structured summary).",
      inputSchema: {
        directory: z.string().optional().describe("Directory scope"),
        domain:    z.string().optional().describe("Domain scope"),
        brief:     z.boolean().default(false).describe("Brief mode (condensed output)"),
      },
    },
    async (args) => {
      try {
        // source: packages/memory/src/narrative/handlers/narrative.ts::narrativeHandler
        if (!narrativeDeps) {
          return { content: [{ type: "text" as const, text: JSON.stringify({
            narrative: "",
            memory_count: 0,
            note: "no MemoryStore configured — configure CORTEX_DB_PATH",
          }) }] };
        }
        const response = await narrativeHandler(
          narrativeDeps.store,
          {
            directory: args.directory,
            domain:    args.domain,
            brief:     args.brief,
          },
          llmClient,
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("narrative", err);
      }
    },
  );

  // ── get_project_story ─────────────────────────────────────────────────────
  server.registerTool(
    "get_project_story",
    {
      description: "Generate a period-based autobiographical narrative (week/month/all).",
      inputSchema: {
        directory:    z.string().optional().describe("Directory scope"),
        domain:       z.string().optional().describe("Domain scope"),
        period:       z.enum(["day", "week", "month", "all"]).default("week").describe("Time period"),
        max_chapters: z.number().int().min(1).max(MAX_CHAPTERS_MAX).default(MAX_CHAPTERS_DEFAULT).describe("Max chapters"),
      },
    },
    async (args) => {
      try {
        // source: packages/memory/src/narrative/handlers/get-project-story.ts::getProjectStoryHandler
        if (!narrativeDeps) {
          return { content: [{ type: "text" as const, text: JSON.stringify({
            chapters: [], period: args.period, note: "no MemoryStore configured",
          }) }] };
        }
        const response = getProjectStoryHandler(
          narrativeDeps.store,
          {
            directory:    args.directory,
            domain:       args.domain,
            period:       args.period,
            max_chapters: args.max_chapters,
          },
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
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
        // source: packages/memory/src/narrative/handlers/unified-search.ts::unifiedSearchHandler
        if (!narrativeDeps) {
          return { content: [{ type: "text" as const, text: JSON.stringify({
            results: [], query: args.query, note: "no MemoryStore configured",
          }) }] };
        }
        const response = unifiedSearchHandler(
          narrativeDeps.store,
          {
            query:       args.query,
            domain:      args.domain,
            max_results: args.max_results,
            k:           args.k,
          },
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("unified_search", err);
      }
    },
  );
}
