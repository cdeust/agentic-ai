/**
 * Wiki Phase 2.2 — Claim resolution handler.
 *
 * Attaches entity_ids to unresolved claim_events, detects supersedes
 * relationships against prior claims for the same entities, and logs
 * conflict candidates. Idempotent at the row level.
 *
 * Composition root: wires claim-resolver (pure) against pg-wiki-store-concepts.
 *
 * source: mcp_server/handlers/wiki_resolve.py (Cortex ed33435)
 * source: mcp_server/infrastructure/pg_store_wiki.py:277-402 (claim I/O)
 */

import type { WikiDbClient } from "../storage/pg-wiki-store-pages.js";
import {
  getEntitiesByMemory,
  getEntityNameIndex,
  getClaimsByEntity,
  updateClaimEntities,
  updateClaimSupersedes,
  insertMemo,
} from "../storage/pg-wiki-store-concepts.js";
import { resolve } from "../claim-resolver.js";
import type { ClaimDict } from "../claim-resolver.js";

// source: mcp_server/handlers/wiki_resolve.py:64 — default sweep limit
const RESOLVE_DEFAULT_LIMIT = 500;

// source: mcp_server/handlers/wiki_resolve.py:68 — default name index size
const RESOLVE_DEFAULT_NAME_INDEX_SIZE = 5000;

// Memo confidence for supersedes decisions
// source: mcp_server/handlers/wiki_resolve.py:194
const SUPERSEDES_MEMO_CONFIDENCE = 0.7;

// Memo confidence for conflict candidates
// source: mcp_server/handlers/wiki_resolve.py:205
const CONFLICT_MEMO_CONFIDENCE = 0.5;

export interface WikiResolveArgs {
  readonly memory_id?: number | null;
  readonly limit?: number | null;
  readonly name_index_size?: number | null;
  [key: string]: unknown;
}

export interface WikiResolveResult {
  readonly claims_processed: number;
  readonly entity_links_planned: number;
  readonly entity_links_written: number;
  readonly supersedes_planned: number;
  readonly supersedes_written: number;
  readonly conflicts_logged: number;
}

/**
 * Fetch claims that need resolution.
 * source: mcp_server/handlers/wiki_resolve.py:94-135 (_fetch_claims)
 *
 * Precondition: db is non-null.
 * Postcondition: with memory_id — all claims for that memory;
 *   without — claims whose entity_ids is empty or null.
 */
async function fetchClaims(
  db: WikiDbClient,
  memoryId: number | null,
  limit: number,
): Promise<ClaimDict[]> {
  let r: { rows: Record<string, unknown>[] };
  if (memoryId !== null) {
    r = await db.query(
      `SELECT id, memory_id, text, claim_type, entity_ids, supersedes, extracted_at
         FROM wiki.claim_events WHERE memory_id = $1 ORDER BY id`,
      [memoryId],
    );
  } else {
    r = await db.query(
      `SELECT id, memory_id, text, claim_type, entity_ids, supersedes, extracted_at
         FROM wiki.claim_events
        WHERE entity_ids = '{}' OR entity_ids IS NULL
        ORDER BY id LIMIT $1`,
      [limit],
    );
  }
  return r.rows.map((row) => ({
    id: row["id"] as number | null,
    memory_id: row["memory_id"] as number | null,
    text: row["text"] as string | null,
    claim_type: row["claim_type"] as string | null,
    entity_ids: (row["entity_ids"] as number[] | null) ?? [],
    supersedes: row["supersedes"] as number | null,
  }));
}

/**
 * Claim resolution handler.
 *
 * Precondition:  db is non-null.
 * Postcondition: entity_ids, supersedes fields written for resolved claims;
 *   conflict memos written; returns real counts.
 *   When no claims need resolution returns zeroed result.
 *
 * source: mcp_server/handlers/wiki_resolve.py:138-225
 */
export async function wikiResolveHandler(
  args: WikiResolveArgs,
  db: WikiDbClient,
): Promise<WikiResolveResult> {
  const memoryId = typeof args.memory_id === "number" ? args.memory_id : null;
  const limit = typeof args.limit === "number" ? args.limit : RESOLVE_DEFAULT_LIMIT;
  const nameIndexSize = typeof args.name_index_size === "number"
    ? args.name_index_size
    : RESOLVE_DEFAULT_NAME_INDEX_SIZE;

  const claims = await fetchClaims(db, memoryId, limit);
  if (!claims.length) {
    return {
      claims_processed: 0,
      entity_links_planned: 0,
      entity_links_written: 0,
      supersedes_planned: 0,
      supersedes_written: 0,
      conflicts_logged: 0,
    };
  }

  // Pre-fetch resolver inputs
  // source: mcp_server/handlers/wiki_resolve.py:158-172
  const memoryIds = [...new Set(
    claims.map((c) => c.memory_id).filter((id): id is number => id != null),
  )];
  const entitiesByMemory = await getEntitiesByMemory(db, memoryIds);
  const entityNameToId = nameIndexSize > 0
    ? await getEntityNameIndex(db, nameIndexSize)
    : {};

  // Collect candidate entity ids to pre-fetch priors
  // source: mcp_server/handlers/wiki_resolve.py:165-170
  const candidateEntities = new Set<number>();
  for (const c of claims) {
    const memEids = entitiesByMemory[c.memory_id ?? -1] ?? [];
    for (const eid of memEids) candidateEntities.add(eid);
  }
  const exclIds = claims.map((c) => c.id).filter((id): id is number => id != null);
  const priorClaimsByEntity = await getClaimsByEntity(db, [...candidateEntities], exclIds);

  // Run the resolver
  const [linkPlans, supPlans, confPlans, stats] = resolve(claims, {
    entitiesByMemory,
    priorClaimsByEntity: priorClaimsByEntity as Record<number, readonly ClaimDict[]>,
    entityNameToId,
  });

  // Persist plans
  // source: mcp_server/handlers/wiki_resolve.py:182-213
  const entityUpdates = linkPlans
    .filter((p) => p.entity_ids.length > 0)
    .map((p) => [p.claim_id, p.entity_ids] as const);
  const supUpdates = supPlans.map((p) => [p.new_claim_id, p.superseded_claim_id] as const);

  const entityLinksWritten = await updateClaimEntities(db, entityUpdates);
  const supersedesWritten = await updateClaimSupersedes(db, supUpdates);

  // Memo supersedes + conflicts for the audit trail
  for (const plan of supPlans) {
    await insertMemo(
      db,
      "claim",
      plan.new_claim_id,
      "supersedes",
      plan.rationale,
      [],
      { superseded_claim_id: plan.superseded_claim_id },
      SUPERSEDES_MEMO_CONFIDENCE,
      "resolver",
    );
  }

  for (const plan of confPlans) {
    await insertMemo(
      db,
      "claim",
      plan.claim_a_id,
      "conflict_candidate",
      plan.reason,
      [],
      {
        claim_b_id: plan.claim_b_id,
        overlap_entities: plan.overlap_entities,
      },
      CONFLICT_MEMO_CONFIDENCE,
      "resolver",
    );
  }

  return {
    claims_processed: stats.claims_processed,
    entity_links_planned: stats.entity_links_planned,
    entity_links_written: entityLinksWritten,
    supersedes_planned: stats.supersedes_planned,
    supersedes_written: supersedesWritten,
    conflicts_logged: stats.conflicts_planned,
  };
}
