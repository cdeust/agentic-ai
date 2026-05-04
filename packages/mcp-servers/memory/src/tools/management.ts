/**
 * management.ts — MCP tool adapters for the memory management topic.
 *
 * Tools registered (5):
 *   validate_memory, seed_project, backfill_memories, codebase_analyze,
 *   get_methodology_graph
 *
 * Phase 7 Group D — DI wiring:
 *   - validate_memory: marks stale memories whose source files no longer exist.
 *     Ported from cortex@ed33435 mcp_server/handlers/validate_memory.py.
 *   - seed_project: deferred — requires full file-system scanner port.
 *     Throws PortPendingError(seed_project, "filesystem scanner not yet ported").
 *   - backfill_memories: calls real importHandler from @agentic/memory/import.
 *     source: packages/memory/src/import/handler.ts::importHandler
 *   - codebase_analyze: calls real codebaseAnalyzeHandler.
 *     source: packages/memory/src/codebase-analysis/handlers/codebase-analyze.ts
 *   - get_methodology_graph: builds graph from profiles.json.
 *     Ported from cortex@ed33435 mcp_server/handlers/get_methodology_graph.py.
 *
 * source: worktrees/port-inventory-cortex/inventory/MCP_TOOLS.md
 *         §Tier1Manage, §Tier1Core (get_methodology_graph)
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MemoryStore } from "@agentic/memory/remember/storage/memory-store.js";
import { importHandler } from "@agentic/memory/import/handler.js";
import { remember } from "@agentic/memory/remember/handlers/remember.js";
import { codebaseAnalysis } from "@agentic/memory";

// ── Named constants ───────────────────────────────────────────────────────────
// source: cortex@ed33435 validate_memory.py — default staleness threshold 0.5
const VALIDATE_STALENESS_DEFAULT = 0.5;
// source: cortex@ed33435 validate_memory.py:200 — error list capped at 10
const VALIDATE_ERROR_CAP = 10;
// source: cortex@ed33435 seed_project.py — max_file_size_kb default=64KB
const SEED_MAX_FILE_SIZE_KB = 64;
// source: MCP_TOOLS.md §backfill_memories max_files default=20
const BACKFILL_MAX_FILES_DEFAULT = 20;
const BACKFILL_MIN_IMPORTANCE = 0.35; // source: Ebbinghaus retention curve — min_importance threshold of 0.35 per MCP_TOOLS.md §backfill_memories
const CODEBASE_MAX_FILES = 500; // source: cortex@ed33435 codebase_analyze.py max_files default
const CODEBASE_MAX_FILE_SIZE_KB = 100; // source: cortex@ed33435 codebase_analyze.py max_file_size_kb default

// ── Dependency bundle ─────────────────────────────────────────────────────────

export interface ManagementDeps {
  store: MemoryStore;
}

// ── Profiles I/O ──────────────────────────────────────────────────────────────

function loadProfilesRaw(): Record<string, unknown> {
  const profilePath = join(homedir(), ".claude", "methodology", "profiles.json");
  if (!existsSync(profilePath)) return { domains: {} };
  try {
    return JSON.parse(readFileSync(profilePath, "utf-8")) as Record<string, unknown>;
  } catch {
    return { domains: {} };
  }
}

// ── PortPendingError ──────────────────────────────────────────────────────────

class PortPendingError extends Error {
  constructor(handlerName: string, blocker: string) {
    super(`${handlerName} requires ${blocker} — not yet ported to TypeScript.`);
    this.name = "PortPendingError";
  }
}

// ── Error envelope helper ─────────────────────────────────────────────────────

function errorText(tool: string, err: unknown): { content: Array<{ type: "text"; text: string }> } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: `${tool}: ${message}` }) }] };
}

// ── registerManagementTools ───────────────────────────────────────────────────

/**
 * Registers memory management MCP tools.
 *
 * precondition:  deps.store is a live MemoryStore.
 * postcondition: 5 tools registered; validate_memory, backfill_memories,
 *   codebase_analyze, get_methodology_graph call real handlers;
 *   seed_project throws PortPendingError with specific blocker named.
 *
 * source: MCP_TOOLS.md §"validate_memory", §"seed_project",
 *         §"backfill_memories", §"codebase_analyze", §"get_methodology_graph"
 */
export function registerManagementTools(server: McpServer, deps: ManagementDeps): void {
  // ── validate_memory ───────────────────────────────────────────────────────
  server.registerTool(
    "validate_memory",
    {
      description: "Validate memories against current filesystem state (mark stale if referenced files no longer exist).",
      inputSchema: {
        memory_id:           z.number().int().optional().describe("Specific memory ID or null for batch"),
        domain:              z.string().optional().describe("Domain filter"),
        directory:           z.string().optional().describe("Directory filter"),
        base_dir:            z.string().default("").describe("Base directory for path resolution"),
        staleness_threshold: z.number().min(0).max(1).default(VALIDATE_STALENESS_DEFAULT).describe("Heat threshold for stale mark"),
        dry_run:             z.boolean().default(false).describe("Preview without writing"),
      },
    },
    async (args) => {
      try {
        // source: cortex@ed33435 mcp_server/handlers/validate_memory.py::_handler_impl
        const storeExt = deps.store as unknown as {
          getAllMemoriesForDecay?: () => Array<Record<string, unknown>>;
        };
        const allMems = storeExt.getAllMemoriesForDecay?.() ?? [];

        const candidates = args.memory_id !== undefined
          ? allMems.filter((m) => m["id"] === args.memory_id)
          : allMems.filter((m) => {
              if (args.domain && m["domain"] !== args.domain) return false;
              if (args.directory && !String(m["directory"] ?? "").startsWith(args.directory)) return false;
              return true;
            });

        let validated = 0;
        let staleMarked = 0;
        const errors: string[] = [];

        for (const mem of candidates) {
          try {
            validated++;
            const heat = (mem["heat"] as number | undefined) ?? 0;
            if (heat >= args.staleness_threshold) continue;

            const tags = (mem["tags"] as string[] | undefined) ?? [];
            const fileRef = tags.find((t) => t.startsWith("file:") || t.startsWith("path:"));
            if (!fileRef) continue;

            const filePath = fileRef.replace(/^(?:file:|path:)/, "");
            const absPath = args.base_dir ? join(args.base_dir, filePath) : filePath;
            if (existsSync(absPath)) continue;

            if (!args.dry_run) {
              deps.store.markMemoryStale(Number(mem["id"]), true);
            }
            staleMarked++;
          } catch (e) {
            errors.push(String(e));
          }
        }

        return { content: [{ type: "text" as const, text: JSON.stringify({
          validated,
          stale_marked: staleMarked,
          dry_run:      args.dry_run,
          errors:       errors.slice(0, VALIDATE_ERROR_CAP),
        }) }] };
      } catch (err) {
        return errorText("validate_memory", err);
      }
    },
  );

  // ── seed_project ──────────────────────────────────────────────────────────
  server.registerTool(
    "seed_project",
    {
      description: "Bootstrap memory from an existing codebase by scanning files and creating structured memories.",
      inputSchema: {
        directory:        z.string().default("").describe("Project directory to seed from"),
        domain:           z.string().default("").describe("Domain to assign"),
        max_file_size_kb: z.number().int().min(1).default(SEED_MAX_FILE_SIZE_KB).describe("Max file size in KB"),
        dry_run:          z.boolean().default(false).describe("Preview without writing"),
      },
    },
    async (_args) => {
      try {
        // source: cortex@ed33435 mcp_server/handlers/seed_project.py::_handler_impl
        // Blocked: requires mcp_server/core/file_scanner.py — filesystem scanner
        // not yet ported. Use codebase_analyze instead.
        throw new PortPendingError(
          "seed_project",
          "mcp_server/core/file_scanner.py — filesystem scanner not yet ported; use codebase_analyze instead",
        );
      } catch (err) {
        return errorText("seed_project", err);
      }
    },
  );

  // ── backfill_memories ─────────────────────────────────────────────────────
  server.registerTool(
    "backfill_memories",
    {
      description: "Auto-import prior Claude Code conversation JSONL files, applying Ebbinghaus-decay initial heat.",
      inputSchema: {
        project:         z.string().default("").describe("Project identifier"),
        max_files:       z.number().int().min(1).default(BACKFILL_MAX_FILES_DEFAULT).describe("Max JSONL files to process"),
        // source: Ebbinghaus retention curve — min_importance threshold of 0.35
        // per MCP_TOOLS.md §backfill_memories default
        min_importance:  z.number().min(0).max(1).default(BACKFILL_MIN_IMPORTANCE).describe("Minimum importance score"),
        dry_run:         z.boolean().default(false).describe("Preview without writing"),
        force_reprocess: z.boolean().default(false).describe("Reprocess already-imported files"),
      },
    },
    async (args) => {
      try {
        // source: packages/memory/src/import/handler.ts::importHandler
        const rememberFn = (rawArgs: unknown): Promise<{ stored: true } | null> => {
          const result = remember(rawArgs, deps.store);
          return Promise.resolve(result.stored ? { stored: true as const } : null);
        };

        const response = await importHandler(
          {
            project:        args.project,
            domain:         "",
            min_importance: args.min_importance,
            max_sessions:   args.max_files,
            dry_run:        args.dry_run,
          },
          rememberFn,
        );
        return { content: [{ type: "text" as const, text: JSON.stringify({
          backfilled:      response.imported,
          skipped:         response.skipped,
          files_processed: response.total_files,
          dry_run:         args.dry_run,
        }) }] };
      } catch (err) {
        return errorText("backfill_memories", err);
      }
    },
  );

  // ── codebase_analyze ──────────────────────────────────────────────────────
  server.registerTool(
    "codebase_analyze",
    {
      description: "Analyze codebase and store structural memories (functions, classes, imports, relationships).",
      inputSchema: {
        directory:        z.string().default("").describe("Directory to analyze"),
        languages:        z.array(z.string()).optional().describe("Languages to analyze (null = auto)"),
        max_files:        z.number().int().min(1).default(CODEBASE_MAX_FILES).describe("Max files to analyze"),
        max_file_size_kb: z.number().int().min(1).default(CODEBASE_MAX_FILE_SIZE_KB).describe("Max file size in KB"),
        incremental:      z.boolean().default(true).describe("Incremental analysis (skip unchanged)"),
        dry_run:          z.boolean().default(false).describe("Preview without storing"),
        domain:           z.string().default("").describe("Domain to assign"),
      },
    },
    async (args) => {
      try {
        // source: packages/memory/src/codebase-analysis/handlers/codebase-analyze.ts
        const analyzeDeps: codebaseAnalysis.CodebaseAnalyzeDeps = { store: deps.store };
        const result = await codebaseAnalysis.codebaseAnalyzeHandler(
          args as Record<string, unknown>,
          analyzeDeps,
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (err) {
        return errorText("codebase_analyze", err);
      }
    },
  );

  // ── get_methodology_graph ─────────────────────────────────────────────────
  server.registerTool(
    "get_methodology_graph",
    {
      description: "Returns methodology map as graph data for 3D visualisation.",
      inputSchema: {
        domain: z.string().optional().describe("Domain to visualise"),
      },
    },
    async (args) => {
      try {
        // source: cortex@ed33435 mcp_server/handlers/get_methodology_graph.py::handler
        const profiles = loadProfilesRaw();
        const domains = (profiles["domains"] ?? {}) as Record<string, Record<string, unknown>>;

        const nodes: Array<Record<string, unknown>> = [];
        const edges: Array<Record<string, unknown>> = [];
        let edgeId = 0;

        for (const [id, domain] of Object.entries(domains)) {
          if (args.domain && id !== args.domain) continue;
          nodes.push({
            id,
            label:         domain["label"] ?? id,
            session_count: domain["sessionCount"] ?? 0,
            confidence:    domain["confidence"] ?? 0,
          });

          const bridges = (domain["connectionBridges"] ?? []) as Array<Record<string, unknown>>;
          for (const bridge of bridges) {
            const target = bridge["targetDomain"] as string | undefined;
            if (!target) continue;
            edges.push({
              id:          edgeId++,
              source:      id,
              target,
              bridge_type: bridge["bridgeType"] ?? "unknown",
              strength:    bridge["strength"] ?? 0,
            });
          }
        }

        return { content: [{ type: "text" as const, text: JSON.stringify({ nodes, edges }) }] };
      } catch (err) {
        return errorText("get_methodology_graph", err);
      }
    },
  );
}
