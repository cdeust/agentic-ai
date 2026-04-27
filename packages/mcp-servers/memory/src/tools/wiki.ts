/**
 * wiki.ts — MCP tool adapters for the wiki topic.
 *
 * Tools registered (8):
 *   wiki_write, wiki_read, wiki_list, wiki_link, wiki_adr,
 *   wiki_reindex, wiki_purge, wiki_verify
 *
 * source: worktrees/port-inventory-cortex/inventory/MCP_TOOLS.md §WikiTools
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// ── Error envelope helper ─────────────────────────────────────────────────────

function errorText(tool: string, err: unknown): { content: Array<{ type: "text"; text: string }> } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: `${tool}: ${message}` }) }] };
}

// ── registerWikiTools ─────────────────────────────────────────────────────────

/**
 * Registers all 8 wiki MCP tools.
 *
 * source: MCP_TOOLS.md §"wiki_write" through §"wiki_verify"
 */
export function registerWikiTools(server: McpServer): void {
  // ── wiki_write ────────────────────────────────────────────────────────────
  server.registerTool(
    "wiki_write",
    {
      description: "Author a wiki page (create/append/replace) with provided Markdown.",
      inputSchema: {
        path:    z.string().min(1).describe("Wiki page path (relative)"),
        content: z.string().min(1).describe("Markdown content"),
        mode:    z.enum(["create", "append", "replace"]).default("create").describe("Write mode"),
        tags:    z.array(z.string()).default([]).describe("Page tags"),
      },
    },
    async (args) => {
      try {
        const response = {
          path:    args.path,
          page_id: null,
          created: false,
          note: "wiki_write: WikiStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("wiki_write", err);
      }
    },
  );

  // ── wiki_read ─────────────────────────────────────────────────────────────
  server.registerTool(
    "wiki_read",
    {
      description: "Read the raw Markdown of a wiki page by relative path.",
      inputSchema: {
        path: z.string().min(1).describe("Wiki page path"),
      },
    },
    async (args) => {
      try {
        return {
          content: [{
            type: "text" as const,
            text: `_wiki_read: WikiStore adapter not yet injected (Phase 5 stub). path=${args.path}_`,
          }],
        };
      } catch (err) {
        return errorText("wiki_read", err);
      }
    },
  );

  // ── wiki_list ─────────────────────────────────────────────────────────────
  server.registerTool(
    "wiki_list",
    {
      description: "List authored wiki pages, optionally filtered by kind.",
      inputSchema: {
        kind: z.string().optional().describe("Page kind filter"),
      },
    },
    async (_args) => {
      try {
        const response = {
          pages: [],
          note: "wiki_list: WikiStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("wiki_list", err);
      }
    },
  );

  // ── wiki_link ─────────────────────────────────────────────────────────────
  server.registerTool(
    "wiki_link",
    {
      description:
        "Add a bidirectional link between two wiki pages (creates Related section entry).",
      inputSchema: {
        from_path: z.string().min(1).describe("Source page path"),
        to_path:   z.string().min(1).describe("Target page path"),
        relation:  z.string().min(1).describe("Relationship label"),
      },
    },
    async (args) => {
      try {
        const response = {
          linked:       false,
          from_page_id: null,
          to_page_id:   null,
          relation:     args.relation,
          note: "wiki_link: WikiStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("wiki_link", err);
      }
    },
  );

  // ── wiki_adr ──────────────────────────────────────────────────────────────
  server.registerTool(
    "wiki_adr",
    {
      description:
        "Create a numbered ADR (Architecture Decision Record) with auto-incremented sequence.",
      inputSchema: {
        title:        z.string().min(1).describe("ADR title"),
        context:      z.string().min(1).describe("Problem context"),
        decision:     z.string().min(1).describe("Decision made"),
        consequences: z.string().min(1).describe("Consequences"),
        status:       z.enum(["proposed", "accepted", "deprecated", "superseded"]).default("accepted").describe("ADR status"),
        tags:         z.array(z.string()).default([]).describe("Tags"),
      },
    },
    async (args) => {
      try {
        const response = {
          path:       null,
          adr_number: null,
          page_id:    null,
          title:      args.title,
          note: "wiki_adr: WikiStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("wiki_adr", err);
      }
    },
  );

  // ── wiki_reindex ──────────────────────────────────────────────────────────
  server.registerTool(
    "wiki_reindex",
    {
      description:
        "Regenerate the wiki table of contents at .generated/INDEX.md.",
      inputSchema: {},
    },
    async (_args) => {
      try {
        const response = {
          pages_indexed: 0,
          index_path:    null,
          note: "wiki_reindex: WikiStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("wiki_reindex", err);
      }
    },
  );

  // ── wiki_purge ────────────────────────────────────────────────────────────
  server.registerTool(
    "wiki_purge",
    {
      description:
        "Re-evaluate and purge wiki pages that fail the current classifier.",
      inputSchema: {
        apply: z.boolean().default(false).describe("Apply purge (false = preview only)"),
        kind:  z.string().optional().describe("Page kind to target"),
      },
    },
    async (_args) => {
      try {
        const response = {
          candidates: [],
          purged:     0,
          note: "wiki_purge: WikiStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("wiki_purge", err);
      }
    },
  );

  // ── wiki_verify ───────────────────────────────────────────────────────────
  server.registerTool(
    "wiki_verify",
    {
      description:
        "Verify wiki-page symbol citations against AP's code graph (ADR-0046 Phase 2).",
      inputSchema: {
        path: z.string().optional().describe("Page path (null = all pages)"),
      },
    },
    async (_args) => {
      try {
        const response = {
          verified:         0,
          broken_citations: [],
          missing_symbols:  [],
          note: "wiki_verify: WikiStore adapter not yet injected (Phase 5 stub)",
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("wiki_verify", err);
      }
    },
  );
}
