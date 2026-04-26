/**
 * Wiki PostgreSQL adapter — claims, concepts, drafts, memos.
 *
 * Part 2 of 2: wiki.claim_events, wiki.concepts, wiki.drafts,
 * wiki.citations, wiki.memos, diagnostics.
 *
 * source: mcp_server/infrastructure/pg_store_wiki.py (lines 213-866)
 */

import type { WikiDbClient } from "./pg-wiki-store-pages.js";

// ── wiki.claim_events ─────────────────────────────────────────────────────

export interface ClaimRow {
  readonly text: string;
  readonly claim_type?: string;
  readonly memory_id?: number | null;
  readonly session_id?: string;
  readonly entity_ids?: readonly number[];
  readonly evidence_refs?: readonly unknown[];
  readonly confidence?: number;
  readonly supersedes?: number | null;
}

/**
 * Bulk insert ClaimEvent rows. Returns the new ids in order.
 */
export async function insertClaimEvents(
  db: WikiDbClient,
  claims: readonly ClaimRow[],
): Promise<number[]> {
  if (!claims.length) return [];

  const out: number[] = [];
  for (const c of claims) {
    const r = await db.query<{ id: number }>(
      `INSERT INTO wiki.claim_events (
          memory_id, session_id, text, claim_type, entity_ids,
          evidence_refs, confidence, supersedes
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8) RETURNING id`,
      [
        c.memory_id ?? null,
        c.session_id ?? "",
        c.text.slice(0, 1900),
        c.claim_type ?? "assertion",
        [...(c.entity_ids ?? [])],
        JSON.stringify(c.evidence_refs ?? []),
        c.confidence ?? 0.5,
        c.supersedes ?? null,
      ],
    );
    if (r.rows[0]) out.push(r.rows[0].id);
  }
  return out;
}

export async function deleteClaimsForMemory(
  db: WikiDbClient,
  memoryId: number,
): Promise<number> {
  const r = await db.query(
    "DELETE FROM wiki.claim_events WHERE memory_id = $1",
    [memoryId],
  );
  return r.rowCount;
}

export async function getClaimsForMemory(
  db: WikiDbClient,
  memoryId: number,
): Promise<Record<string, unknown>[]> {
  const r = await db.query(
    "SELECT * FROM wiki.claim_events WHERE memory_id = $1 ORDER BY id",
    [memoryId],
  );
  return r.rows as Record<string, unknown>[];
}

export async function getEntitiesByMemory(
  db: WikiDbClient,
  memoryIds: readonly number[],
): Promise<Record<number, number[]>> {
  if (!memoryIds.length) return {};
  const r = await db.query<{ memory_id: number; entity_id: number }>(
    "SELECT memory_id, entity_id FROM memory_entities WHERE memory_id = ANY($1)",
    [[...memoryIds]],
  );
  const out: Record<number, number[]> = {};
  for (const row of r.rows) {
    if (!out[row.memory_id]) out[row.memory_id] = [];
    out[row.memory_id]!.push(row.entity_id);
  }
  return out;
}

export async function getEntityNameIndex(
  db: WikiDbClient,
  limit: number = 5000,
): Promise<Record<string, number>> {
  const r = await db.query<{ name: string; id: number }>(
    "SELECT name, id FROM entities ORDER BY heat DESC NULLS LAST LIMIT $1",
    [limit],
  );
  const out: Record<string, number> = {};
  for (const row of r.rows) {
    if (row.name && row.name.length >= 3) out[row.name] = row.id;
  }
  return out;
}

export async function getClaimsByEntity(
  db: WikiDbClient,
  entityIds: readonly number[],
  excludeClaimIds?: readonly number[] | null,
): Promise<Record<number, Record<string, unknown>[]>> {
  if (!entityIds.length) return {};
  const excl = excludeClaimIds ?? [];
  const r = await db.query<Record<string, unknown>>(
    `SELECT id, memory_id, text, claim_type, entity_ids, supersedes, extracted_at
       FROM wiki.claim_events
      WHERE entity_ids && $1::int[]
        AND ($2::bigint[] IS NULL OR NOT (id = ANY($2::bigint[])))`,
    [[...entityIds], excl.length ? [...excl] : null],
  );
  const out: Record<number, Record<string, unknown>[]> = {};
  for (const row of r.rows) {
    const rowEntityIds = (row["entity_ids"] as number[] | null) ?? [];
    for (const eid of rowEntityIds) {
      if ((entityIds as number[]).includes(eid)) {
        if (!out[eid]) out[eid] = [];
        out[eid]!.push(row);
      }
    }
  }
  return out;
}

export async function updateClaimEntities(
  db: WikiDbClient,
  updates: ReadonlyArray<readonly [number, readonly number[]]>,
): Promise<number> {
  let written = 0;
  for (const [claimId, eids] of updates) {
    const r = await db.query(
      `UPDATE wiki.claim_events
          SET entity_ids = $1::int[]
        WHERE id = $2
          AND entity_ids IS DISTINCT FROM $1::int[]`,
      [[...eids], claimId],
    );
    written += r.rowCount;
  }
  return written;
}

export async function updateClaimSupersedes(
  db: WikiDbClient,
  updates: ReadonlyArray<readonly [number, number]>,
): Promise<number> {
  let written = 0;
  for (const [newId, supId] of updates) {
    const r = await db.query(
      `UPDATE wiki.claim_events
          SET supersedes = $1
        WHERE id = $2
          AND (supersedes IS NULL OR supersedes <> $1)`,
      [supId, newId],
    );
    written += r.rowCount;
  }
  return written;
}

// ── wiki.concepts ─────────────────────────────────────────────────────────

export interface ConceptRow {
  readonly label: string;
  readonly status?: string;
  readonly entity_ids?: readonly number[];
  readonly grounding_memory_ids?: readonly number[];
  readonly grounding_claim_ids?: readonly number[];
  readonly properties?: Record<string, unknown>;
  readonly axial_slots?: Record<string, unknown>;
  readonly saturation_rate?: number;
  readonly saturation_streak?: number;
}

export async function listConcepts(
  db: WikiDbClient,
  status?: string | null,
  limit: number = 200,
): Promise<Record<string, unknown>[]> {
  if (status) {
    const r = await db.query(
      "SELECT * FROM wiki.concepts WHERE status = $1 ORDER BY id LIMIT $2",
      [status, limit],
    );
    return r.rows as Record<string, unknown>[];
  }
  const r = await db.query("SELECT * FROM wiki.concepts ORDER BY id LIMIT $1", [limit]);
  return r.rows as Record<string, unknown>[];
}

export async function getConceptsByEntityOverlap(
  db: WikiDbClient,
  entityIds: readonly number[],
): Promise<Record<string, unknown>[]> {
  if (!entityIds.length) return [];
  const r = await db.query(
    "SELECT * FROM wiki.concepts WHERE entity_ids && $1::int[]",
    [[...entityIds]],
  );
  return r.rows as Record<string, unknown>[];
}

export async function insertConcept(
  db: WikiDbClient,
  concept: ConceptRow,
): Promise<number> {
  const r = await db.query<{ id: number }>(
    `INSERT INTO wiki.concepts (
        label, status, entity_ids, grounding_memory_ids,
        grounding_claim_ids, properties, axial_slots,
        saturation_rate, saturation_streak
     ) VALUES ($1, $2, $3::int[], $4::int[], $5::bigint[], $6::jsonb, $7::jsonb, $8, $9)
     RETURNING id`,
    [
      concept.label,
      concept.status ?? "candidate",
      [...(concept.entity_ids ?? [])],
      [...(concept.grounding_memory_ids ?? [])],
      [...(concept.grounding_claim_ids ?? [])],
      JSON.stringify(concept.properties ?? {}),
      JSON.stringify(concept.axial_slots ?? {}),
      concept.saturation_rate ?? 1.0,
      concept.saturation_streak ?? 0,
    ],
  );
  return r.rows[0]!.id;
}

export async function updateConcept(
  db: WikiDbClient,
  conceptId: number,
  fields: Record<string, unknown>,
): Promise<boolean> {
  if (!Object.keys(fields).length) return false;
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  for (const [k, v] of Object.entries(fields)) {
    if (k === "entity_ids" || k === "grounding_memory_ids") {
      sets.push(`${k} = $${i}::int[]`);
      params.push(v);
    } else if (k === "grounding_claim_ids") {
      sets.push(`${k} = $${i}::bigint[]`);
      params.push(v);
    } else if (k === "properties" || k === "axial_slots") {
      sets.push(`${k} = $${i}::jsonb`);
      params.push(JSON.stringify(v));
    } else if (k === "last_property_at") {
      sets.push(`${k} = NOW()`);
      i--; // no param for NOW()
    } else {
      sets.push(`${k} = $${i}`);
      params.push(v);
    }
    i++;
  }

  params.push(conceptId);
  const r = await db.query(
    `UPDATE wiki.concepts SET ${sets.join(", ")} WHERE id = $${i}`,
    params,
  );
  return r.rowCount > 0;
}

// ── wiki.drafts ───────────────────────────────────────────────────────────

export interface DraftRow {
  readonly title: string;
  readonly kind: string;
  readonly concept_id?: number | null;
  readonly memory_id?: number | null;
  readonly lead?: string;
  readonly sections?: unknown;
  readonly frontmatter?: unknown;
  readonly provenance?: unknown;
  readonly synth_prompt?: string | null;
  readonly synth_model?: string | null;
  readonly confidence?: number;
  readonly status?: string;
}

export async function insertDraft(db: WikiDbClient, draft: DraftRow): Promise<number> {
  const r = await db.query<{ id: number }>(
    `INSERT INTO wiki.drafts (
        concept_id, memory_id, title, kind, lead, sections,
        frontmatter, provenance, synth_prompt, synth_model, confidence, status
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11, $12)
     RETURNING id`,
    [
      draft.concept_id ?? null,
      draft.memory_id ?? null,
      draft.title,
      draft.kind,
      draft.lead ?? "",
      JSON.stringify(draft.sections ?? []),
      JSON.stringify(draft.frontmatter ?? {}),
      JSON.stringify(draft.provenance ?? {}),
      draft.synth_prompt ?? null,
      draft.synth_model ?? null,
      draft.confidence ?? 0.5,
      draft.status ?? "pending",
    ],
  );
  return r.rows[0]!.id;
}

export async function getDraft(
  db: WikiDbClient,
  draftId: number,
): Promise<Record<string, unknown> | null> {
  const r = await db.query("SELECT * FROM wiki.drafts WHERE id = $1", [draftId]);
  return (r.rows[0] as Record<string, unknown> | undefined) ?? null;
}

export async function listDrafts(
  db: WikiDbClient,
  status?: string | null,
  kind?: string | null,
  limit: number = 50,
): Promise<Record<string, unknown>[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (status) { where.push(`status = $${i++}`); params.push(status); }
  if (kind) { where.push(`kind = $${i++}`); params.push(kind); }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  params.push(limit);
  const r = await db.query(
    `SELECT * FROM wiki.drafts ${whereSql} ORDER BY created_at DESC LIMIT $${i}`,
    params,
  );
  return r.rows as Record<string, unknown>[];
}

export interface UpdateDraftFields {
  readonly title?: string | null;
  readonly lead?: string | null;
  readonly sections?: unknown[] | null;
  readonly frontmatter?: Record<string, unknown> | null;
  readonly confidence?: number | null;
  readonly synth_prompt?: string | null;
  readonly synth_model?: string | null;
}

export async function updateDraft(
  db: WikiDbClient,
  draftId: number,
  fields: UpdateDraftFields,
): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [];
  let i = 1;
  if (fields.title != null) { sets.push(`title = $${i++}`); params.push(fields.title); }
  if (fields.lead != null) { sets.push(`lead = $${i++}`); params.push(fields.lead); }
  if (fields.sections != null) { sets.push(`sections = $${i++}::jsonb`); params.push(JSON.stringify(fields.sections)); }
  if (fields.frontmatter != null) { sets.push(`frontmatter = $${i++}::jsonb`); params.push(JSON.stringify(fields.frontmatter)); }
  if (fields.confidence != null) { sets.push(`confidence = $${i++}`); params.push(fields.confidence); }
  if (fields.synth_prompt != null) { sets.push(`synth_prompt = $${i++}`); params.push(fields.synth_prompt); }
  if (fields.synth_model != null) { sets.push(`synth_model = $${i++}`); params.push(fields.synth_model); }
  if (!sets.length) return false;
  params.push(draftId);
  const r = await db.query(`UPDATE wiki.drafts SET ${sets.join(", ")} WHERE id = $${i}`, params);
  return r.rowCount > 0;
}

export async function updateDraftStatus(
  db: WikiDbClient,
  draftId: number,
  status: string,
  publishedPageId?: number | null,
): Promise<boolean> {
  const valid = ["pending", "approved", "rejected", "published"];
  if (!valid.includes(status)) throw new Error(`invalid status: ${status}`);
  const r = await db.query(
    `UPDATE wiki.drafts
        SET status = $1,
            published_page_id = COALESCE($2, published_page_id),
            reviewed_at = NOW()
      WHERE id = $3`,
    [status, publishedPageId ?? null, draftId],
  );
  return r.rowCount > 0;
}

export async function findDraftForSource(
  db: WikiDbClient,
  args: { memory_id?: number | null; concept_id?: number | null },
): Promise<Record<string, unknown> | null> {
  if (!args.memory_id && !args.concept_id) return null;
  const [sql, params] = args.memory_id != null
    ? ["SELECT * FROM wiki.drafts WHERE memory_id = $1 ORDER BY created_at DESC LIMIT 1", [args.memory_id]]
    : ["SELECT * FROM wiki.drafts WHERE concept_id = $1 ORDER BY created_at DESC LIMIT 1", [args.concept_id!]];
  const r = await db.query(sql, params as unknown[]);
  return (r.rows[0] as Record<string, unknown> | undefined) ?? null;
}

// ── wiki.citations ────────────────────────────────────────────────────────

export async function insertCitation(
  db: WikiDbClient,
  pageId: number,
  sessionId: string = "",
  domain: string = "",
  memoryId?: number | null,
): Promise<number> {
  const r = await db.query<{ id: number }>(
    `INSERT INTO wiki.citations (page_id, session_id, domain, memory_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [pageId, sessionId, domain, memoryId ?? null],
  );
  return r.rows[0]!.id;
}

// ── wiki.memos (grounded-theory audit trail) ──────────────────────────────

export async function insertMemo(
  db: WikiDbClient,
  subjectType: string,
  subjectId: number,
  decision: string,
  rationale: string = "",
  alternatives: readonly unknown[] = [],
  inputs: Record<string, unknown> = {},
  confidence: number = 0.5,
  author: string = "system",
): Promise<number> {
  const r = await db.query<{ id: number }>(
    `INSERT INTO wiki.memos (
        subject_type, subject_id, decision, rationale,
        alternatives, inputs, confidence, author
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8) RETURNING id`,
    [subjectType, subjectId, decision, rationale, JSON.stringify(alternatives), JSON.stringify(inputs), confidence, author],
  );
  return r.rows[0]!.id;
}

// ── Diagnostics ───────────────────────────────────────────────────────────

export interface WikiStats {
  readonly pages: number;
  readonly active: number;
  readonly archived: number;
  readonly concepts: number;
  readonly pending_drafts: number;
  readonly claim_events: number;
  readonly links: number;
  readonly citations: number;
  readonly memos: number;
}

export async function wikiStats(db: WikiDbClient): Promise<WikiStats> {
  const r = await db.query<WikiStats>(
    `SELECT
       (SELECT COUNT(*) FROM wiki.pages) AS pages,
       (SELECT COUNT(*) FROM wiki.pages WHERE lifecycle_state='active') AS active,
       (SELECT COUNT(*) FROM wiki.pages WHERE lifecycle_state='archived') AS archived,
       (SELECT COUNT(*) FROM wiki.concepts) AS concepts,
       (SELECT COUNT(*) FROM wiki.drafts WHERE status='pending') AS pending_drafts,
       (SELECT COUNT(*) FROM wiki.claim_events) AS claim_events,
       (SELECT COUNT(*) FROM wiki.links) AS links,
       (SELECT COUNT(*) FROM wiki.citations) AS citations,
       (SELECT COUNT(*) FROM wiki.memos) AS memos`,
  );
  return r.rows[0]!;
}
