/**
 * Wiki PostgreSQL adapter — pages, links, citations.
 *
 * Part 1 of 3: wiki.pages, wiki.links, wiki.citations tables.
 *
 * Files on disk remain the source of truth for wiki.pages; this module
 * maintains the query index. All writes are idempotent (UPSERT by
 * rel_path or body_hash). Triggers on wiki.links and wiki.citations
 * maintain the denormalised counters on wiki.pages.
 *
 * Pure infrastructure — no core imports, no handler imports.
 *
 * source: mcp_server/infrastructure/pg_store_wiki.py (lines 1-210)
 */

import * as crypto from "node:crypto";

// ── Connection interface (injected by composition root) ───────────────────
// Avoids a direct pg/postgres dependency in the core layer.

export interface WikiDbClient {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}

// ── Hashing helper ────────────────────────────────────────────────────────

/**
 * Deterministic hash of a page body — drives idempotent upserts.
 * source: pg_store_wiki.py::body_hash
 */
export function bodyHash(body: string): string {
  return crypto.createHash("sha256").update(body, "utf-8").digest("hex");
}

// ── wiki.pages ────────────────────────────────────────────────────────────

export interface PageRow {
  readonly rel_path: string;
  readonly slug: string;
  readonly kind: string;
  readonly title: string;
  readonly memory_id?: number | null;
  readonly concept_id?: number | null;
  readonly domain?: string;
  readonly domains?: readonly string[];
  readonly tags?: readonly string[];
  readonly audience?: readonly string[];
  readonly requires?: readonly string[];
  readonly status?: string;
  readonly lifecycle_state?: string;
  readonly supersedes?: string | null;
  readonly superseded_by?: string | null;
  readonly verified?: string | null;
  readonly lead?: string;
  readonly sections?: unknown;
  readonly body?: string;
  readonly body_hash?: string;
}

/**
 * Upsert a page row by rel_path.
 *
 * Returns [page_id, was_modified] where was_modified is true when the
 * row was inserted or actually updated, false when the body_hash matched
 * and nothing changed.
 */
export async function upsertPage(
  db: WikiDbClient,
  page: PageRow,
): Promise<[number, boolean]> {
  const required: Array<keyof PageRow> = ["rel_path", "slug", "kind", "title"];
  for (const k of required) {
    if (page[k] == null) throw new Error(`upsert_page missing required field: ${k}`);
  }

  const body = (page.body ?? "") as string;
  const bh = page.body_hash ?? bodyHash(body);

  const sql = `
    INSERT INTO wiki.pages (
        memory_id, concept_id, rel_path, slug, kind, title, domain, domains,
        tags, audience, requires, status, lifecycle_state, supersedes,
        superseded_by, verified, lead, sections, body_hash
    ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb,
        $10::jsonb, $11::jsonb, $12, $13, $14, $15, $16, $17, $18::jsonb, $19
    )
    ON CONFLICT (rel_path) DO UPDATE SET
        memory_id = EXCLUDED.memory_id,
        concept_id = EXCLUDED.concept_id,
        slug = EXCLUDED.slug,
        kind = EXCLUDED.kind,
        title = EXCLUDED.title,
        domain = EXCLUDED.domain,
        domains = EXCLUDED.domains,
        tags = EXCLUDED.tags,
        audience = EXCLUDED.audience,
        requires = EXCLUDED.requires,
        status = EXCLUDED.status,
        lifecycle_state = EXCLUDED.lifecycle_state,
        supersedes = EXCLUDED.supersedes,
        superseded_by = EXCLUDED.superseded_by,
        verified = EXCLUDED.verified,
        lead = EXCLUDED.lead,
        sections = EXCLUDED.sections,
        body_hash = EXCLUDED.body_hash,
        tended = NOW()
    WHERE wiki.pages.body_hash <> EXCLUDED.body_hash
    RETURNING id, (xmax = 0) AS inserted;
  `;
  const params = [
    page.memory_id ?? null,
    page.concept_id ?? null,
    page.rel_path,
    page.slug,
    page.kind,
    page.title,
    page.domain ?? "",
    JSON.stringify(page.domains ?? []),
    JSON.stringify(page.tags ?? []),
    JSON.stringify(page.audience ?? []),
    JSON.stringify(page.requires ?? []),
    page.status ?? "seedling",
    page.lifecycle_state ?? "active",
    page.supersedes ?? null,
    page.superseded_by ?? null,
    page.verified ?? null,
    page.lead ?? "",
    JSON.stringify(page.sections ?? {}),
    bh,
  ];

  const result = await db.query<{ id: number; inserted: boolean }>(sql, params);
  if (result.rows.length > 0) {
    const row = result.rows[0]!;
    return [row.id, true];
  }

  // WHERE clause filtered the UPDATE → body_hash matched, no-op
  const existing = await db.query<{ id: number }>(
    "SELECT id FROM wiki.pages WHERE rel_path = $1",
    [page.rel_path],
  );
  if (!existing.rows.length) return [-1, false];
  return [existing.rows[0]!.id, false];
}

export async function getPageBySlug(
  db: WikiDbClient,
  slug: string,
): Promise<Record<string, unknown> | null> {
  const r = await db.query("SELECT * FROM wiki.pages WHERE slug = $1 LIMIT 1", [slug]);
  return (r.rows[0] as Record<string, unknown> | undefined) ?? null;
}

export async function getPageByRelPath(
  db: WikiDbClient,
  relPath: string,
): Promise<Record<string, unknown> | null> {
  const r = await db.query("SELECT * FROM wiki.pages WHERE rel_path = $1 LIMIT 1", [relPath]);
  return (r.rows[0] as Record<string, unknown> | undefined) ?? null;
}

// ── wiki.links ────────────────────────────────────────────────────────────

export async function upsertLink(
  db: WikiDbClient,
  srcPageId: number,
  dstSlug: string,
  linkKind: string = "see-also",
  dstPageId?: number | null,
): Promise<void> {
  let resolvedDstId = dstPageId ?? null;
  if (resolvedDstId === null) {
    const p = await getPageBySlug(db, dstSlug);
    resolvedDstId = p ? (p["id"] as number) : null;
  }

  await db.query(
    `INSERT INTO wiki.links (src_page_id, dst_slug, dst_page_id, link_kind)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (src_page_id, dst_slug, link_kind) DO UPDATE SET
         dst_page_id = EXCLUDED.dst_page_id
     WHERE wiki.links.dst_page_id IS DISTINCT FROM EXCLUDED.dst_page_id`,
    [srcPageId, dstSlug, resolvedDstId, linkKind],
  );
}

export async function deleteLinksFrom(db: WikiDbClient, srcPageId: number): Promise<number> {
  const r = await db.query("DELETE FROM wiki.links WHERE src_page_id = $1", [srcPageId]);
  return r.rowCount;
}

export async function getBacklinks(
  db: WikiDbClient,
  dstPageId: number,
): Promise<Record<string, unknown>[]> {
  const r = await db.query(
    `SELECT l.*, p.title AS src_title, p.rel_path AS src_rel_path
       FROM wiki.links l
       JOIN wiki.pages p ON p.id = l.src_page_id
      WHERE l.dst_page_id = $1`,
    [dstPageId],
  );
  return r.rows as Record<string, unknown>[];
}

export async function resolveUnresolvedLinks(db: WikiDbClient): Promise<number> {
  const r = await db.query(
    `UPDATE wiki.links l
        SET dst_page_id = p.id
       FROM wiki.pages p
      WHERE p.slug = l.dst_slug
        AND l.dst_page_id IS NULL`,
  );
  return r.rowCount;
}

// ── wiki.pages — thermodynamic updates ───────────────────────────────────

export interface PageForDecay {
  readonly id: number;
  readonly heat: number;
  readonly lifecycle_state: string;
  readonly tended: string | null;
  readonly is_stale: boolean;
  readonly lead: string;
  readonly sections: unknown;
}

export async function listPagesForDecay(
  db: WikiDbClient,
  limit: number = 5000,
  includeArchived: boolean = false,
): Promise<PageForDecay[]> {
  const states = ["active", "area"];
  if (includeArchived) states.push("archived");
  const r = await db.query<PageForDecay>(
    `SELECT id, heat, lifecycle_state, tended, is_stale, lead, sections
       FROM wiki.pages
      WHERE lifecycle_state = ANY($1)
      ORDER BY id LIMIT $2`,
    [states, limit],
  );
  return r.rows;
}

export interface HeatDecision {
  readonly page_id: number;
  readonly new_heat: number;
  readonly new_lifecycle: string;
  readonly archived_at: string | null;
}

export async function applyThermoDecisions(
  db: WikiDbClient,
  decisions: readonly HeatDecision[],
): Promise<number> {
  let written = 0;
  for (const d of decisions) {
    const r = await db.query(
      `UPDATE wiki.pages
          SET heat = $1,
              lifecycle_state = $2,
              archived_at = COALESCE($3::timestamptz, archived_at),
              tended = NOW()
        WHERE id = $4
          AND (
            ABS(heat - $1) > 0.001
            OR lifecycle_state <> $2
            OR ($3::timestamptz IS NOT NULL AND archived_at IS NULL)
          )`,
      [d.new_heat, d.new_lifecycle, d.archived_at, d.page_id],
    );
    written += r.rowCount;
  }
  return written;
}

export interface StalenessDecisionRow {
  readonly page_id: number;
  readonly is_stale_now: boolean;
  readonly transitioned: boolean;
}

export async function applyStalenessDecisions(
  db: WikiDbClient,
  decisions: readonly StalenessDecisionRow[],
): Promise<number> {
  let written = 0;
  for (const d of decisions) {
    if (!d.transitioned) continue;
    const r = await db.query(
      "UPDATE wiki.pages SET is_stale = $1 WHERE id = $2",
      [d.is_stale_now, d.page_id],
    );
    written += r.rowCount;
  }
  return written;
}

export async function getClaimFileRefsForPages(
  db: WikiDbClient,
  pageIds: readonly number[],
): Promise<Record<number, string[]>> {
  if (!pageIds.length) return {};
  const r = await db.query<{ page_id: number; evidence_refs: unknown[] }>(
    `SELECT p.id AS page_id, c.evidence_refs
       FROM wiki.pages p
       JOIN wiki.claim_events c ON c.memory_id = p.memory_id
      WHERE p.id = ANY($1)`,
    [[...pageIds]],
  );
  const out: Record<number, Set<string>> = {};
  for (const row of r.rows) {
    const { page_id, evidence_refs } = row;
    for (const ref of evidence_refs ?? []) {
      if (typeof ref === "object" && ref !== null && (ref as Record<string, string>)["kind"] === "file") {
        const target = (ref as Record<string, string>)["target"];
        if (target) {
          if (!out[page_id]) out[page_id] = new Set();
          out[page_id]!.add(target);
        }
      }
    }
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v].sort()]));
}
