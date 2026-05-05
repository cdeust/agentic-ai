/**
 * Wiki Phase 3 — Concept emergence sweep (handler).
 *
 * Runs incremental clustering over resolved claim_events. Inserts new
 * candidate concepts; updates existing concepts with fresh claims;
 * transitions status (candidate → saturating → promoted) per the
 * saturation rules.
 *
 * Composition root: wires concept-emerger (pure) against pg-wiki-store-concepts.
 *
 * source: mcp_server/handlers/wiki_emerge.py (Cortex ed33435)
 * source: mcp_server/infrastructure/pg_store_wiki.py:540-611 (concepts I/O)
 */

import type { WikiDbClient } from "../storage/pg-wiki-store-pages.js";
import {
  insertConcept,
  updateConcept,
  insertMemo,
  getConceptsByEntityOverlap,
} from "../storage/pg-wiki-store-concepts.js";
import {
  emerge,
  coldStartThresholds,
  COLD_START_MEMORY_THRESHOLD,
} from "../concept-emerger.js";
import type { ConceptPlan, ExistingConcept } from "../concept-emerger.js";

// source: mcp_server/handlers/wiki_emerge.py:203 — default claim sweep limit
const EMERGE_DEFAULT_LIMIT = 5000;

// Memo confidence for new concept insertion
// source: mcp_server/handlers/wiki_emerge.py:165
const EMERGE_NEW_CONCEPT_CONFIDENCE = 0.5;

// Memo confidence for concept update
// source: mcp_server/handlers/wiki_emerge.py:190
const EMERGE_UPDATE_CONCEPT_CONFIDENCE = 0.6;

// Max promoted/saturating concept ids returned
// source: mcp_server/handlers/wiki_emerge.py:259-260
const EMERGE_MAX_IDS_RETURNED = 20;

export interface WikiEmergeArgs {
  readonly memory_limit?: number | null;
  readonly limit?: number | null;
  readonly dry_run?: boolean | null;
  [key: string]: unknown;
}

export interface WikiEmergeResult {
  readonly claims_loaded: number;
  readonly claims_grouped: number;
  readonly candidate_concepts: number;
  readonly concepts_inserted: number;
  readonly concepts_updated: number;
  readonly concepts_promoted: number;
  readonly concepts_saturating: number;
  readonly promoted_concept_ids: readonly number[];
  readonly saturating_concept_ids: readonly number[];
  readonly regime: "cold_start" | "steady_state";
  readonly dry_run: boolean;
}

/**
 * Fetch resolved claim_events (those with at least one entity_id).
 * source: mcp_server/handlers/wiki_emerge.py:85-113 (_fetch_resolved_claims)
 *
 * Precondition: db is non-null, limit >= 1.
 * Postcondition: returns rows with id, memory_id, text, claim_type, entity_ids.
 */
async function fetchResolvedClaims(
  db: WikiDbClient,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const r = await db.query(
    `SELECT id, memory_id, text, claim_type, entity_ids, extracted_at
       FROM wiki.claim_events
      WHERE entity_ids IS NOT NULL
        AND array_length(entity_ids, 1) > 0
      ORDER BY id
      LIMIT $1`,
    [limit],
  );
  return r.rows as Record<string, unknown>[];
}

/**
 * Build existing-concepts index (entity_id → concept row).
 * source: mcp_server/handlers/wiki_emerge.py:116-129 (_existing_concepts_index)
 *
 * Precondition: entityIds is a (possibly empty) array of ints.
 * Postcondition: returns map from each entity_id to the concept it belongs to.
 */
async function existingConceptsIndex(
  db: WikiDbClient,
  entityIds: number[],
): Promise<Record<number, ExistingConcept>> {
  const rows = await getConceptsByEntityOverlap(db, entityIds);
  const out: Record<number, ExistingConcept> = {};
  for (const row of rows) {
    const eids = (row["entity_ids"] as number[] | null) ?? [];
    for (const eid of eids) {
      if (!(eid in out)) out[eid] = row as ExistingConcept;
    }
  }
  return out;
}

/**
 * Persist one ConceptPlan (insert or update concept + memo).
 * source: mcp_server/handlers/wiki_emerge.py:132-198 (_persist_plan)
 *
 * Precondition: db is non-null; plan is a valid ConceptPlan.
 * Postcondition: if dry_run=false, concept row is inserted or updated and a
 *   memo is written; returns [concept_id, action string].
 */
async function persistPlan(
  db: WikiDbClient,
  plan: ConceptPlan,
  dryRun: boolean,
): Promise<[number, "inserted" | "updated" | "dry_run"]> {
  if (dryRun) return [plan.concept_id ?? -1, "dry_run"];

  if (plan.concept_id == null) {
    const newId = await insertConcept(db, {
      label: plan.label,
      status: plan.status,
      entity_ids: plan.entity_ids,
      grounding_memory_ids: plan.grounding_memory_ids,
      grounding_claim_ids: plan.grounding_claim_ids,
      properties: plan.properties,
      axial_slots: plan.axial_slots,
      saturation_rate: plan.saturation_rate,
      saturation_streak: plan.saturation_streak,
    });
    await insertMemo(
      db,
      "concept",
      newId,
      "emerged",
      `New candidate concept around entity-cluster of ${plan.entity_ids.length} entities, ` +
        `${plan.grounding_memory_ids.length} memories`,
      [],
      { label: plan.label, status: plan.status },
      EMERGE_NEW_CONCEPT_CONFIDENCE,
      "emerger",
    );
    return [newId, "inserted"];
  }

  await updateConcept(db, plan.concept_id, {
    label: plan.label,
    status: plan.status,
    entity_ids: plan.entity_ids,
    grounding_memory_ids: plan.grounding_memory_ids,
    grounding_claim_ids: plan.grounding_claim_ids,
    properties: plan.properties,
    axial_slots: plan.axial_slots,
    saturation_rate: plan.saturation_rate,
    saturation_streak: plan.saturation_streak,
    last_property_at: true,
  });
  await insertMemo(
    db,
    "concept",
    plan.concept_id,
    "updated",
    `Concept absorbed new claims; status=${plan.status}; ` +
      `saturation_streak=${plan.saturation_streak}; ` +
      `grounding_memories=${plan.grounding_memory_ids.length}`,
    [],
    { saturation_rate: plan.saturation_rate },
    EMERGE_UPDATE_CONCEPT_CONFIDENCE,
    "emerger",
  );
  return [plan.concept_id, "updated"];
}

/**
 * Concept emergence handler.
 *
 * Precondition:  db is non-null.
 * Postcondition: resolved claim_events are clustered; wiki.concepts rows are
 *   inserted or updated; audit memos are written; returns real counts.
 *   When no resolved claims exist returns zeroed result.
 *
 * source: mcp_server/handlers/wiki_emerge.py:201-276
 */
export async function wikiEmergeHandler(
  args: WikiEmergeArgs,
  db: WikiDbClient,
): Promise<WikiEmergeResult> {
  const limit = typeof args.limit === "number"
    ? args.limit
    : typeof args.memory_limit === "number"
      ? args.memory_limit
      : EMERGE_DEFAULT_LIMIT;
  const dryRun = args.dry_run === true;

  const claims = await fetchResolvedClaims(db, limit);
  if (!claims.length) {
    return {
      claims_loaded: 0,
      claims_grouped: 0,
      candidate_concepts: 0,
      concepts_inserted: 0,
      concepts_updated: 0,
      concepts_promoted: 0,
      concepts_saturating: 0,
      promoted_concept_ids: [],
      saturating_concept_ids: [],
      regime: "steady_state",
      dry_run: dryRun,
    };
  }

  // Pre-fetch existing concepts that overlap these entity ids
  // source: mcp_server/handlers/wiki_emerge.py:219-222
  const candidateEntities = [...new Set(
    claims.flatMap((c) => (c["entity_ids"] as number[] | null) ?? []),
  )].sort((a, b) => a - b);
  const existingIndex = await existingConceptsIndex(db, candidateEntities);

  // Cold-start detection: measured against TOTAL resolved corpus count
  // source: mcp_server/handlers/wiki_emerge.py:226-236
  const totalR = await db.query<{ count: number }>(
    `SELECT COUNT(*) AS count FROM wiki.claim_events
      WHERE entity_ids IS NOT NULL
        AND array_length(entity_ids, 1) > 0`,
  );
  const totalClaims = Number(totalR.rows[0]?.count ?? 0);
  const coldStart = totalClaims < COLD_START_MEMORY_THRESHOLD;
  const thresholds = coldStart ? coldStartThresholds() : undefined;

  const [plans, stats] = emerge({
    claims: claims as Parameters<typeof emerge>[0]["claims"],
    existingConceptsByEntities: existingIndex,
    thresholds,
  });

  let inserted = 0;
  let updated = 0;
  const promotedIds: number[] = [];
  const saturatingIds: number[] = [];

  // Invariant: inserted + updated <= plans processed so far
  // Termination: for loop over finite plans array
  for (const plan of plans) {
    const [cid, action] = await persistPlan(db, plan, dryRun);
    if (action === "inserted") inserted++;
    else if (action === "updated") updated++;
    if (plan.status === "promoted") promotedIds.push(cid);
    else if (plan.status === "saturating") saturatingIds.push(cid);
  }

  return {
    claims_loaded: claims.length,
    claims_grouped: stats.claims_grouped,
    candidate_concepts: stats.candidate_concepts,
    concepts_inserted: inserted,
    concepts_updated: updated,
    concepts_promoted: stats.promoted,
    concepts_saturating: stats.saturating,
    promoted_concept_ids: promotedIds.slice(0, EMERGE_MAX_IDS_RETURNED),
    saturating_concept_ids: saturatingIds.slice(0, EMERGE_MAX_IDS_RETURNED),
    regime: coldStart ? "cold_start" : "steady_state",
    dry_run: dryRun,
  };
}
