/**
 * Wiki Phase 2.5 — Compile approved drafts to .md files (handler).
 *
 * For every approved draft that has not yet been published:
 *   1. Resolve the target domain (from source memory or '_general').
 *   2. Compile draft → (rel_path, markdown, frontmatter).
 *   3. Write via the caller-supplied writePageFn (atomic write).
 *   4. Upsert wiki.pages with the new content.
 *   5. Transition draft status approved → published.
 *   6. Memo the publication event.
 *
 * Includes an inline port of mcp_server/core/draft_compiler.py
 * (compileDraft + deriveRelPath) since that module has no TS counterpart.
 *
 * source: mcp_server/handlers/wiki_compile.py (Cortex ed33435)
 * source: mcp_server/core/draft_compiler.py (compile_draft, derive_rel_path)
 */

import type { WikiDbClient } from "../storage/pg-wiki-store-pages.js";
import {
  upsertPage,
  bodyHash,
} from "../storage/pg-wiki-store-pages.js";
import {
  getDraft,
  listDrafts,
  updateDraftStatus,
  insertMemo,
} from "../storage/pg-wiki-store-concepts.js";
import { slugify } from "../layout.js";

// source: mcp_server/handlers/wiki_compile.py:80 — default publish limit
const COMPILE_DEFAULT_LIMIT = 100;

// source: mcp_server/handlers/wiki_compile.py:185 — errors capped at 10
const COMPILE_MAX_ERRORS = 10;

// source: mcp_server/core/draft_compiler.py:35-48 — frontmatter key order
const FRONTMATTER_KEYS_ORDER = [
  "title", "kind", "domain", "domains", "tags", "audience", "requires",
  "status", "lifecycle_state", "supersedes", "superseded_by", "verified",
  "concept_id", "memory_id", "draft_id", "synth_model", "created", "updated",
] as const;

// Max domain slug length — source: mcp_server/core/wiki_layout.py:slugify max_len default for domain
const DOMAIN_SLUG_MAX_LEN = 40;

// Dry-run preview truncation length
// source: mcp_server/handlers/wiki_compile.py:129
const DRY_RUN_PREVIEW_LEN = 280;

// Default confidence when draft doesn't specify
// source: mcp_server/handlers/wiki_compile.py:180
const DEFAULT_DRAFT_CONFIDENCE = 0.5;

// Max errors to report
// source: mcp_server/handlers/wiki_compile.py:221 (errors[:10])
const COMPILE_MAX_RESULTS = 10;

// source: mcp_server/core/draft_compiler.py:115-124 — kind → directory
const KIND_TO_DIR: Readonly<Record<string, string>> = {
  adr: "adr",
  spec: "specs",
  lesson: "lessons",
  convention: "conventions",
  note: "notes",
  guide: "guides",
  reference: "reference",
};

export interface WikiCompileArgs {
  readonly draft_id?: number | null;
  readonly dry_run?: boolean | null;
  readonly limit?: number | null;
  [key: string]: unknown;
}

export interface WikiCompileResult {
  readonly drafts_published: number;
  readonly results: Record<string, unknown>[];
  readonly errors: string[];
  readonly error_count: number;
  readonly dry_run: boolean;
}

// ── Draft compiler (inline port) ─────────────────────────────────────────────

/**
 * Render a YAML inline value in the wiki frontmatter format.
 * source: mcp_server/core/draft_compiler.py:54-65 (_yaml_value)
 */
function yamlValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return "[" + v.map((x) => yamlValue(x).replace(/^"|"$/g, "")).join(", ") + "]";
  const s = String(v);
  if (s.includes(":") || s.includes("#") || s.includes("\n") || /^[[{?\-]/.test(s)) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

/**
 * Build frontmatter block from a meta dict.
 * source: mcp_server/core/draft_compiler.py:68-80 (_build_frontmatter)
 */
function buildFrontmatter(meta: Record<string, unknown>): string {
  const lines = ["---"];
  const seen = new Set<string>();
  for (const key of FRONTMATTER_KEYS_ORDER) {
    if (key in meta && meta[key] != null && meta[key] !== "") {
      lines.push(`${key}: ${yamlValue(meta[key])}`);
      seen.add(key);
    }
  }
  for (const [key, val] of Object.entries(meta)) {
    if (seen.has(key) || val == null || val === "") continue;
    lines.push(`${key}: ${yamlValue(val)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

/**
 * Compute the canonical filesystem path for a compiled page.
 * source: mcp_server/core/draft_compiler.py:97-130 (derive_rel_path)
 *
 * Precondition: kind, domain, title are strings; memory_id/concept_id may be null.
 * Postcondition: returns a stable, readable relative path for the page.
 */
function deriveRelPath(
  kind: string,
  domain: string,
  title: string,
  memoryId: number | null,
  conceptId: number | null,
): string {
  const titleSlug = slugify(title || "untitled");
  const domainSlug = slugify(domain || "_general", DOMAIN_SLUG_MAX_LEN);
  const folder = KIND_TO_DIR[kind] ?? "notes";
  const idPrefix = memoryId != null
    ? String(memoryId)
    : conceptId != null
      ? `c${conceptId}`
      : "x";
  return `${folder}/${domainSlug}/${idPrefix}-${titleSlug}.md`;
}

/**
 * Compile an approved draft to (rel_path, markdown, frontmatter).
 * source: mcp_server/core/draft_compiler.py:133-210 (compile_draft)
 *
 * Precondition: draft contains title, kind, lead, sections; domain is provided.
 * Postcondition: returns [relPath, markdownText, frontmatterDict]; the markdown
 *   contains the YAML frontmatter block, H1 title, lead, and all non-empty sections.
 */
function compileDraft(
  draft: Record<string, unknown>,
  domain: string,
): [string, string, Record<string, unknown>] {
  const title = typeof draft["title"] === "string" ? draft["title"] : "Untitled";
  const kind = typeof draft["kind"] === "string" ? draft["kind"] : "note";
  const lead = typeof draft["lead"] === "string" ? draft["lead"].trim() : "";
  const sections = Array.isArray(draft["sections"]) ? draft["sections"] as unknown[] : [];
  const fmExisting = (typeof draft["frontmatter"] === "object" && draft["frontmatter"] !== null)
    ? draft["frontmatter"] as Record<string, unknown>
    : {};

  const relPath = deriveRelPath(
    kind, domain, title,
    typeof draft["memory_id"] === "number" ? draft["memory_id"] : null,
    typeof draft["concept_id"] === "number" ? draft["concept_id"] : null,
  );

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const frontmatter: Record<string, unknown> = {
    title,
    kind,
    domain,
    status: fmExisting["status"] ?? "seedling",
    lifecycle_state: fmExisting["lifecycle_state"] ?? "active",
    memory_id: draft["memory_id"] ?? null,
    concept_id: draft["concept_id"] ?? null,
    draft_id: draft["id"] ?? null,
    synth_model: draft["synth_model"] ?? null,
    created: fmExisting["created"] ?? now,
    updated: now,
  };
  for (const [k, v] of Object.entries(fmExisting)) {
    if (!(k in frontmatter)) frontmatter[k] = v;
  }

  const bodyParts: string[] = [];
  bodyParts.push(`# ${title}\n`);
  if (lead) bodyParts.push(`${lead}\n`);

  for (const s of sections) {
    let heading: string | undefined;
    let sBody: string | undefined;
    if (typeof s === "object" && s !== null) {
      const sd = s as Record<string, unknown>;
      heading = typeof sd["heading"] === "string" ? sd["heading"] : undefined;
      sBody = typeof sd["body"] === "string" ? sd["body"] : "";
    }
    if (!heading) continue;
    bodyParts.push(`## ${heading}\n\n${(sBody ?? "").trim()}\n`);
  }

  let md =
    buildFrontmatter(frontmatter) +
    "\n\n" +
    bodyParts.join("\n");

  // Normalise trailing whitespace
  md = md.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";

  return [relPath, md, frontmatter];
}

/**
 * Resolve the domain of a source memory.
 * source: mcp_server/handlers/wiki_compile.py:99-109 (_domain_for_memory)
 *
 * Precondition: db is non-null.
 * Postcondition: returns the domain string or "_general" when not found.
 */
async function domainForMemory(
  db: WikiDbClient,
  memoryId: number | null,
): Promise<string> {
  if (memoryId == null) return "_general";
  const r = await db.query<{ domain: string | null }>(
    "SELECT domain FROM memories WHERE id = $1",
    [memoryId],
  );
  return (r.rows[0]?.domain) || "_general";
}

/**
 * Publish one draft: compile → write → upsert page → transition status → memo.
 * source: mcp_server/handlers/wiki_compile.py:119-188 (_publish_one)
 *
 * Precondition: draft is a non-null approved draft row; writePageFn is callable.
 * Postcondition: page file is written atomically; wiki.pages row is upserted;
 *   draft status is set to "published"; memo is written.
 *   Returns result dict with draft_id, page_id, rel_path, page_modified.
 */
async function publishOne(
  db: WikiDbClient,
  draft: Record<string, unknown>,
  dryRun: boolean,
  writePageFn: (relPath: string, content: string) => Promise<void>,
): Promise<Record<string, unknown>> {
  const memoryId = typeof draft["memory_id"] === "number" ? draft["memory_id"] : null;
  const domain = await domainForMemory(db, memoryId);
  const [relPath, markdown, frontmatter] = compileDraft(draft, domain);

  if (dryRun) {
    return {
      draft_id: draft["id"],
      rel_path: relPath,
      bytes: Buffer.byteLength(markdown, "utf-8"),
      preview: markdown.slice(0, DRY_RUN_PREVIEW_LEN), // source: mcp_server/handlers/wiki_compile.py:129 (preview truncation)
      dry_run: true,
    };
  }

  // 1. Write file
  await writePageFn(relPath, markdown);

  // 2. Upsert wiki.pages
  const fmDict = (typeof draft["frontmatter"] === "object" && draft["frontmatter"] !== null)
    ? draft["frontmatter"] as Record<string, unknown>
    : {};
  const sectionsForPage: Record<string, string> = {};
  const sections = Array.isArray(draft["sections"]) ? draft["sections"] as unknown[] : [];
  for (const s of sections) {
    if (typeof s === "object" && s !== null) {
      const sd = s as Record<string, unknown>;
      const h = typeof sd["heading"] === "string" ? sd["heading"] : "";
      const b = typeof sd["body"] === "string" ? sd["body"] : "";
      if (h) sectionsForPage[h] = b;
    }
  }

  const [pageId, wasModified] = await upsertPage(db, {
    memory_id: memoryId,
    concept_id: typeof draft["concept_id"] === "number" ? draft["concept_id"] : null,
    rel_path: relPath,
    slug: slugify(typeof draft["title"] === "string" ? draft["title"] : "untitled"),
    kind: typeof draft["kind"] === "string" ? draft["kind"] : "note",
    title: typeof draft["title"] === "string" ? draft["title"] : "Untitled",
    domain,
    domains: [domain],
    tags: Array.isArray(fmDict["tags"]) ? fmDict["tags"] as string[] : [],
    audience: Array.isArray(fmDict["audience"]) ? fmDict["audience"] as string[] : [],
    requires: Array.isArray(fmDict["requires"]) ? fmDict["requires"] as string[] : [],
    status: (frontmatter["status"] as string | undefined) ?? "seedling",
    lifecycle_state: (frontmatter["lifecycle_state"] as string | undefined) ?? "active",
    lead: typeof draft["lead"] === "string" ? draft["lead"].trim() : "",
    sections: sectionsForPage,
    body: markdown,
    body_hash: bodyHash(markdown),
  });

  // 3. Transition draft → published
  await updateDraftStatus(db, draft["id"] as number, "published", pageId);

  // 4. Memo
  await insertMemo(
    db,
    "page",
    pageId,
    "published_from_draft",
    `Compiled draft ${draft["id"]} (${draft["kind"]}) → ${relPath}`,
    [],
    {
      draft_id: draft["id"],
      synth_model: draft["synth_model"] ?? null,
      rel_path: relPath,
    },
    typeof draft["confidence"] === "number" ? draft["confidence"] : DEFAULT_DRAFT_CONFIDENCE,
    "compiler",
  );

  return {
    draft_id: draft["id"],
    page_id: pageId,
    rel_path: relPath,
    page_modified: wasModified,
  };
}

/**
 * Draft compilation handler.
 *
 * Precondition:  db is non-null; writePageFn atomically writes a page.
 * Postcondition: all approved drafts up to limit are compiled and published;
 *   returns real counts of drafts_published and any errors.
 *
 * source: mcp_server/handlers/wiki_compile.py:191-224
 */
export async function wikiCompileHandler(
  args: WikiCompileArgs,
  db: WikiDbClient,
  writePageFn: (relPath: string, content: string) => Promise<void>,
): Promise<WikiCompileResult> {
  const draftId = typeof args.draft_id === "number" ? args.draft_id : null;
  const dryRun = args.dry_run === true;
  const limit = typeof args.limit === "number" ? args.limit : COMPILE_DEFAULT_LIMIT;

  let drafts: Record<string, unknown>[];
  if (draftId !== null) {
    const d = await getDraft(db, draftId);
    drafts = d ? [d] : [];
  } else {
    drafts = await listDrafts(db, "approved", null, limit);
  }

  if (!drafts.length) {
    return {
      drafts_published: 0,
      results: [],
      errors: [],
      error_count: 0,
      dry_run: dryRun,
    };
  }

  const published: Record<string, unknown>[] = [];
  const errors: string[] = [];

  // Invariant: published.length <= drafts processed so far
  // Termination: for loop over finite drafts array
  for (const d of drafts) {
    try {
      const result = await publishOne(db, d, dryRun, writePageFn);
      published.push(result);
    } catch (err) {
      errors.push(`draft ${d["id"]}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    drafts_published: published.length,
    results: published.slice(0, COMPILE_MAX_RESULTS),
    errors: errors.slice(0, COMPILE_MAX_ERRORS),
    error_count: errors.length,
    dry_run: dryRun,
  };
}
