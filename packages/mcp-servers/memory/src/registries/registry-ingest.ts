/**
 * registry-ingest.ts — Upstream-ingest tool registry (3 tools).
 * Exact portage of: cortex@ed33435 mcp_server/tool_registry_ingest.py
 * source: cortex@ed33435 mcp_server/tool_registry_ingest.py::register
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { codebaseAnalysis } from "@agentic/memory";
import { changeImpactHandler } from "@agentic/memory/codebase-analysis/handlers/change-impact.js";
import type { MemoryStore } from "@agentic/memory/remember/storage/memory-store.js";

// source: MCP_TOOLS.md §ingest_codebase defaults
const TOP_SYMBOLS_DEFAULT   = 50;
const TOP_PROCESSES_DEFAULT = 10;

export interface IngestRegistryDeps {
  store:         codebaseAnalysis.IngestCodebaseDeps["store"];
  wikiRoot:      string;
  mcpClientPool: codebaseAnalysis.McpClientPool | null;
}

function errorText(tool: string, err: unknown): { content: Array<{ type: "text"; text: string }> } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: `${tool}: ${message}` }) }] };
}

/**
 * Register upstream-ingest tools.
 * precondition:  deps contains live store, wikiRoot, mcpClientPool.
 * postcondition: 3 tools registered; each dispatches to the real domain handler.
 * source: cortex@ed33435 mcp_server/tool_registry_ingest.py::register
 */
export function register(server: McpServer, deps: IngestRegistryDeps): void {
  server.registerTool("ingest_codebase", {
    description: "Ingest upstream codebase analysis from ai-automatised-pipeline into Cortex.",
    inputSchema: { project_path: z.string().min(1), output_dir: z.string().optional(), language: z.string().default("auto"), force_reindex: z.boolean().default(false), top_symbols: z.number().int().min(1).default(TOP_SYMBOLS_DEFAULT), // source: MCP_TOOLS.md §ingest_codebase default top_symbols=50
      top_processes: z.number().int().min(1).default(TOP_PROCESSES_DEFAULT) }, // source: MCP_TOOLS.md §ingest_codebase default top_processes=10
  }, async (args) => { try { const ingestDeps: codebaseAnalysis.IngestCodebaseDeps = { store: deps.store, wikiRoot: deps.wikiRoot, mcpClientPool: deps.mcpClientPool }; const result = await codebaseAnalysis.ingestCodebaseHandler(args as Record<string, unknown>, ingestDeps); return { content: [{ type: "text" as const, text: JSON.stringify(result) }] }; } catch (err) { return errorText("ingest_codebase", err); } });

  server.registerTool("change_impact", {
    description: "Report memories affected by a commit's code changes (ADR-0046 P4).", // source: docs/ADR/0046-change-impact-analysis.md
    inputSchema: { base: z.string().default("HEAD~1"), head: z.string().default("HEAD"), expand_impact: z.boolean().default(false), apply_heat_bump: z.boolean().default(false) },
  }, async (args) => { try { const store = deps.store as unknown as MemoryStore; const response = await changeImpactHandler({ base: args.base, head: args.head, expand_impact: args.expand_impact, apply_heat_bump: args.apply_heat_bump }, { store, mcpClientPool: deps.mcpClientPool }); return { content: [{ type: "text" as const, text: JSON.stringify(response) }] }; } catch (err) { return errorText("change_impact", err); } });

  server.registerTool("ingest_prd", {
    description: "Ingest a PRD document into Cortex (from path or content string).",
    inputSchema: { path: z.string().optional(), content: z.string().optional(), pipeline_id: z.string().optional(), title: z.string().optional(), validate: z.boolean().default(false), domain: z.string().optional() },
  }, async (args) => { try { const prdDeps: codebaseAnalysis.IngestPrdDeps = { store: deps.store, wikiRoot: deps.wikiRoot, mcpClientPool: deps.mcpClientPool }; const result = await codebaseAnalysis.ingestPrdHandler(args as Record<string, unknown>, prdDeps); return { content: [{ type: "text" as const, text: JSON.stringify(result) }] }; } catch (err) { return errorText("ingest_prd", err); } });
}
