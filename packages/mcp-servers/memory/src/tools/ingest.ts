/**
 * ingest.ts — MCP tool adapters for the upstream ingest topic.
 *
 * Tools registered (5):
 *   import_sessions, ingest_codebase, ingest_prd, change_impact,
 *   open_visualization
 *
 * source: worktrees/port-inventory-cortex/inventory/MCP_TOOLS.md
 *         §UpstreamIngest (ingest_codebase, ingest_prd, change_impact)
 *         §Tier1Memory (import_sessions)
 *         §Tier1Core (open_visualization)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ── Error envelope helper ─────────────────────────────────────────────────────

function errorText(tool: string, err: unknown): { content: Array<{ type: "text"; text: string }> } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: `${tool}: ${message}` }) }] };
}

// ── registerIngestTools ───────────────────────────────────────────────────────

/**
 * Registers ingest and import MCP tools.
 *
 * source: MCP_TOOLS.md §"import_sessions", §"ingest_codebase",
 *         §"ingest_prd", §"change_impact", §"open_visualization"
 */
export function registerIngestTools(server: McpServer): void {
  // ── import_sessions ───────────────────────────────────────────────────────
  server.registerTool(
    "import_sessions",
    {
      description:
        "Import Claude Code JSONL conversation history into the memory store (streams via head+tail, per ADR-0045 R2).",
      inputSchema: {
        project:        z.string().default("").describe("Project identifier"),
        domain:         z.string().default("").describe("Domain to assign"),
        // source: MCP_TOOLS.md §import_sessions default min_importance=0.4
        min_importance: z.number().min(0).max(1).default(0.4).describe("Min importance threshold"),
        max_sessions:   z.number().int().min(0).default(0).describe("Max sessions (0 = all)"),
        dry_run:        z.boolean().default(false).describe("Preview without storing"),
      },
    },
    async (_args) => {
      try {
        // source: packages/memory/src/import/handler.ts::importHandler
        const response = {
          imported:           0,
          skipped:            0,
          sessions_processed: 0,
          note: "import_sessions: MemoryStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("import_sessions", err);
      }
    },
  );

  // ── ingest_codebase ───────────────────────────────────────────────────────
  server.registerTool(
    "ingest_codebase",
    {
      description:
        "Ingest upstream codebase analysis from ai-automatised-pipeline into Cortex.",
      inputSchema: {
        project_path:  z.string().min(1).describe("Path to the codebase"),
        output_dir:    z.string().optional().describe("Output directory for analysis artifacts"),
        language:      z.string().default("auto").describe("Language hint (auto = detect)"),
        force_reindex: z.boolean().default(false).describe("Force reindex even if cached"),
        // source: MCP_TOOLS.md §ingest_codebase default top_symbols=50
        top_symbols:   z.number().int().min(1).default(50).describe("Top symbols to extract"),
        // source: MCP_TOOLS.md §ingest_codebase default top_processes=10
        top_processes: z.number().int().min(1).default(10).describe("Top processes to extract"),
      },
    },
    async (_args) => {
      try {
        const response = {
          ingested:        0,
          symbols_stored:  0,
          processes_stored: 0,
          note: "ingest_codebase: CodebasePort adapter not yet injected (Phase 5 stub — pending Phase 3 port)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("ingest_codebase", err);
      }
    },
  );

  // ── ingest_prd ────────────────────────────────────────────────────────────
  server.registerTool(
    "ingest_prd",
    {
      description:
        "Ingest a PRD document into Cortex (from path or content string).",
      inputSchema: {
        path:        z.string().optional().describe("Path to PRD file"),
        content:     z.string().optional().describe("PRD content string"),
        pipeline_id: z.string().optional().describe("Pipeline run ID"),
        title:       z.string().optional().describe("PRD title"),
        validate:    z.boolean().default(false).describe("Validate PRD structure"),
        domain:      z.string().optional().describe("Domain to assign"),
      },
    },
    async (_args) => {
      try {
        const response = {
          memory_id:      null,
          stored:         false,
          sections_found: 0,
          note: "ingest_prd: MemoryStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("ingest_prd", err);
      }
    },
  );

  // ── change_impact ─────────────────────────────────────────────────────────
  server.registerTool(
    "change_impact",
    {
      description:
        "Report memories affected by a commit's code changes (ADR-0046 P4).",
      inputSchema: {
        base:             z.string().default("HEAD~1").describe("Base git ref"),
        head:             z.string().default("HEAD").describe("Head git ref"),
        expand_impact:    z.boolean().default(false).describe("Expand to transitive impacts"),
        apply_heat_bump:  z.boolean().default(false).describe("Apply heat bump to affected memories"),
      },
    },
    async (_args) => {
      try {
        const response = {
          affected_memories: [],
          impacted_symbols:  [],
          note: "change_impact: CodebasePort adapter not yet injected (Phase 5 stub — pending Phase 3 port)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("change_impact", err);
      }
    },
  );

  // ── open_visualization ────────────────────────────────────────────────────
  server.registerTool(
    "open_visualization",
    {
      description:
        "Launch the 3D methodology constellation map in the browser.",
      inputSchema: {
        domain: z.string().optional().describe("Domain to visualise"),
      },
    },
    async (_args) => {
      try {
        const response = {
          url:  null,
          port: null,
          note: "open_visualization: HTTP server adapter not yet injected (Phase 5 stub — deferred per ADR-0011)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("open_visualization", err);
      }
    },
  );
}
