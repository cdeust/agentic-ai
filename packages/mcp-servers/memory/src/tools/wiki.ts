/**
 * wiki.ts — MCP tool adapters for the wiki topic.
 *
 * Tools registered (8):
 *   wiki_write, wiki_read, wiki_list, wiki_link, wiki_adr,
 *   wiki_reindex, wiki_purge, wiki_verify
 *
 * Phase 7 Group D — DI wiring: WikiDeps are constructed from filesystem
 * wiki-store primitives and injected into each handler. No stub paths remain.
 *
 * source: worktrees/port-inventory-cortex/inventory/MCP_TOOLS.md §WikiTools
 * source: packages/memory/src/wiki/handlers/ (all eight handlers)
 * source: packages/memory/src/wiki/storage/wiki-store.ts (filesystem primitives)
 */

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { handler as wikiWriteHandler } from "@agentic/memory/wiki/handlers/wiki-write.js";
import { handler as wikiReadHandler } from "@agentic/memory/wiki/handlers/wiki-read.js";
import { handler as wikiListHandler } from "@agentic/memory/wiki/handlers/wiki-list.js";
import { handler as wikiLinkHandler } from "@agentic/memory/wiki/handlers/wiki-link.js";
import { handler as wikiAdrHandler } from "@agentic/memory/wiki/handlers/wiki-adr.js";
import { handler as wikiReindexHandler } from "@agentic/memory/wiki/handlers/wiki-reindex.js";
import { handler as wikiPurgeHandler } from "@agentic/memory/wiki/handlers/wiki-purge.js";
import { handler as wikiVerifyHandler } from "@agentic/memory/wiki/handlers/wiki-verify.js";
import {
  readPage as fsReadPage,
  writePage as fsWritePage,
  listPages as fsListPages,
  nextAdrNumber as fsNextAdrNumber,
} from "@agentic/memory/wiki/storage/wiki-store.js";

// ── Wiki root path ────────────────────────────────────────────────────────────
//
// source: cortex@ed33435 mcp_server/infrastructure/config.py
//   WIKI_ROOT = ~/.claude/methodology/wiki
const WIKI_ROOT: string = process.env["CORTEX_WIKI_ROOT"] ??
  join(homedir(), ".claude", "methodology", "wiki");

// ── Sync→async adapters for wiki-store primitives ─────────────────────────────
//
// Wiki handler interfaces expect async deps. The wiki-store primitives are sync.
// These adapters lift sync calls to Promise.resolve() so the handler contracts
// are satisfied without introducing I/O runtime changes.
//
// source: Martin, R. C. (2017). Clean Architecture, Ch. 11 — adapters transform
//   between incompatible interface shapes without changing behaviour.

async function asyncReadPage(root: string, relPath: string): Promise<string | null> {
  return Promise.resolve(fsReadPage(root, relPath));
}

async function asyncWritePage(
  root: string,
  relPath: string,
  content: string,
  mode: string,
): Promise<{ path: string; mode: string; created: boolean; bytes_written: number }> {
  return Promise.resolve(fsWritePage(root, relPath, content, mode));
}

async function asyncListPages(root: string, kind?: string | null): Promise<string[]> {
  return Promise.resolve(fsListPages(root, kind as Parameters<typeof fsListPages>[1]));
}

async function asyncNextAdrNumber(root: string): Promise<number> {
  return Promise.resolve(fsNextAdrNumber(root));
}

async function asyncWriteFile(absPath: string, content: string): Promise<void> {
  const dir = dirname(resolve(absPath));
  mkdirSync(dir, { recursive: true });
  writeFileSync(absPath, content, "utf-8");
}

async function asyncEnsureDir(absDir: string): Promise<void> {
  mkdirSync(absDir, { recursive: true });
}

async function asyncListAllMarkdownFiles(
  root: string,
  kindFilter?: string | null,
): Promise<Array<{ relPath: string; content: string }>> {
  const paths = await asyncListPages(root, kindFilter);
  const entries: Array<{ relPath: string; content: string }> = [];
  for (const relPath of paths) {
    const content = await asyncReadPage(root, relPath);
    if (content !== null) entries.push({ relPath, content });
  }
  return entries;
}

async function asyncDeleteFile(absPath: string): Promise<void> {
  try { rmSync(absPath); } catch { /* best effort */ }
}

// source: ADR-0046 Phase 2 — AP symbol verification deferred until AP graph is live
// source: docs/ADR/0046-change-impact-analysis.md §Phase 2
const AP_ENABLED = false;

// ── Error envelope helper ─────────────────────────────────────────────────────

function errorText(tool: string, err: unknown): { content: Array<{ type: "text"; text: string }> } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: `${tool}: ${message}` }) }] };
}

// ── registerWikiTools ─────────────────────────────────────────────────────────

/**
 * Registers all 8 wiki MCP tools.
 *
 * precondition:  WIKI_ROOT directory exists or will be created on first write.
 * postcondition: 8 tools registered; each body calls the real domain handler.
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
        // source: packages/memory/src/wiki/handlers/wiki-write.ts::handler
        const response = await wikiWriteHandler(
          { path: args.path, content: args.content, mode: args.mode, tags: args.tags },
          { wikiRoot: WIKI_ROOT, writePage: asyncWritePage },
        );
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
        // source: packages/memory/src/wiki/handlers/wiki-read.ts::handler
        const response = await wikiReadHandler(
          { path: args.path },
          { wikiRoot: WIKI_ROOT, readPage: asyncReadPage },
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
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
    async (args) => {
      try {
        // source: packages/memory/src/wiki/handlers/wiki-list.ts::handler
        const response = await wikiListHandler(
          { kind: args.kind as Parameters<typeof wikiListHandler>[0]["kind"] },
          { wikiRoot: WIKI_ROOT, listPages: asyncListPages },
        );
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
      description: "Add a bidirectional link between two wiki pages (creates Related section entry).",
      inputSchema: {
        from_path: z.string().min(1).describe("Source page path"),
        to_path:   z.string().min(1).describe("Target page path"),
        relation:  z.string().min(1).describe("Relationship label"),
      },
    },
    async (args) => {
      try {
        // source: packages/memory/src/wiki/handlers/wiki-link.ts::handler
        const response = await wikiLinkHandler(
          { from_path: args.from_path, to_path: args.to_path, relation: args.relation },
          { wikiRoot: WIKI_ROOT, readPage: asyncReadPage, writePage: asyncWritePage },
        );
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
      description: "Create a numbered ADR (Architecture Decision Record) with auto-incremented sequence.",
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
        // source: packages/memory/src/wiki/handlers/wiki-adr.ts::handler
        const response = await wikiAdrHandler(
          {
            title:        args.title,
            context:      args.context,
            decision:     args.decision,
            consequences: args.consequences,
            status:       args.status,
            tags:         args.tags,
          },
          {
            wikiRoot:      WIKI_ROOT,
            nextAdrNumber: asyncNextAdrNumber,
            writePage:     asyncWritePage,
          },
        );
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
      description: "Regenerate the wiki table of contents at .generated/INDEX.md.",
      inputSchema: {},
    },
    async (_args) => {
      try {
        // source: packages/memory/src/wiki/handlers/wiki-reindex.ts::handler
        const response = await wikiReindexHandler(
          {},
          {
            wikiRoot:  WIKI_ROOT,
            listPages: asyncListPages,
            writeFile: asyncWriteFile,
            ensureDir: asyncEnsureDir,
            joinPath:  join,
          },
        );
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
      description: "Re-evaluate and purge wiki pages that fail the current classifier.",
      inputSchema: {
        apply: z.boolean().default(false).describe("Apply purge (false = preview only)"),
        kind:  z.string().optional().describe("Page kind to target"),
      },
    },
    async (args) => {
      try {
        // source: packages/memory/src/wiki/handlers/wiki-purge.ts::handler
        const response = await wikiPurgeHandler(
          {
            apply: args.apply,
            kind:  args.kind as Parameters<typeof wikiPurgeHandler>[0]["kind"],
          },
          {
            wikiRoot:             WIKI_ROOT,
            wikiRoot_string:      WIKI_ROOT,
            listAllMarkdownFiles: asyncListAllMarkdownFiles,
            deleteFile:           asyncDeleteFile,
          },
        );
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
      description: "Verify wiki-page symbol citations against AP's code graph (ADR-0046 Phase 2).", // source: docs/ADR/0046-change-impact-analysis.md §Phase 2
      inputSchema: {
        path: z.string().optional().describe("Page path (null = all pages)"),
      },
    },
    async (args) => {
      try {
        // source: packages/memory/src/wiki/handlers/wiki-verify.ts::handler
        // source: docs/ADR/0046-change-impact-analysis.md §Phase 2 — AP disabled
        const response = await wikiVerifyHandler(
          { path: args.path ?? null },
          {
            wikiRoot:      WIKI_ROOT,
            isApEnabled:   () => AP_ENABLED,
            readPage:      asyncReadPage,
            listPages:     asyncListPages,
            // source: docs/ADR/0046-change-impact-analysis.md §Phase 2 — stub until AP live
            verifySymbols: async (_symbols) => ({}),
          },
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
      } catch (err) {
        return errorText("wiki_verify", err);
      }
    },
  );
}
