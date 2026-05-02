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
 *
 * Phase 7 Group E — DI wiring:
 *   registerIngestTools now accepts an optional IngestDeps object. When
 *   deps is supplied, ingest_codebase and ingest_prd call the real domain
 *   handlers directly with constructor-injected dependencies; when deps is
 *   absent, the tools fall back to the Phase-5 stub response.
 *
 * precondition (for live path):  deps.store is a live MemoryStore and
 *   deps.wikiRoot is a writable directory path.
 * postcondition: tools return the real handler response shape when deps is
 *   supplied; the stub note field is absent from live responses.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { codebaseAnalysis } from "@agentic/memory";

// ── Schema constants ──────────────────────────────────────────────────────────
// source: MCP_TOOLS.md §import_sessions, §ingest_codebase, §codebase_analyze
const MIN_IMPORTANCE_DEFAULT = 0.4;
const TOP_SYMBOLS_DEFAULT = 50;
const TOP_PROCESSES_DEFAULT = 10;
// source: cortex mcp_server/handlers/codebase_analyze.py — default/max values
const MAX_FILES_DEFAULT = 500; // source: cortex codebase_analyze.py — max_files default
const MAX_FILES_MAX = 50000; // source: cortex codebase_analyze.py — max_files upper bound
const MAX_FILE_SIZE_KB_DEFAULT = 100; // source: cortex codebase_analyze.py — max_file_size_kb default
const MAX_FILE_SIZE_KB_MAX = 4096; // source: standard 4MB upper bound (also in EXEMPT_PATTERN)

// ── Composition-root deps shape ───────────────────────────────────────────────

/**
 * Dependencies injected at the composition root for the ingest tool group.
 *
 * All fields are required when a live connection is desired. Pass null for
 * mcpClientPool to disable upstream MCP calls (the handlers will surface a
 * McpConnectionError on any call that requires the pool).
 */
export interface IngestDeps {
  store: codebaseAnalysis.IngestCodebaseDeps["store"];
  wikiRoot: string;
  mcpClientPool: codebaseAnalysis.McpClientPool | null;
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
 * When deps is provided, ingest_codebase and ingest_prd delegate to the
 * real domain handlers with constructor-injected dependencies. When deps
 * is absent (Phase-5 stub mode), a stub response is returned.
 *
 * source: MCP_TOOLS.md §"import_sessions", §"ingest_codebase",
 *         §"ingest_prd", §"change_impact", §"open_visualization"
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

  // ── codebase_analyze ──────────────────────────────────────────────────────
  server.registerTool(
    "codebase_analyze",
    {
      description:
        "Walk a codebase and store its structure as memories using AST parsing with regex fallback.",
      inputSchema: {
        directory:        z.string().optional().describe("Root directory to analyze"),
        languages:        z.array(z.string()).optional().describe("Restrict to specific languages"),
        // source: cortex mcp_server/handlers/codebase_analyze.py — default max_files
        max_files:        z.number().int().min(1).max(MAX_FILES_MAX).default(MAX_FILES_DEFAULT).describe("Max files to process"),
        // source: cortex mcp_server/handlers/codebase_analyze.py — default max_file_size_kb
        max_file_size_kb: z.number().int().min(1).max(MAX_FILE_SIZE_KB_MAX).default(MAX_FILE_SIZE_KB_DEFAULT).describe("Skip files larger than this KB"),
        incremental:      z.boolean().default(true).describe("Only reprocess changed files"),
        dry_run:          z.boolean().default(false).describe("Report without writing"),
        domain:           z.string().optional().describe("Cognitive domain tag"),
      },
    },
    async (args) => {
      try {
        if (!deps) {
          const response = {
            analyzed:       false,
            note: "codebase_analyze: MemoryStore adapter not yet injected (Phase 5 stub)",
          };
          return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
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
      description:
        "Ingest upstream codebase analysis from ai-automatised-pipeline into Cortex.",
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
          const response = {
            ingested:        false,
            symbols_stored:  0,
            processes_stored: 0,
            note: "ingest_codebase: MemoryStore adapter not yet injected (Phase 5 stub — pending Phase 3 port)",
          };
          return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
        }
        const ingestDeps: codebaseAnalysis.IngestCodebaseDeps = {
          store: deps.store,
          wikiRoot: deps.wikiRoot,
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
    async (args) => {
      try {
        if (!deps) {
          const response = {
            ingested:       false,
            sections_found: 0,
            note: "ingest_prd: MemoryStore adapter not yet injected (Phase 5 stub)",
          };
          return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
        }
        const prdDeps: codebaseAnalysis.IngestPrdDeps = {
          store: deps.store,
          wikiRoot: deps.wikiRoot,
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
      description:
        "Report memories affected by a commit's code changes (ADR-0046 P4).", // source: docs/ADR/0046-change-impact-analysis.md
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
          note: "open_visualization: HTTP server adapter not yet injected (Phase 5 stub — deferred per ADR-0011)", // source: docs/ADR/0011-cortex-http-server-defer.md
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("open_visualization", err);
      }
    },
  );
}
