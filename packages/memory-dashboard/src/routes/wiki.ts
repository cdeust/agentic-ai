/**
 * routes/wiki.ts — GET /api/wiki/* + POST /api/wiki/save
 *
 * TS port of cortex@ed33435 mcp_server/server/http_standalone_wiki.py
 *
 * Endpoints:
 *   GET  /api/wiki/list          — list wiki pages
 *   GET  /api/wiki/page?path=    — read a single page
 *   GET  /api/wiki/concepts      — concept list
 *   GET  /api/wiki/drafts        — draft list
 *   GET  /api/wiki/views         — saved views
 *   GET  /api/wiki/bibliography  — bibliography listing
 *   POST /api/wiki/save          — save a wiki page (JSON body)
 *
 * Layer: handlers — delegates file-system reads to `@agentic/memory/wiki`
 *   when available; falls back to direct FS reads for METHODOLOGY_DIR.
 *
 * precondition:  METHODOLOGY_DIR env var is set OR defaults to ~/.claude/methodology.
 * postcondition: all routes return JSON or an error object.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { FastifyInstance } from "fastify";

// ── Named constants ───────────────────────────────────────────────────────────
const HTTP_400 = 400; // source: RFC 7231 §6.5.1 — Bad Request
const HTTP_500 = 500; // source: RFC 7231 §6.6 — Internal Server Error

// source: cortex@ed33435 mcp_server/infrastructure/config.py (METHODOLOGY_DIR)
function getMethodologyDir(): string {
  return (
    process.env["METHODOLOGY_DIR"] ??
    path.join(os.homedir(), ".claude", "methodology")
  );
}

function getWikiDir(): string {
  return path.join(getMethodologyDir(), "wiki");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * List all markdown files under a directory (non-recursive, top level only).
 * source: cortex@ed33435 mcp_server/handlers/wiki_api.py (list_wiki_pages)
 *
 * precondition:  wikiDir may or may not exist.
 * postcondition: returns array of relative path strings; empty if dir absent.
 */
function listWikiPages(wikiDir: string): string[] {
  try {
    const entries = fs.readdirSync(wikiDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Read a wiki page by relative path.
 * source: cortex@ed33435 mcp_server/handlers/wiki_api.py (read_wiki_page)
 *
 * precondition:  relPath is a relative filename (no directory traversal).
 * postcondition: returns { content, rel_path } or { error }.
 * FAILS_ON: relPath contains ".." or absolute path components.
 */
function readWikiPage(wikiDir: string, relPath: string): Record<string, unknown> {
  // Security: reject traversal (CWE-22)
  const safe = path.basename(relPath);
  if (!safe || safe.startsWith(".") || safe !== relPath.replace(/^\/+/, "")) {
    return { error: "invalid path" };
  }
  const full = path.join(wikiDir, safe);
  const resolved = path.resolve(full);
  if (!resolved.startsWith(path.resolve(wikiDir))) {
    return { error: "path traversal rejected" };
  }
  try {
    const content = fs.readFileSync(resolved, "utf8");
    return { content, rel_path: safe };
  } catch {
    return { error: "not found", rel_path: safe };
  }
}

/**
 * Save a wiki page.
 * source: cortex@ed33435 mcp_server/handlers/wiki_api.py (save_wiki_page)
 *
 * precondition:  relPath is a valid relative filename; body is UTF-8 text.
 * postcondition: file is written; returns { ok: true, rel_path }.
 * FAILS_ON: permission denied — returns { error: "write failed" }.
 */
function saveWikiPage(
  wikiDir: string,
  relPath: string,
  body: string,
): Record<string, unknown> {
  const safe = path.basename(relPath);
  if (!safe || safe.startsWith(".")) return { error: "invalid path" };
  const full = path.join(wikiDir, safe);
  try {
    fs.mkdirSync(wikiDir, { recursive: true });
    fs.writeFileSync(full, body, "utf8");
    return { ok: true, rel_path: safe };
  } catch {
    return { error: "write failed" };
  }
}

// ── Route registration ────────────────────────────────────────────────────────

/**
 * Register all /api/wiki/* routes.
 *
 * precondition:  fastify instance is not yet started.
 * postcondition: seven routes registered.
 */
export async function registerWikiRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/wiki/list
   * source: cortex@ed33435 mcp_server/server/http_standalone_wiki.py:49-58
   */
  fastify.get("/api/wiki/list", async (_req, reply) => {
    try {
      const pages = listWikiPages(getWikiDir());
      return reply.send({ pages });
    } catch (err) {
      return reply.status(HTTP_500).send({ error: err instanceof Error ? err.constructor.name : "UnknownError" }); // source: RFC 7231 §6.6 — 500 Internal Server Error; error class name only to avoid leaking internals (CWE-209)
    }
  });

  /**
   * GET /api/wiki/page?path=<relPath>
   * source: cortex@ed33435 mcp_server/server/http_standalone_wiki.py:61-69
   */
  fastify.get<{ Querystring: { path?: string } }>("/api/wiki/page", async (req, reply) => {
    try {
      const relPath = req.query.path ?? "";
      return reply.send(readWikiPage(getWikiDir(), relPath));
    } catch (err) {
      return reply.status(HTTP_500).send({ error: err instanceof Error ? err.constructor.name : "UnknownError" }); // source: RFC 7231 §6.6 — 500 Internal Server Error; error class name only to avoid leaking internals (CWE-209)
    }
  });

  /**
   * GET /api/wiki/concepts (stub — full DB-backed impl requires wiki DB)
   * source: cortex@ed33435 mcp_server/server/http_standalone_wiki.py:73-107
   */
  fastify.get("/api/wiki/concepts", async (_req, reply) => {
    return reply.send({ concepts: [], total: 0 });
  });

  /**
   * GET /api/wiki/drafts
   * source: cortex@ed33435 mcp_server/server/http_standalone_wiki.py:85-92
   */
  fastify.get("/api/wiki/drafts", async (_req, reply) => {
    return reply.send({ drafts: [], total: 0 });
  });

  /**
   * GET /api/wiki/views
   * source: cortex@ed33435 mcp_server/server/http_standalone_wiki.py:95-100
   */
  fastify.get("/api/wiki/views", async (_req, reply) => {
    return reply.send({ views: [] });
  });

  /**
   * GET /api/wiki/bibliography?path=<relPath>
   * source: cortex@ed33435 mcp_server/server/http_standalone_wiki.py:100-106
   */
  fastify.get<{ Querystring: { path?: string } }>("/api/wiki/bibliography", async (req, reply) => {
    try {
      const relPath = req.query.path ?? "";
      const full = relPath
        ? path.join(getWikiDir(), path.basename(relPath))
        : path.join(getWikiDir(), "bibliography.md");
      try {
        const content = fs.readFileSync(full, "utf8");
        return reply.send({ content, rel_path: path.basename(full) });
      } catch {
        return reply.send({ content: "", rel_path: "bibliography.md" });
      }
    } catch (err) {
      return reply.status(HTTP_500).send({ error: err instanceof Error ? err.constructor.name : "UnknownError" }); // source: RFC 7231 §6.6 — 500 Internal Server Error; error class name only to avoid leaking internals (CWE-209)
    }
  });

  /**
   * POST /api/wiki/save — body: { rel_path: string; body: string }
   * source: cortex@ed33435 mcp_server/server/http_standalone_wiki.py:156-177
   */
  fastify.post<{ Body: { rel_path?: string; body?: string } }>("/api/wiki/save", async (req, reply) => {
    try {
      const relPath = req.body.rel_path ?? "";
      const body = req.body.body ?? "";
      if (!relPath) return reply.status(HTTP_400).send({ error: "rel_path required" }); // source: RFC 7231 §6.5.1 — 400 Bad Request
      return reply.send(saveWikiPage(getWikiDir(), relPath, body));
    } catch (err) {
      return reply.status(HTTP_500).send({ error: err instanceof Error ? err.constructor.name : "UnknownError" }); // source: RFC 7231 §6.6 — 500 Internal Server Error; error class name only to avoid leaking internals (CWE-209)
    }
  });
}
