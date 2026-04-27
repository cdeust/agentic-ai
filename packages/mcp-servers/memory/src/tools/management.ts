/**
 * management.ts — MCP tool adapters for the memory management topic.
 *
 * Tools registered (5):
 *   validate_memory, seed_project, backfill_memories, codebase_analyze,
 *   get_methodology_graph
 *
 * source: worktrees/port-inventory-cortex/inventory/MCP_TOOLS.md
 *         §Tier1Manage, §Tier1Core (get_methodology_graph)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ── Error envelope helper ─────────────────────────────────────────────────────

function errorText(tool: string, err: unknown): { content: Array<{ type: "text"; text: string }> } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: `${tool}: ${message}` }) }] };
}

// ── registerManagementTools ───────────────────────────────────────────────────

/**
 * Registers memory management MCP tools.
 *
 * source: MCP_TOOLS.md §"validate_memory", §"seed_project",
 *         §"backfill_memories", §"codebase_analyze", §"get_methodology_graph"
 */
export function registerManagementTools(server: McpServer): void {
  // ── validate_memory ───────────────────────────────────────────────────────
  server.registerTool(
    "validate_memory",
    {
      description:
        "Validate memories against current filesystem state (mark stale if referenced files no longer exist).",
      inputSchema: {
        memory_id:          z.number().int().optional().describe("Specific memory ID or null for batch"),
        domain:             z.string().optional().describe("Domain filter"),
        directory:          z.string().optional().describe("Directory filter"),
        base_dir:           z.string().default("").describe("Base directory for path resolution"),
        staleness_threshold: z.number().min(0).max(1).default(0.5).describe("Heat threshold for stale mark"),
        dry_run:            z.boolean().default(false).describe("Preview without writing"),
      },
    },
    async (_args) => {
      try {
        const response = {
          validated:    0,
          stale_marked: 0,
          errors:       [],
          note: "validate_memory: MemoryStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("validate_memory", err);
      }
    },
  );

  // ── seed_project ──────────────────────────────────────────────────────────
  server.registerTool(
    "seed_project",
    {
      description:
        "Bootstrap memory from an existing codebase by scanning files and creating structured memories.",
      inputSchema: {
        directory:       z.string().default("").describe("Project directory to seed from"),
        domain:          z.string().default("").describe("Domain to assign"),
        max_file_size_kb: z.number().int().min(1).default(64).describe("Max file size in KB"),
        dry_run:         z.boolean().default(false).describe("Preview without writing"),
      },
    },
    async (_args) => {
      try {
        const response = {
          seeded:  0,
          skipped: 0,
          errors:  [],
          note: "seed_project: MemoryStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("seed_project", err);
      }
    },
  );

  // ── backfill_memories ─────────────────────────────────────────────────────
  server.registerTool(
    "backfill_memories",
    {
      description:
        "Auto-import prior Claude Code conversation JSONL files, applying Ebbinghaus-decay initial heat.",
      inputSchema: {
        project:          z.string().default("").describe("Project identifier"),
        max_files:        z.number().int().min(1).default(20).describe("Max JSONL files to process"),
        // source: Ebbinghaus retention curve — min_importance threshold of 0.35
        // per MCP_TOOLS.md §backfill_memories default
        min_importance:   z.number().min(0).max(1).default(0.35).describe("Minimum importance score"),
        dry_run:          z.boolean().default(false).describe("Preview without writing"),
        force_reprocess:  z.boolean().default(false).describe("Reprocess already-imported files"),
      },
    },
    async (_args) => {
      try {
        const response = {
          backfilled:      0,
          skipped:         0,
          files_processed: 0,
          note: "backfill_memories: MemoryStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("backfill_memories", err);
      }
    },
  );

  // ── codebase_analyze ──────────────────────────────────────────────────────
  server.registerTool(
    "codebase_analyze",
    {
      description:
        "Analyze codebase and store structural memories (functions, classes, imports, relationships).",
      inputSchema: {
        directory:       z.string().default("").describe("Directory to analyze"),
        languages:       z.array(z.string()).optional().describe("Languages to analyze (null = auto)"),
        max_files:       z.number().int().min(1).default(500).describe("Max files to analyze"),
        max_file_size_kb: z.number().int().min(1).default(100).describe("Max file size in KB"),
        incremental:     z.boolean().default(true).describe("Incremental analysis (skip unchanged)"),
        dry_run:         z.boolean().default(false).describe("Preview without storing"),
        domain:          z.string().default("").describe("Domain to assign"),
      },
    },
    async (_args) => {
      try {
        const response = {
          analyzed:         0,
          memories_created: 0,
          entities_created: 0,
          note: "codebase_analyze: MemoryStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("codebase_analyze", err);
      }
    },
  );

  // ── get_methodology_graph ─────────────────────────────────────────────────
  server.registerTool(
    "get_methodology_graph",
    {
      description:
        "Returns methodology map as graph data for 3D visualisation.",
      inputSchema: {
        domain: z.string().optional().describe("Domain to visualise"),
      },
    },
    async (_args) => {
      try {
        const response = {
          nodes: [],
          edges: [],
          note: "get_methodology_graph: ProfilesStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("get_methodology_graph", err);
      }
    },
  );
}
