/**
 * Wiki filesystem → DB migration handler.
 *
 * One-shot idempotent job: walk the wiki folder, parse every .md file,
 * upsert into wiki.pages, then resolve [[slug]] references into wiki.links.
 * Re-running is safe — body_hash guards against redundant writes.
 *
 * source: mcp_server/handlers/wiki_migrate.py (Cortex ed33435)
 * source: mcp_server/infrastructure/pg_store_wiki.py (upsertPage, upsertLink, etc.)
 */

import * as path from "node:path";
import type { WikiDbClient } from "../storage/pg-wiki-store-pages.js";
import {
  upsertPage,
  upsertLink,
  deleteLinksFrom,
  resolveUnresolvedLinks,
  bodyHash,
} from "../storage/pg-wiki-store-pages.js";
import { listPages, readPage } from "../storage/wiki-store.js";
import { parsePage } from "../pages.js";
// slugify is used in pageRowFromMd via the KindDefinition lookup — not needed here directly

// source: mcp_server/handlers/wiki_migrate.py:30 (_WIKILINK_RE)
// Wiki-link syntax: [[slug]] or [[slug|display text]]
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?]]/g;

// Min path components for domain extraction (kind/domain/slug.md = 3 parts)
// source: mcp_server/handlers/wiki_migrate.py:79 (path structure)
const MIN_PATH_PARTS_FOR_DOMAIN = 3;

// Max errors to report in migration summary
// source: mcp_server/handlers/wiki_migrate.py:219 (errors[:10])
const MIGRATE_MAX_ERRORS = 10;

export interface WikiMigrateArgs {
  readonly wiki_root?: string | null;
  readonly target_version?: string | null;
  [key: string]: unknown;
}

export interface WikiMigrateResult {
  readonly pages_processed: number;
  readonly pages_written: number;
  readonly pages_unchanged: number;
  readonly links_written: number;
  readonly links_resolved_pass3: number;
  readonly errors: string[];
  readonly error_count: number;
}

/**
 * Extract the slug from a rel_path like ``adr/cortex/42-foo.md``.
 * source: mcp_server/handlers/wiki_migrate.py:33-40 (_slug_from_rel_path)
 *
 * Postcondition: returns the filename stem with optional ``<id>-`` prefix stripped.
 */
function slugFromRelPath(relPath: string): string {
  const stem = path.basename(relPath, ".md");
  const m = /^\d+-(.+)$/.exec(stem);
  return m ? (m[1] ?? stem) : stem;
}

/**
 * Extract [[slug]] targets from a body of text.
 * source: mcp_server/handlers/wiki_migrate.py:108-110 (_extract_wikilinks)
 *
 * Postcondition: returns list of unique slug strings matched.
 */
function extractWikilinks(body: string): string[] {
  const out: string[] = [];
  const re = new RegExp(WIKILINK_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

/**
 * Split a body into (lead, sections_by_heading).
 * source: mcp_server/handlers/wiki_migrate.py:43-59 (_extract_body_sections)
 *
 * Postcondition: lead = text before first ## heading; sections = heading → body.
 */
function extractBodySections(body: string): [string, Record<string, string>] {
  const parts = body.split(/^##\s+(.+)$/m);
  let lead = (parts[0] ?? "").trim();
  const sections: Record<string, string> = {};
  for (let i = 1; i < parts.length - 1; i += 2) {
    const heading = (parts[i] ?? "").trim();
    const sBody = (parts[i + 1] ?? "").trim();
    sections[heading] = sBody;
  }
  // Strip any leading H1
  lead = lead.replace(/^#\s+.+?\n/, "").trim();
  return [lead, sections];
}

/**
 * Infer memory_id from a filename like ``<int>-<slug>.md``.
 * source: mcp_server/handlers/wiki_migrate.py:113-120 (_memory_id_from_rel_path)
 */
function memoryIdFromRelPath(relPath: string): number | null {
  const stem = path.basename(relPath, ".md");
  const m = /^(\d+)-/.exec(stem);
  if (!m) return null;
  const n = parseInt(m[1] ?? "", 10);
  return isNaN(n) ? null : n;
}

/**
 * Return the subset of ids that exist in the memories table.
 * source: mcp_server/handlers/wiki_migrate.py:125-143 (_existing_memory_ids)
 */
async function existingMemoryIds(db: WikiDbClient, ids: Set<number>): Promise<Set<number>> {
  if (!ids.size) return new Set();
  const r = await db.query<{ id: number }>(
    "SELECT id FROM memories WHERE id = ANY($1)",
    [[...ids]],
  );
  return new Set(r.rows.map((row) => row.id));
}

/**
 * Build an upsertPage payload from a parsed markdown file.
 * source: mcp_server/handlers/wiki_migrate.py:62-105 (_page_row_from_md)
 */
function pageRowFromMd(
  relPath: string,
  content: string,
  memoryId: number | null,
): Parameters<typeof upsertPage>[1] {
  const doc = parsePage(content);
  const fm = doc.frontmatter as Record<string, unknown>;
  const body = doc.body ?? "";
  const [lead, sections] = extractBodySections(body);
  const slug = slugFromRelPath(relPath);

  // Kind: prefer frontmatter; fall back to top-level folder (singular)
  const pathKind = relPath.includes("/") ? (relPath.split("/")[0] ?? "") : "";
  const kind = (typeof fm["kind"] === "string" ? fm["kind"] : null) ?? pathKind.replace(/s$/, "");

  // Domain: second path component, or frontmatter, or '_general'
  const parts = relPath.split("/");
  const domain = (typeof fm["domain"] === "string" ? fm["domain"] : null)
    ?? (parts.length >= MIN_PATH_PARTS_FOR_DOMAIN ? (parts[1] ?? "_general") : "_general");

  let tags = fm["tags"] ?? [];
  if (typeof tags === "string") tags = [tags];
  const tagsArr = Array.isArray(tags) ? (tags as unknown[]).map(String) : [];

  return {
    memory_id: memoryId,
    rel_path: relPath,
    slug,
    kind: kind || "note",
    title: (typeof fm["title"] === "string" ? fm["title"] : null) ?? slug,
    domain,
    domains: [domain],
    tags: tagsArr,
    audience: Array.isArray(fm["audience"]) ? (fm["audience"] as unknown[]).map(String) : [],
    requires: Array.isArray(fm["requires"]) ? (fm["requires"] as unknown[]).map(String) : [],
    status:
      (typeof fm["status"] === "string" ? fm["status"] : null) ??
      (typeof fm["maturity"] === "string" ? fm["maturity"] : null) ??
      "seedling",
    lifecycle_state:
      (typeof fm["lifecycle_state"] === "string" ? fm["lifecycle_state"] : null) ?? "active",
    supersedes: typeof fm["supersedes"] === "string" ? fm["supersedes"] : null,
    superseded_by: typeof fm["superseded_by"] === "string" ? fm["superseded_by"] : null,
    verified: typeof fm["verified"] === "string" ? fm["verified"] : null,
    lead,
    sections,
    body,
    body_hash: bodyHash(body),
  };
}

/**
 * Walk the wiki folder and mirror every .md into wiki.pages + wiki.links.
 *
 * Three passes:
 *   1. Upsert all pages (records each slug → id).
 *   2. Re-scan bodies for [[slug]] refs → upsert into wiki.links.
 *   3. Call resolveUnresolvedLinks to catch stragglers.
 *
 * source: mcp_server/handlers/wiki_migrate.py:146-220 (migrate_wiki)
 *
 * Precondition: db is non-null; wikiRoot is a readable directory.
 * Postcondition: all .md files are upserted to wiki.pages; wiki.links are
 *   populated for [[slug]] references; returns real counts.
 */
async function migrateWiki(
  db: WikiDbClient,
  wikiRoot: string,
): Promise<WikiMigrateResult> {
  const relPaths = listPages(wikiRoot);
  let pagesWritten = 0;
  let pagesUnchanged = 0;
  let linksWritten = 0;
  const errors: string[] = [];

  // Pre-pass: filter candidate memory_ids to those that exist
  const candidateIds = new Set<number>();
  for (const rp of relPaths) {
    const mid = memoryIdFromRelPath(rp);
    if (mid != null) candidateIds.add(mid);
  }
  const validIds = await existingMemoryIds(db, candidateIds);

  // Pass 1 — upsert every page
  const idByRel: Record<string, number> = {};
  for (const rp of relPaths) {
    try {
      const content = readPage(wikiRoot, rp);
      if (content === null) continue;
      const mid = memoryIdFromRelPath(rp);
      const safeMid = (mid != null && validIds.has(mid)) ? mid : null;
      const row = pageRowFromMd(rp, content, safeMid);
      const [pageId, wasModified] = await upsertPage(db, row);
      idByRel[rp] = pageId;
      if (wasModified) pagesWritten++;
      else pagesUnchanged++;
    } catch (err) {
      errors.push(`${rp}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Pass 2 — scan bodies for [[slug]] → wiki.links
  for (const [rp, pageId] of Object.entries(idByRel)) {
    try {
      const content = readPage(wikiRoot, rp);
      if (content === null) continue;
      const doc = parsePage(content);
      const body = doc.body ?? "";
      const targets = extractWikilinks(body);
      if (!targets.length) continue;
      await deleteLinksFrom(db, pageId);
      for (const slug of new Set(targets)) {
        await upsertLink(db, pageId, slug, "inline");
        linksWritten++;
      }
    } catch (err) {
      errors.push(`${rp} links: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Pass 3 — resolve leftover unresolved slugs
  const resolved = await resolveUnresolvedLinks(db);

  return {
    pages_processed: relPaths.length,
    pages_written: pagesWritten,
    pages_unchanged: pagesUnchanged,
    links_written: linksWritten,
    links_resolved_pass3: resolved,
    errors: errors.slice(0, MIGRATE_MAX_ERRORS),
    error_count: errors.length,
  };
}

/**
 * Wiki migrate handler.
 *
 * Precondition:  db is non-null; wikiRoot is a readable directory.
 * Postcondition: all wiki pages are mirrored into wiki.pages and wiki.links;
 *   returns real counts.
 *
 * source: mcp_server/handlers/wiki_migrate.py:223-231
 */
export async function wikiMigrateHandler(
  args: WikiMigrateArgs,
  db: WikiDbClient,
): Promise<WikiMigrateResult> {
  const wikiRoot = typeof args.wiki_root === "string" && args.wiki_root
    ? args.wiki_root
    : process.cwd();
  return migrateWiki(db, wikiRoot);
}
