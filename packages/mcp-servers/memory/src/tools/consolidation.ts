/**
 * consolidation.ts — MCP tool adapters for the consolidation + session topic.
 *
 * Tools registered (4):
 *   consolidate, checkpoint, memory_stats, record_session_end
 *
 * source: worktrees/port-inventory-cortex/inventory/MCP_TOOLS.md
 *         §Tier1Memory (consolidate, checkpoint, memory_stats)
 *         §Tier1Core (record_session_end)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ── Error envelope helper ─────────────────────────────────────────────────────

function errorText(tool: string, err: unknown): { content: Array<{ type: "text"; text: string }> } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: `${tool}: ${message}` }) }] };
}

// ── registerConsolidationTools ────────────────────────────────────────────────

/**
 * Registers consolidation and session lifecycle MCP tools.
 *
 * source: MCP_TOOLS.md §"consolidate", §"checkpoint", §"memory_stats",
 *         §"record_session_end"
 */
export function registerConsolidationTools(server: McpServer): void {
  // ── consolidate ───────────────────────────────────────────────────────────
  server.registerTool(
    "consolidate",
    {
      description:
        "Run memory maintenance pipeline: decay, compression, CLS transfer, memify, pruning.",
      inputSchema: {
        decay:    z.boolean().default(true).describe("Run decay cycle"),
        compress: z.boolean().default(true).describe("Run compression cycle"),
        cls:      z.boolean().default(true).describe("Run CLS transfer"),
        memify:   z.boolean().default(true).describe("Run memify cycle"),
        deep:     z.boolean().default(false).describe("Deep consolidation (slower)"),
      },
    },
    async (_args) => {
      try {
        // source: packages/memory/src/consolidation/handler.ts
        const response = {
          decayed:     0,
          compressed:  0,
          transferred: 0,
          memified:    0,
          pruned:      0,
          duration_ms: 0,
          note: "consolidate: ConsolidationStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("consolidate", err);
      }
    },
  );

  // ── checkpoint ────────────────────────────────────────────────────────────
  server.registerTool(
    "checkpoint",
    {
      description:
        "Save or restore working state for hippocampal replay.",
      inputSchema: {
        action:            z.enum(["save", "restore", "list"]).describe("Checkpoint action"),
        directory:         z.string().default("").describe("Project directory"),
        current_task:      z.string().default("").describe("Current task description"),
        files_being_edited: z.array(z.string()).default([]).describe("Files currently open"),
        key_decisions:     z.array(z.string()).default([]).describe("Key decisions made"),
        open_questions:    z.array(z.string()).default([]).describe("Open questions"),
        next_steps:        z.array(z.string()).default([]).describe("Planned next steps"),
        active_errors:     z.array(z.string()).default([]).describe("Active errors"),
        custom_context:    z.string().default("").describe("Extra context"),
        session_id:        z.string().default("default").describe("Session ID"),
      },
    },
    async (args) => {
      try {
        const response = {
          action: args.action,
          note: "checkpoint: MemoryStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("checkpoint", err);
      }
    },
  );

  // ── memory_stats ──────────────────────────────────────────────────────────
  server.registerTool(
    "memory_stats",
    {
      description:
        "Memory system diagnostics — counts, heat distribution, store sizes.",
      inputSchema: {},
    },
    async (_args) => {
      try {
        const response = {
          total_memories:     0,
          domains:            [],
          heat_histogram:     {},
          store_type_counts:  {},
          note: "memory_stats: MemoryStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("memory_stats", err);
      }
    },
  );

  // ── record_session_end ────────────────────────────────────────────────────
  server.registerTool(
    "record_session_end",
    {
      description: "Incremental EMA profile update after a session ends.",
      inputSchema: {
        session_id:  z.string().min(1).describe("Session identifier"),
        domain:      z.string().optional().describe("Cognitive domain"),
        tools_used:  z.array(z.string()).optional().describe("Tools used in this session"),
        duration:    z.number().optional().describe("Session duration in seconds"),
        turn_count:  z.number().int().optional().describe("Number of conversation turns"),
        keywords:    z.array(z.string()).optional().describe("Session keywords"),
        cwd:         z.string().optional().describe("Working directory"),
        project:     z.string().optional().describe("Project identifier"),
      },
    },
    async (args) => {
      try {
        const response = {
          updated:    false,
          domain:     null,
          session_id: args.session_id,
          note: "record_session_end: ProfilesStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("record_session_end", err);
      }
    },
  );
}
