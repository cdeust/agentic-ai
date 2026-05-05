/**
 * Wiki API handler — route dispatch for wiki REST endpoints.
 *
 * Exposes the DB-backed and filesystem-backed wiki endpoints as a single
 * MCP handler that accepts an endpoint name + params dict.
 *
 * Endpoints:
 *   list        — enumerate .md files
 *   page        — read one .md file
 *   page_meta   — thermo state + citations + backlinks for one page
 *   concepts    — list candidate/saturating/promoted concepts
 *   drafts      — list drafts, filter by status/kind
 *   memos       — audit trail for a subject
 *   views       — list available views
 *   view        — execute a view by name
 *   save        — write a page body (editor path)
 *   bibliography — list/read .bib files
 *
 * All endpoints return safely (never throw) and degrade gracefully when
 * the DB is unavailable.
 *
 * source: mcp_server/handlers/wiki_api.py (Cortex ed33435)
 */

import * as path from "node:path";
import type { WikiDbClient } from "../storage/pg-wiki-store-pages.js";
import { listPages, readPage, writePage } from "../storage/wiki-store.js";
import { parsePage } from "../pages.js";

// Max body size for save endpoint (2 MB)
// source: mcp_server/handlers/wiki_api.py:387
const SAVE_BODY_MAX_BYTES = 2_000_000;

// Default list limit for API endpoints
// source: mcp_server/handlers/wiki_api.py:175
const API_DEFAULT_LIMIT = 100;

export interface WikiApiArgs {
  readonly endpoint?: string | null;
  readonly params?: Record<string, unknown> | null;
  // Flat shortcuts (match Python API shape)
  readonly rel_path?: string | null;
  readonly status?: string | null;
  readonly kind?: string | null;
  readonly limit?: number | null;
  readonly subject_type?: string | null;
  readonly subject_id?: number | null;
  readonly name?: string | null;
  readonly query?: string | null;
  readonly body?: string | null;
  readonly wiki_root?: string | null;
  [key: string]: unknown;
}

export type WikiApiResult = Record<string, unknown>;

// ── Helper: rows to plain JSON ────────────────────────────────────────────

function rowsToPlain(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((r) => {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      if (v instanceof Date) clean[k] = v.toISOString();
      else if (v instanceof Uint8Array) clean[k] = Buffer.from(v).toString("hex");
      else clean[k] = v;
    }
    return clean;
  });
}

// ── Endpoint implementations ──────────────────────────────────────────────

/**
 * List all wiki pages with parsed frontmatter.
 * source: mcp_server/handlers/wiki_api.py:31-54 (list_wiki_pages)
 */
function listWikiPages(wikiRoot: string): WikiApiResult {
  const relPaths = listPages(wikiRoot);
  const result: Record<string, unknown>[] = [];
  for (const relPath of relPaths) {
    const content = readPage(wikiRoot, relPath);
    if (content === null) continue;
    const doc = parsePage(content);
    const fm = doc.frontmatter as Record<string, unknown>;
    const stem = path.basename(relPath, ".md");
    result.push({
      path: relPath,
      title: fm["title"] ?? stem,
      kind: fm["kind"] ?? "",
      domain: fm["domain"] ?? "",
      maturity: fm["maturity"] ?? "",
      tags: fm["tags"] ?? [],
      created: String(fm["created"] ?? ""),
      updated: String(fm["updated"] ?? ""),
    });
  }
  return { pages: result, count: result.length };
}

/**
 * Read a single wiki page.
 * source: mcp_server/handlers/wiki_api.py:57-69 (read_wiki_page)
 */
function readWikiPage(wikiRoot: string, relPath: string): WikiApiResult {
  if (!relPath || relPath.includes("/../") || relPath.startsWith("../") || relPath.includes("\x00")) {
    return { error: "invalid path" };
  }
  const content = readPage(wikiRoot, relPath);
  if (content === null) return { error: "not found", path: relPath };
  const doc = parsePage(content);
  return { path: relPath, meta: doc.frontmatter, body: doc.body };
}

/**
 * DB-backed: page_meta (thermo state + links + citations).
 * source: mcp_server/handlers/wiki_api.py:104-170 (page_meta)
 */
async function pageMeta(db: WikiDbClient, relPath: string): Promise<WikiApiResult> {
  if (!relPath || relPath.includes("/../") || relPath.startsWith("../")) {
    return { error: "invalid path" };
  }
  const pageR = await db.query(
    `SELECT id, title, kind, domain, status, lifecycle_state,
            heat, access_count, citation_count, backlink_count,
            is_stale, planted, tended, last_cited_at, archived_at,
            memory_id, concept_id
       FROM wiki.pages WHERE rel_path = $1 LIMIT 1`,
    [relPath],
  );
  if (!pageR.rows.length) return { rel_path: relPath, db_row: null };

  const page = pageR.rows[0] as Record<string, unknown>;
  const pageId = page["id"] as number;

  const backlinksR = await db.query(
    `SELECT src_page_id, dst_slug, dst_page_id, link_kind,
            (SELECT title FROM wiki.pages WHERE id = l.src_page_id) AS src_title,
            (SELECT rel_path FROM wiki.pages WHERE id = l.src_page_id) AS src_rel_path
       FROM wiki.links l WHERE dst_page_id = $1 LIMIT 100`, // source: mcp_server/handlers/wiki_api.py:145 (backlinks cap)
    [pageId],
  );
  const outLinksR = await db.query(
    "SELECT dst_slug, dst_page_id, link_kind FROM wiki.links WHERE src_page_id = $1 LIMIT 100", // source: mcp_server/handlers/wiki_api.py:152
    [pageId],
  );
  const citationsR = await db.query(
    `SELECT id, session_id, domain, memory_id, cited_at
       FROM wiki.citations WHERE page_id = $1 ORDER BY cited_at DESC LIMIT 20`,
    [pageId],
  );

  return {
    rel_path: relPath,
    db_row: rowsToPlain([page])[0],
    backlinks: rowsToPlain(backlinksR.rows as Record<string, unknown>[]),
    outbound_links: rowsToPlain(outLinksR.rows as Record<string, unknown>[]),
    recent_citations: rowsToPlain(citationsR.rows as Record<string, unknown>[]),
  };
}

/**
 * DB-backed: list concepts.
 * source: mcp_server/handlers/wiki_api.py:173-194 (list_concepts)
 */
async function listConceptsEndpoint(
  db: WikiDbClient,
  status: string | null,
  limit: number,
): Promise<WikiApiResult> {
  let r: { rows: Record<string, unknown>[] };
  if (status) {
    r = await db.query(
      `SELECT id, label, status, saturation_streak,
              array_length(entity_ids, 1) AS n_entities,
              array_length(grounding_memory_ids, 1) AS n_memories,
              array_length(grounding_claim_ids, 1) AS n_claims,
              promoted_page_id
         FROM wiki.concepts WHERE status = $1
         ORDER BY saturation_streak DESC NULLS LAST, id DESC LIMIT $2`,
      [status, limit],
    );
  } else {
    r = await db.query(
      `SELECT id, label, status, saturation_streak,
              array_length(entity_ids, 1) AS n_entities,
              array_length(grounding_memory_ids, 1) AS n_memories,
              array_length(grounding_claim_ids, 1) AS n_claims,
              promoted_page_id
         FROM wiki.concepts
         ORDER BY saturation_streak DESC NULLS LAST, id DESC LIMIT $1`,
      [limit],
    );
  }
  const rows = rowsToPlain(r.rows as Record<string, unknown>[]);
  return { concepts: rows, count: rows.length };
}

/**
 * DB-backed: list drafts.
 * source: mcp_server/handlers/wiki_api.py:197-222 (list_drafts)
 */
async function listDraftsEndpoint(
  db: WikiDbClient,
  status: string | null,
  kind: string | null,
  limit: number,
): Promise<WikiApiResult> {
  const where: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (status) { where.push(`status = $${i++}`); params.push(status); }
  if (kind) { where.push(`kind = $${i++}`); params.push(kind); }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  params.push(limit);
  const r = await db.query(
    `SELECT id, concept_id, memory_id, kind, title, status,
            confidence, synth_model, created_at, reviewed_at, published_page_id
       FROM wiki.drafts ${whereSql}
       ORDER BY created_at DESC LIMIT $${i}`,
    params,
  );
  const rows = rowsToPlain(r.rows as Record<string, unknown>[]);
  return { drafts: rows, count: rows.length };
}

/**
 * DB-backed: list memos for a subject.
 * source: mcp_server/handlers/wiki_api.py:225-243 (list_memos)
 */
async function listMemosEndpoint(
  db: WikiDbClient,
  subjectType: string,
  subjectId: number,
  limit: number,
): Promise<WikiApiResult> {
  const validTypes = new Set(["page", "concept", "draft", "claim"]);
  if (!validTypes.has(subjectType)) {
    return { error: `invalid subject_type: ${JSON.stringify(subjectType)}`, memos: [] };
  }
  const r = await db.query(
    `SELECT id, decision, rationale, confidence, author, created_at, inputs
       FROM wiki.memos
      WHERE subject_type = $1 AND subject_id = $2
      ORDER BY created_at DESC LIMIT $3`,
    [subjectType, subjectId, limit],
  );
  const rows = rowsToPlain(r.rows as Record<string, unknown>[]);
  return { memos: rows, count: rows.length };
}

/**
 * Write a page body (editor endpoint).
 * source: mcp_server/handlers/wiki_api.py:373-400 (save_wiki_page)
 */
function saveWikiPage(wikiRoot: string, relPath: string, body: string): WikiApiResult {
  if (!relPath || typeof relPath !== "string") return { error: "rel_path required" };
  if (body == null) return { error: "body required" };
  if (body.length > SAVE_BODY_MAX_BYTES) return { error: "body too large (> 2 MB)" }; // source: mcp_server/handlers/wiki_api.py:387 (2 MB body cap)
  try {
    const result = writePage(wikiRoot, relPath, body, "replace");
    return { ok: true, rel_path: result.path, bytes_written: result.bytes_written, mode: result.mode };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Wiki API handler.
 *
 * Precondition:  endpoint is one of the recognised names.
 * Postcondition: routes to the appropriate endpoint function; returns its result.
 *   Never throws — errors become {error: string}.
 *
 * source: mcp_server/handlers/wiki_api.py — route dispatch pattern
 */
export async function wikiApiHandler(
  args: WikiApiArgs,
  db: WikiDbClient,
): Promise<WikiApiResult> {
  const endpoint = args.endpoint ?? "list";
  const wikiRoot = typeof args.wiki_root === "string" && args.wiki_root
    ? args.wiki_root
    : process.cwd();
  const p = args.params ?? {};
  const relPath = (typeof args.rel_path === "string" ? args.rel_path : (p["rel_path"] as string | undefined)) ?? null;
  const statusArg = (typeof args.status === "string" ? args.status : (p["status"] as string | undefined)) ?? null;
  const kindArg = (typeof args.kind === "string" ? args.kind : (p["kind"] as string | undefined)) ?? null;
  const limitArg = typeof args.limit === "number" ? args.limit : (typeof p["limit"] === "number" ? p["limit"] : API_DEFAULT_LIMIT); // source: mcp_server/handlers/wiki_api.py:175 (default list limit)
  const subjectType = (typeof args.subject_type === "string" ? args.subject_type : (p["subject_type"] as string | undefined)) ?? "";
  const subjectId = typeof args.subject_id === "number" ? args.subject_id : (typeof p["subject_id"] === "number" ? p["subject_id"] : 0);

  try {
    switch (endpoint) {
      case "list":
        return listWikiPages(wikiRoot);

      case "page":
        if (!relPath) return { error: "rel_path required" };
        return readWikiPage(wikiRoot, relPath);

      case "page_meta":
        if (!relPath) return { error: "rel_path required" };
        return pageMeta(db, relPath);

      case "concepts":
        return listConceptsEndpoint(db, statusArg, limitArg);

      case "drafts":
        return listDraftsEndpoint(db, statusArg, kindArg, limitArg);

      case "memos":
        if (!subjectType || !subjectId) return { error: "subject_type and subject_id required" };
        return listMemosEndpoint(db, subjectType, subjectId, limitArg);

      case "save": {
        const bodyArg = (typeof args.body === "string" ? args.body : (p["body"] as string | undefined)) ?? null;
        if (!relPath) return { error: "rel_path required" };
        if (!bodyArg) return { error: "body required" };
        return saveWikiPage(wikiRoot, relPath, bodyArg);
      }

      default:
        return {
          error: `unknown endpoint: ${JSON.stringify(endpoint)}`,
          available: ["list", "page", "page_meta", "concepts", "drafts", "memos", "save"],
        };
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
