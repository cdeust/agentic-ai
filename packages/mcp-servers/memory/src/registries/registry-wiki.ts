/**
 * registry-wiki.ts — Wiki authoring tool registry (8 tools).
 * Exact portage of: cortex@ed33435 mcp_server/tool_registry_wiki.py
 * source: cortex@ed33435 mcp_server/tool_registry_wiki.py::register
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { handler as wikiWriteHandler }   from "@agentic/memory/wiki/handlers/wiki-write.js";
import { handler as wikiReadHandler }    from "@agentic/memory/wiki/handlers/wiki-read.js";
import { handler as wikiListHandler }    from "@agentic/memory/wiki/handlers/wiki-list.js";
import { handler as wikiLinkHandler }    from "@agentic/memory/wiki/handlers/wiki-link.js";
import { handler as wikiAdrHandler }     from "@agentic/memory/wiki/handlers/wiki-adr.js";
import { handler as wikiReindexHandler } from "@agentic/memory/wiki/handlers/wiki-reindex.js";
import { handler as wikiPurgeHandler }   from "@agentic/memory/wiki/handlers/wiki-purge.js";
import { handler as wikiVerifyHandler }  from "@agentic/memory/wiki/handlers/wiki-verify.js";
import { readPage as fsReadPage, writePage as fsWritePage, listPages as fsListPages, nextAdrNumber as fsNextAdrNumber } from "@agentic/memory/wiki/storage/wiki-store.js";

// source: cortex@ed33435 mcp_server/infrastructure/config.py — WIKI_ROOT
const WIKI_ROOT: string = process.env["CORTEX_WIKI_ROOT"] ?? join(homedir(), ".claude", "methodology", "wiki");

async function asyncReadPage(root: string, relPath: string): Promise<string | null> { return Promise.resolve(fsReadPage(root, relPath)); }
async function asyncWritePage(root: string, relPath: string, content: string, mode: string): Promise<{ path: string; mode: string; created: boolean; bytes_written: number }> { return Promise.resolve(fsWritePage(root, relPath, content, mode)); }
async function asyncListPages(root: string, kind?: string | null): Promise<string[]> { return Promise.resolve(fsListPages(root, kind as Parameters<typeof fsListPages>[1])); }
async function asyncNextAdrNumber(root: string): Promise<number> { return Promise.resolve(fsNextAdrNumber(root)); }
async function asyncWriteFile(absPath: string, content: string): Promise<void> { const dir = dirname(resolve(absPath)); mkdirSync(dir, { recursive: true }); writeFileSync(absPath, content, "utf-8"); }
async function asyncEnsureDir(absDir: string): Promise<void> { mkdirSync(absDir, { recursive: true }); }
async function asyncListAllMarkdownFiles(root: string, kindFilter?: string | null): Promise<Array<{ relPath: string; content: string }>> { const paths = await asyncListPages(root, kindFilter); const entries: Array<{ relPath: string; content: string }> = []; for (const relPath of paths) { const content = await asyncReadPage(root, relPath); if (content !== null) entries.push({ relPath, content }); } return entries; }
async function asyncDeleteFile(absPath: string): Promise<void> { try { rmSync(absPath); } catch { /* best-effort */ } }

// source: docs/ADR/0046-change-impact-analysis.md §Phase 2 — AP symbol verification deferred
const AP_ENABLED = false;

function errorText(tool: string, err: unknown): { content: Array<{ type: "text"; text: string }> } {
  const message = err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: `${tool}: ${message}` }) }] };
}

/**
 * Register all 8 wiki authoring tools.
 * precondition:  WIKI_ROOT directory exists or will be created on first write.
 * postcondition: 8 tools registered; each dispatches to the real domain handler.
 * source: cortex@ed33435 mcp_server/tool_registry_wiki.py::register
 */
export function register(server: McpServer): void {
  server.registerTool("wiki_write", { description: "Author a wiki page (create/append/replace) with the provided markdown.", inputSchema: { path: z.string().min(1), content: z.string().min(1), mode: z.enum(["create", "append", "replace"]).default("create"), tags: z.array(z.string()).default([]) } }, async (args) => { try { const response = await wikiWriteHandler({ path: args.path, content: args.content, mode: args.mode, tags: args.tags }, { wikiRoot: WIKI_ROOT, writePage: asyncWritePage }); return { content: [{ type: "text" as const, text: JSON.stringify(response) }] }; } catch (err) { return errorText("wiki_write", err); } });
  server.registerTool("wiki_read", { description: "Read the raw markdown of a wiki page by relative path.", inputSchema: { path: z.string().min(1) } }, async (args) => { try { const response = await wikiReadHandler({ path: args.path }, { wikiRoot: WIKI_ROOT, readPage: asyncReadPage }); return { content: [{ type: "text" as const, text: JSON.stringify(response) }] }; } catch (err) { return errorText("wiki_read", err); } });
  server.registerTool("wiki_list", { description: "List authored wiki pages, optionally filtered by kind.", inputSchema: { kind: z.string().optional() } }, async (args) => { try { const response = await wikiListHandler({ kind: args.kind as Parameters<typeof wikiListHandler>[0]["kind"] }, { wikiRoot: WIKI_ROOT, listPages: asyncListPages }); return { content: [{ type: "text" as const, text: JSON.stringify(response) }] }; } catch (err) { return errorText("wiki_list", err); } });
  server.registerTool("wiki_link", { description: "Add a bidirectional link between two wiki pages (Related section).", inputSchema: { from_path: z.string().min(1), to_path: z.string().min(1), relation: z.string().min(1) } }, async (args) => { try { const response = await wikiLinkHandler({ from_path: args.from_path, to_path: args.to_path, relation: args.relation }, { wikiRoot: WIKI_ROOT, readPage: asyncReadPage, writePage: asyncWritePage }); return { content: [{ type: "text" as const, text: JSON.stringify(response) }] }; } catch (err) { return errorText("wiki_link", err); } });
  server.registerTool("wiki_adr", { description: "Create a numbered ADR with auto-incremented sequence.", inputSchema: { title: z.string().min(1), context: z.string().min(1), decision: z.string().min(1), consequences: z.string().min(1), status: z.enum(["proposed", "accepted", "deprecated", "superseded"]).default("accepted"), tags: z.array(z.string()).default([]) } }, async (args) => { try { const response = await wikiAdrHandler({ title: args.title, context: args.context, decision: args.decision, consequences: args.consequences, status: args.status, tags: args.tags }, { wikiRoot: WIKI_ROOT, nextAdrNumber: asyncNextAdrNumber, writePage: asyncWritePage }); return { content: [{ type: "text" as const, text: JSON.stringify(response) }] }; } catch (err) { return errorText("wiki_adr", err); } });
  server.registerTool("wiki_reindex", { description: "Regenerate the wiki table of contents at .generated/INDEX.md.", inputSchema: {} }, async (_args) => { try { const response = await wikiReindexHandler({}, { wikiRoot: WIKI_ROOT, listPages: asyncListPages, writeFile: asyncWriteFile, ensureDir: asyncEnsureDir, joinPath: join }); return { content: [{ type: "text" as const, text: JSON.stringify(response) }] }; } catch (err) { return errorText("wiki_reindex", err); } });
  server.registerTool("wiki_purge", { description: "Re-evaluate and purge wiki pages that fail the current classifier.", inputSchema: { apply: z.boolean().default(false), kind: z.string().optional() } }, async (args) => { try { const response = await wikiPurgeHandler({ apply: args.apply, kind: args.kind as Parameters<typeof wikiPurgeHandler>[0]["kind"] }, { wikiRoot: WIKI_ROOT, wikiRoot_string: WIKI_ROOT, listAllMarkdownFiles: asyncListAllMarkdownFiles, deleteFile: asyncDeleteFile }); return { content: [{ type: "text" as const, text: JSON.stringify(response) }] }; } catch (err) { return errorText("wiki_purge", err); } });
  server.registerTool("wiki_verify", { description: "Verify wiki-page symbol citations against AP's code graph (ADR-0046 Phase 2).", // source: docs/ADR/0046-change-impact-analysis.md §Phase 2
    inputSchema: { path: z.string().optional() } }, async (args) => { try { const response = await wikiVerifyHandler({ path: args.path ?? null }, { wikiRoot: WIKI_ROOT, isApEnabled: () => AP_ENABLED, readPage: asyncReadPage, listPages: asyncListPages, verifySymbols: async (_symbols) => ({}) }); return { content: [{ type: "text" as const, text: JSON.stringify(response) }] }; } catch (err) { return errorText("wiki_verify", err); } });
}
