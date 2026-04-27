/**
 * methodology.ts — MCP tool adapters for the methodology/profiling topic.
 *
 * Tools registered (5):
 *   query_methodology, detect_domain, rebuild_profiles, list_domains,
 *   explore_features
 *
 * source: worktrees/port-inventory-cortex/inventory/MCP_TOOLS.md §Tier1Core
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ── Error envelope helper ─────────────────────────────────────────────────────

function errorText(tool: string, err: unknown): { content: Array<{ type: "text"; text: string }> } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: `${tool}: ${message}` }) }] };
}

// ── registerMethodologyTools ──────────────────────────────────────────────────

/**
 * Registers the 5 methodology/profiling MCP tools.
 *
 * source: MCP_TOOLS.md §"query_methodology", §"detect_domain",
 *         §"rebuild_profiles", §"list_domains", §"explore_features"
 */
export function registerMethodologyTools(server: McpServer): void {
  // ── query_methodology ─────────────────────────────────────────────────────
  server.registerTool(
    "query_methodology",
    {
      description:
        "Returns cognitive profile for the current domain (thinking style, entry patterns, blind spots, cross-domain bridges).",
      inputSchema: {
        cwd:           z.string().optional().describe("Current working directory"),
        project:       z.string().optional().describe("Project identifier"),
        first_message: z.string().optional().describe("First message of the session"),
      },
    },
    async (args) => {
      try {
        // source: packages/memory/src/methodology/handlers/query-methodology.ts
        const response = {
          domain:            null,
          confidence:        0,
          coldStart:         true,
          context:           "",
          style:             null,
          entryPoints:       [],
          recurringPatterns: [],
          toolPreferences:   {},
          blindSpots:        [],
          connectionBridges: [],
          sessionCount:      0,
          lastActive:        null,
          hotMemories:       [],
          firedTriggers:     [],
          note: "query_methodology: ProfilesStore adapter not yet injected (Phase 5 stub)",
          cwd: args.cwd,
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("query_methodology", err);
      }
    },
  );

  // ── detect_domain ─────────────────────────────────────────────────────────
  server.registerTool(
    "detect_domain",
    {
      description:
        "Lightweight domain classification from cwd/project without full profile assembly.",
      inputSchema: {
        cwd:           z.string().optional().describe("Current working directory"),
        project:       z.string().optional().describe("Project identifier"),
        first_message: z.string().optional().describe("First message for hint"),
      },
    },
    async (args) => {
      try {
        const response = {
          domain:     null,
          confidence: 0,
          candidates: [],
          cwd:        args.cwd,
          note: "detect_domain: ProfilesStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("detect_domain", err);
      }
    },
  );

  // ── rebuild_profiles ──────────────────────────────────────────────────────
  server.registerTool(
    "rebuild_profiles",
    {
      description:
        "Full rescan of all session data to rebuild methodology profiles from scratch.",
      inputSchema: {
        domain: z.string().optional().describe("Limit rebuild to a single domain"),
        force:  z.boolean().default(false).describe("Force rebuild even if fresh"),
      },
    },
    async (_args) => {
      try {
        const response = {
          rebuilt:     [],
          duration_ms: 0,
          note: "rebuild_profiles: ProfilesStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("rebuild_profiles", err);
      }
    },
  );

  // ── list_domains ──────────────────────────────────────────────────────────
  server.registerTool(
    "list_domains",
    {
      description:
        "Overview of all detected cognitive domains with session counts and last-seen dates.",
      inputSchema: {},
    },
    async (_args) => {
      try {
        const response = {
          domains: [],
          note: "list_domains: ProfilesStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("list_domains", err);
      }
    },
  );

  // ── explore_features ──────────────────────────────────────────────────────
  server.registerTool(
    "explore_features",
    {
      description:
        "Explore interpretability features: persona vector, attribution trace, crosscoder patterns.",
      inputSchema: {
        mode:           z.enum(["features", "persona", "attribution", "crosscoder"]).describe("Exploration mode"),
        domain:         z.string().optional().describe("Domain filter"),
        compare_domain: z.string().optional().describe("Domain to compare against"),
      },
    },
    async (args) => {
      try {
        const response = {
          mode: args.mode,
          data: {},
          note: "explore_features: ProfilesStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("explore_features", err);
      }
    },
  );
}
