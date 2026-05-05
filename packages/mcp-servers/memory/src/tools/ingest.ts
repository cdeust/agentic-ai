/**
 * ingest.ts — MCP tool adapters for the upstream ingest topic.
 *
 * Tools registered (6):
 *   import_sessions, codebase_analyze, ingest_codebase, ingest_prd,
 *   change_impact, open_visualization
 *
 * Phase 7 Group D — DI wiring:
 *   - import_sessions: calls real importHandler from @agentic/memory/import.
 *   - codebase_analyze: calls real codebaseAnalyzeHandler.
 *   - ingest_codebase: calls real ingestCodebaseHandler.
 *   - ingest_prd: calls real ingestPrdHandler.
 *   - change_impact: throws PortPendingError — blocked on AP codebase graph.
 *     source: docs/ADR/0046-change-impact-analysis.md §Phase 3 (not landed)
 *   - open_visualization: launches the HTTP dashboard via @agentic/memory-dashboard.
 *     source: docs/ADR/0014-cortex-http-server-restored.md (ADR-0011 rescinded)
 *
 * source: worktrees/port-inventory-cortex/inventory/MCP_TOOLS.md
 *         §UpstreamIngest, §Tier1Memory (import_sessions), §Tier1Core (open_viz)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { codebaseAnalysis } from "@agentic/memory";
import { changeImpactHandler } from "@agentic/memory/codebase-analysis/handlers/change-impact.js";
import { importHandler } from "@agentic/memory/import/handler.js";
import { remember } from "@agentic/memory/remember/handlers/remember.js";
import type { MemoryStore } from "@agentic/memory/remember/storage/memory-store.js";
import { launchDashboard } from "@agentic/memory-dashboard/launcher";

// ── Schema constants ──────────────────────────────────────────────────────────
// source: MCP_TOOLS.md §import_sessions, §ingest_codebase, §codebase_analyze
const MIN_IMPORTANCE_DEFAULT = 0.4;
const TOP_SYMBOLS_DEFAULT    = 50;
const TOP_PROCESSES_DEFAULT  = 10;
// source: cortex@ed33435 mcp_server/handlers/codebase_analyze.py — default/max values
const MAX_FILES_DEFAULT        = 500;   // source: cortex codebase_analyze.py — max_files default
const MAX_FILES_MAX            = 50000; // source: cortex codebase_analyze.py — max_files upper bound
const MAX_FILE_SIZE_KB_DEFAULT = 100;   // source: cortex codebase_analyze.py — max_file_size_kb default
const MAX_FILE_SIZE_KB_MAX     = 4096;  // source: standard 4MB upper bound (also in EXEMPT_PATTERN)

// ── Composition-root deps shape ───────────────────────────────────────────────

export interface IngestDeps {
  store:         codebaseAnalysis.IngestCodebaseDeps["store"];
  wikiRoot:      string;
  mcpClientPool: codebaseAnalysis.McpClientPool | null;
}

// ── PortPendingError ──────────────────────────────────────────────────────────

class PortPendingError extends Error {
  constructor(handlerName: string, blocker: string) {
    super(`${handlerName} requires ${blocker}.`);
    this.name = "PortPendingError";
  }
}

// ── Error envelope helper ─────────────────────────────────────────────────────

function errorText(tool: string, err: unknown): { content: Array<{ type: "text"; text: string }> } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: `${tool}: ${message}` }) }] };
}

// ── registerIngestTools ───────────────────────────────────────────────────────

/**
 * Registers ingest and import MCP tools.
 *
 * precondition:  deps is provided with a live store and wikiRoot.
 * postcondition: 6 tools registered; import_sessions/codebase_analyze/
 *   ingest_codebase/ingest_prd/change_impact call real handlers;
 *   open_visualization launches @agentic/memory-dashboard and returns the URL.
 *
 * source: MCP_TOOLS.md §"import_sessions", §"codebase_analyze",
 *         §"ingest_codebase", §"ingest_prd", §"change_impact",
 *         §"open_visualization"
 * source: docs/ADR/0014-cortex-http-server-restored.md
 */
export function registerIngestTools(server: McpServer, deps?: IngestDeps): void {
  // ── import_sessions ───────────────────────────────────────────────────────
  server.registerTool(
    "import_sessions",
    {
      description:
        "Import Claude Code JSONL conversation history into the memory store (streams via head+tail, per ADR-0045 R2).", // source: docs/ADR/0045-bounded-streaming-ingestion.md
      inputSchema: {
        project:        z.string().default("").describe("Project identifier"),
        domain:         z.string().default("").describe("Domain to assign"),
        // source: MCP_TOOLS.md §import_sessions default min_importance=0.4
        min_importance: z.number().min(0).max(1).default(MIN_IMPORTANCE_DEFAULT).describe("Min importance threshold"),
        max_sessions:   z.number().int().min(0).default(0).describe("Max sessions (0 = all)"),
        dry_run:        z.boolean().default(false).describe("Preview without storing"),
      },
    },
    async (args) => {
      try {
        if (!deps) {
          throw new PortPendingError("import_sessions", "IngestDeps.store — no store injected");
        }
        // source: packages/memory/src/import/handler.ts::importHandler
        const store = deps.store as unknown as MemoryStore;
        const rememberFn = (rawArgs: unknown): Promise<{ stored: true } | null> => {
          const result = remember(rawArgs, store);
          return Promise.resolve(result.stored ? { stored: true as const } : null);
        };
        const response = await importHandler(
          {
            project:        args.project,
            domain:         args.domain,
            min_importance: args.min_importance,
            max_sessions:   args.max_sessions,
            dry_run:        args.dry_run,
          },
          rememberFn,
        );
        return { content: [{ type: "text" as const, text: JSON.stringify({
          imported:           response.imported,
          skipped:            response.skipped,
          sessions_processed: response.sessions_scanned,
          dry_run:            args.dry_run,
        }) }] };
      } catch (err) {
        return errorText("import_sessions", err);
      }
    },
  );

  // ── codebase_analyze ──────────────────────────────────────────────────────
  server.registerTool(
    "codebase_analyze",
    {
      description: "Walk a codebase and store its structure as memories using AST parsing with regex fallback.",
      inputSchema: {
        directory:        z.string().optional().describe("Root directory to analyze"),
        languages:        z.array(z.string()).optional().describe("Restrict to specific languages"),
        // source: cortex@ed33435 mcp_server/handlers/codebase_analyze.py — default max_files
        max_files:        z.number().int().min(1).max(MAX_FILES_MAX).default(MAX_FILES_DEFAULT).describe("Max files to process"),
        // source: cortex@ed33435 mcp_server/handlers/codebase_analyze.py — default max_file_size_kb
        max_file_size_kb: z.number().int().min(1).max(MAX_FILE_SIZE_KB_MAX).default(MAX_FILE_SIZE_KB_DEFAULT).describe("Skip files larger than this KB"),
        incremental:      z.boolean().default(true).describe("Only reprocess changed files"),
        dry_run:          z.boolean().default(false).describe("Report without writing"),
        domain:           z.string().optional().describe("Cognitive domain tag"),
      },
    },
    async (args) => {
      try {
        if (!deps) {
          throw new PortPendingError("codebase_analyze", "IngestDeps.store — no store injected");
        }
        const analyzeDeps: codebaseAnalysis.CodebaseAnalyzeDeps = { store: deps.store };
        const result = await codebaseAnalysis.codebaseAnalyzeHandler(args as Record<string, unknown>, analyzeDeps);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (err) {
        return errorText("codebase_analyze", err);
      }
    },
  );

  // ── ingest_codebase ───────────────────────────────────────────────────────
  server.registerTool(
    "ingest_codebase",
    {
      description: "Ingest upstream codebase analysis from ai-automatised-pipeline into Cortex.",
      inputSchema: {
        project_path:  z.string().min(1).describe("Path to the codebase"),
        output_dir:    z.string().optional().describe("Output directory for analysis artifacts"),
        language:      z.string().default("auto").describe("Language hint (auto = detect)"),
        force_reindex: z.boolean().default(false).describe("Force reindex even if cached"),
        // source: MCP_TOOLS.md §ingest_codebase default top_symbols=50
        top_symbols:   z.number().int().min(1).default(TOP_SYMBOLS_DEFAULT).describe("Top symbols to extract"),
        // source: MCP_TOOLS.md §ingest_codebase default top_processes=10
        top_processes: z.number().int().min(1).default(TOP_PROCESSES_DEFAULT).describe("Top processes to extract"),
      },
    },
    async (args) => {
      try {
        if (!deps) {
          throw new PortPendingError("ingest_codebase", "IngestDeps.store — no store injected");
        }
        const ingestDeps: codebaseAnalysis.IngestCodebaseDeps = {
          store:         deps.store,
          wikiRoot:      deps.wikiRoot,
          mcpClientPool: deps.mcpClientPool,
        };
        const result = await codebaseAnalysis.ingestCodebaseHandler(args as Record<string, unknown>, ingestDeps);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (err) {
        return errorText("ingest_codebase", err);
      }
    },
  );

  // ── ingest_prd ────────────────────────────────────────────────────────────
  server.registerTool(
    "ingest_prd",
    {
      description: "Ingest a PRD document into Cortex (from path or content string).",
      inputSchema: {
        path:        z.string().optional().describe("Path to PRD file"),
        content:     z.string().optional().describe("PRD content string"),
        pipeline_id: z.string().optional().describe("Pipeline run ID"),
        title:       z.string().optional().describe("PRD title"),
        validate:    z.boolean().default(false).describe("Validate PRD structure"),
        domain:      z.string().optional().describe("Domain to assign"),
      },
    },
    async (args) => {
      try {
        if (!deps) {
          throw new PortPendingError("ingest_prd", "IngestDeps.store — no store injected");
        }
        const prdDeps: codebaseAnalysis.IngestPrdDeps = {
          store:         deps.store,
          wikiRoot:      deps.wikiRoot,
          mcpClientPool: deps.mcpClientPool,
        };
        const result = await codebaseAnalysis.ingestPrdHandler(args as Record<string, unknown>, prdDeps);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (err) {
        return errorText("ingest_prd", err);
      }
    },
  );

  // ── change_impact ─────────────────────────────────────────────────────────
  server.registerTool(
    "change_impact",
    {
      description: "Report memories affected by a commit's code changes (ADR-0046 P4).", // source: docs/ADR/0046-change-impact-analysis.md
      inputSchema: {
        base:            z.string().default("HEAD~1").describe("Base git ref"),
        head:            z.string().default("HEAD").describe("Head git ref"),
        expand_impact:   z.boolean().default(false).describe("Expand to transitive impacts"),
        apply_heat_bump: z.boolean().default(false).describe("Apply heat bump to affected memories"),
      },
    },
    async (args) => {
      try {
        // source: cortex@ed33435 mcp_server/handlers/change_impact.py::handler
        // source: cortex@ed33435 mcp_server/core/change_impact_matcher.py::match_memories
        // Real implementation: packages/memory/src/codebase-analysis/handlers/change-impact.ts
        const store = deps?.store as unknown as MemoryStore;
        const response = await changeImpactHandler(
          {
            base:            args.base,
            head:            args.head,
            expand_impact:   args.expand_impact,
            apply_heat_bump: args.apply_heat_bump,
          },
          {
            store,
            mcpClientPool: deps?.mcpClientPool ?? null,
          },
        );
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
      description: "Launch the 3D methodology constellation map in the browser.",
      inputSchema: {
        domain: z.string().optional().describe("Domain to visualise"),
      },
    },
    async (args) => {
      try {
        // Launch or reuse the memory-dashboard HTTP server.
        // ADR-0011 is rescinded — source: docs/ADR/0014-cortex-http-server-restored.md
        // source: cortex@ed33435 mcp_server/server/http_launcher.py:255-325 (launch_server)
        const url = await launchDashboard({ openBrowser: true });
        const domain = (args as { domain?: string }).domain;
        const finalUrl = domain ? `${url}?domain=${encodeURIComponent(domain)}` : url;
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ url: finalUrl, message: `Dashboard launched at ${finalUrl}` }),
            },
          ],
        };
      } catch (err) {
        return errorText("open_visualization", err);
      }
    },
  );
}
