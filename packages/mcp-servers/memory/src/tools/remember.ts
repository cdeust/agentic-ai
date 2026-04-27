/**
 * remember.ts — MCP tool adapters for the memory write topic.
 *
 * Tools registered (4):
 *   remember, forget, anchor, rate_memory
 *
 * source: worktrees/port-inventory-cortex/inventory/MCP_TOOLS.md
 *         §Tier1Memory (remember), §Tier1Manage (forget, anchor, rate_memory)
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ── Error envelope helper ─────────────────────────────────────────────────────

function errorText(tool: string, err: unknown): { content: Array<{ type: "text"; text: string }> } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: `${tool}: ${message}` }) }] };
}

// ── registerRememberTools ─────────────────────────────────────────────────────

/**
 * Registers the 4 memory-write MCP tools onto the given server instance.
 *
 * source: MCP_TOOLS.md §"remember", §"forget", §"anchor", §"rate_memory"
 */
export function registerRememberTools(server: McpServer): void {
  // ── remember ──────────────────────────────────────────────────────────────
  server.registerTool(
    "remember",
    {
      description:
        "Store a memory through the predictive coding write gate.",
      inputSchema: {
        content:    z.string().min(1).describe("Memory content to store"),
        tags:       z.array(z.string()).default([]).describe("Tags for categorisation"),
        directory:  z.string().default("").describe("Project directory"),
        domain:     z.string().optional().describe("Cognitive domain"),
        source:     z.enum(["session", "tool", "user", "consolidation", "import"]).default("user").describe("Memory source"),
        force:      z.boolean().default(false).describe("Bypass write gate"),
        agent_topic: z.string().default("").describe("Agent topic scope"),
      },
    },
    async (args) => {
      try {
        // source: packages/memory/src/remember/handlers/remember.ts::remember
        const response = {
          stored: false,
          note: "remember: MemoryStore adapter not yet injected (Phase 5 stub)",
          content_preview: args.content.slice(0, 80),
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("remember", err);
      }
    },
  );

  // ── forget ────────────────────────────────────────────────────────────────
  server.registerTool(
    "forget",
    {
      description: "Delete or soft-delete a memory by integer ID.",
      inputSchema: {
        memory_id: z.number().int().min(1).describe("Memory ID to delete"),
        soft:      z.boolean().default(false).describe("Soft-delete (archive rather than purge)"),
        force:     z.boolean().default(false).describe("Force delete even if protected"),
      },
    },
    async (args) => {
      try {
        const response = {
          deleted: false,
          archived: false,
          memory_id: args.memory_id,
          note: "forget: MemoryStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("forget", err);
      }
    },
  );

  // ── anchor ────────────────────────────────────────────────────────────────
  server.registerTool(
    "anchor",
    {
      description:
        "Mark a memory as compaction-resistant (heat_base=1.0, no_decay=true, is_protected=true).",
      inputSchema: {
        memory_id: z.number().int().min(1).describe("Memory ID to anchor"),
        reason:    z.string().default("").describe("Reason for anchoring"),
      },
    },
    async (args) => {
      try {
        const response = {
          memory_id: args.memory_id,
          anchored: false,
          note: "anchor: MemoryStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("anchor", err);
      }
    },
  );

  // ── rate_memory ───────────────────────────────────────────────────────────
  server.registerTool(
    "rate_memory",
    {
      description:
        "Rate a memory as useful or not to update metamemory confidence and useful_count.",
      inputSchema: {
        memory_id: z.number().int().min(1).describe("Memory ID to rate"),
        useful:    z.boolean().describe("Whether the memory was useful"),
      },
    },
    async (args) => {
      try {
        const response = {
          memory_id:   args.memory_id,
          useful_count: 0,
          confidence:  0.5,
          note: "rate_memory: MemoryStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("rate_memory", err);
      }
    },
  );
}
