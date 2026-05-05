/**
 * registry-manage.ts — Tier 1 memory management tool registry (7 tools).
 * Exact portage of: cortex@ed33435 mcp_server/tool_registry_manage.py
 * source: cortex@ed33435 mcp_server/tool_registry_manage.py::register
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MemoryStore } from "@agentic/memory/remember/storage/memory-store.js";
import { forget } from "@agentic/memory/remember/handlers/forget.js";
import { anchor } from "@agentic/memory/remember/handlers/anchor.js";
import { rateMemory } from "@agentic/memory/remember/handlers/rate-memory.js";
import { importHandler } from "@agentic/memory/import/handler.js";
import { remember } from "@agentic/memory/remember/handlers/remember.js";
import { codebaseAnalysis } from "@agentic/memory";
import { handler as seedProjectHandlerFn } from "@agentic/memory/codebase-analysis/handlers/seed-project.js";

// source: cortex@ed33435 validate_memory.py default staleness threshold 0.5
const VALIDATE_STALENESS_DEFAULT = 0.5;
// source: cortex@ed33435 validate_memory.py:200 — error list capped at 10
const VALIDATE_ERROR_CAP         = 10;
// source: cortex@ed33435 seed_project.py max_file_size_kb default=64KB
const SEED_MAX_FILE_SIZE_KB      = 64;
// source: MCP_TOOLS.md §backfill_memories max_files default=20
const BACKFILL_MAX_FILES_DEFAULT = 20;
// source: Ebbinghaus retention curve — min_importance 0.35 per MCP_TOOLS.md §backfill_memories
const BACKFILL_MIN_IMPORTANCE    = 0.35;
// source: cortex@ed33435 codebase_analyze.py defaults
const CODEBASE_MAX_FILES         = 500;
const CODEBASE_MAX_FILE_SIZE_KB  = 100; // source: cortex@ed33435 codebase_analyze.py max_file_size_kb default

export interface ManageRegistryDeps { store: MemoryStore; }

function errorText(tool: string, err: unknown): { content: Array<{ type: "text"; text: string }> } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: `${tool}: ${message}` }) }] };
}

/**
 * Register Tier 1 memory management tools.
 * precondition:  deps.store is a live MemoryStore.
 * postcondition: 7 tools registered; each dispatches to the real domain handler.
 * source: cortex@ed33435 mcp_server/tool_registry_manage.py::register
 */
export function register(server: McpServer, deps: ManageRegistryDeps): void {
  server.registerTool("forget", {
    description: "Delete or soft-delete a memory by integer ID.",
    inputSchema: { memory_id: z.number().int().min(1).describe("Memory ID to delete"), soft: z.boolean().default(false).describe("Soft-delete (archive rather than purge)"), force: z.boolean().default(false).describe("Force delete even if protected") },
  }, async (args) => { try { return { content: [{ type: "text" as const, text: JSON.stringify(forget(args, deps.store)) }] }; } catch (err) { return errorText("forget", err); } });

  server.registerTool("validate_memory", {
    description: "Validate memories against current filesystem state.",
    inputSchema: { memory_id: z.number().int().optional(), domain: z.string().optional(), directory: z.string().optional(), base_dir: z.string().default(""), staleness_threshold: z.number().min(0).max(1).default(VALIDATE_STALENESS_DEFAULT), dry_run: z.boolean().default(false) },
  }, async (args) => { try { const ext = deps.store as unknown as { getAllMemoriesForDecay?: () => Array<Record<string, unknown>> }; const allMems = ext.getAllMemoriesForDecay?.() ?? []; const candidates = args.memory_id !== undefined ? allMems.filter((m) => m["id"] === args.memory_id) : allMems.filter((m) => { if (args.domain && m["domain"] !== args.domain) return false; if (args.directory && !String(m["directory_context"] ?? "").startsWith(args.directory)) return false; return true; }); let validated = 0, staleMarked = 0; const errors: string[] = []; for (const mem of candidates) { try { validated++; const heat = (mem["heat"] as number | undefined) ?? 0; if (heat >= args.staleness_threshold) continue; const tags = (mem["tags"] as string[] | undefined) ?? []; const fileRef = tags.find((t) => t.startsWith("file:") || t.startsWith("path:")); if (!fileRef) continue; const filePath = fileRef.replace(/^(?:file:|path:)/, ""); const absPath = args.base_dir ? join(args.base_dir, filePath) : filePath; if (existsSync(absPath)) continue; if (!args.dry_run) deps.store.markMemoryStale(Number(mem["id"]), true); staleMarked++; } catch (e) { errors.push(String(e)); } } return { content: [{ type: "text" as const, text: JSON.stringify({ validated, stale_marked: staleMarked, dry_run: args.dry_run, errors: errors.slice(0, VALIDATE_ERROR_CAP) }) }] }; } catch (err) { return errorText("validate_memory", err); } });

  server.registerTool("rate_memory", {
    description: "Rate a memory as useful or not to update metamemory confidence.",
    inputSchema: { memory_id: z.number().int().min(1), useful: z.boolean() },
  }, async (args) => { try { return { content: [{ type: "text" as const, text: JSON.stringify(rateMemory(args, deps.store)) }] }; } catch (err) { return errorText("rate_memory", err); } });

  server.registerTool("seed_project", {
    description: "Bootstrap memory from an existing codebase by scanning files.",
    inputSchema: { directory: z.string().default(""), domain: z.string().default(""), max_file_size_kb: z.number().int().min(1).default(SEED_MAX_FILE_SIZE_KB), dry_run: z.boolean().default(false) },
  }, async (args) => { try { const response = await seedProjectHandlerFn({ directory: args.directory, domain: args.domain, max_file_size_kb: args.max_file_size_kb, dry_run: args.dry_run }, { store: deps.store }); return { content: [{ type: "text" as const, text: JSON.stringify(response) }] }; } catch (err) { return errorText("seed_project", err); } });

  server.registerTool("anchor", {
    description: "Mark a memory as compaction-resistant (heat_base=1.0, no_decay=true, is_protected=true).",
    inputSchema: { memory_id: z.number().int().min(1), reason: z.string().default("") },
  }, async (args) => { try { return { content: [{ type: "text" as const, text: JSON.stringify(anchor(args, deps.store)) }] }; } catch (err) { return errorText("anchor", err); } });

  server.registerTool("backfill_memories", {
    description: "Auto-import prior Claude Code conversation JSONL files, applying Ebbinghaus-decay initial heat.",
    inputSchema: { project: z.string().default(""), max_files: z.number().int().min(1).default(BACKFILL_MAX_FILES_DEFAULT), min_importance: z.number().min(0).max(1).default(BACKFILL_MIN_IMPORTANCE), dry_run: z.boolean().default(false), force_reprocess: z.boolean().default(false) },
  }, async (args) => { try { const rememberFn = (rawArgs: unknown): Promise<{ stored: true } | null> => { const result = remember(rawArgs, deps.store); return Promise.resolve(result.stored ? { stored: true as const } : null); }; const response = await importHandler({ project: args.project, domain: "", min_importance: args.min_importance, max_sessions: args.max_files, dry_run: args.dry_run }, rememberFn); return { content: [{ type: "text" as const, text: JSON.stringify({ backfilled: response.imported, skipped: response.skipped, files_processed: response.total_files, dry_run: args.dry_run }) }] }; } catch (err) { return errorText("backfill_memories", err); } });

  server.registerTool("codebase_analyze", {
    description: "Analyze codebase and store structural memories.",
    inputSchema: { directory: z.string().default(""), languages: z.array(z.string()).optional(), max_files: z.number().int().min(1).default(CODEBASE_MAX_FILES), max_file_size_kb: z.number().int().min(1).default(CODEBASE_MAX_FILE_SIZE_KB), incremental: z.boolean().default(true), dry_run: z.boolean().default(false), domain: z.string().default("") },
  }, async (args) => { try { const analyzeDeps: codebaseAnalysis.CodebaseAnalyzeDeps = { store: deps.store }; const result = await codebaseAnalysis.codebaseAnalyzeHandler(args as Record<string, unknown>, analyzeDeps); return { content: [{ type: "text" as const, text: JSON.stringify(result) }] }; } catch (err) { return errorText("codebase_analyze", err); } });
}
