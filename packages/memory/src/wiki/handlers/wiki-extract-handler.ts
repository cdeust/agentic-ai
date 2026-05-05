/**
 * Wiki Phase 2.1 — Claim extraction handler.
 *
 * Parses memory prose into typed wiki.claim_events rows (assertion, decision,
 * method, result, observation, question, reference, limitation), each carrying
 * entity_ids, evidence_refs, confidence, and a supersedes pointer.
 *
 * Composition root: wires claim-extractor (pure) against pg-wiki-store-concepts
 * and a DB query for candidate memory rows.
 *
 * source: mcp_server/handlers/wiki_extract.py (Cortex ed33435)
 * source: mcp_server/infrastructure/pg_store_wiki.py:216-264 (claim I/O)
 */

import type { WikiDbClient } from "../storage/pg-wiki-store-pages.js";
import {
  insertClaimEvents,
  deleteClaimsForMemory,
} from "../storage/pg-wiki-store-concepts.js";
import { extractClaims } from "../claim-extractor.js";

// source: mcp_server/handlers/wiki_extract.py:76 — default sweep limit
const EXTRACT_DEFAULT_LIMIT = 200;

// source: mcp_server/handlers/wiki_extract.py:183 — errors capped at 10
const EXTRACT_MAX_ERRORS = 10;

export interface WikiExtractArgs {
  readonly memory_id?: number | null;
  readonly force?: boolean | null;
  readonly limit?: number | null;
  [key: string]: unknown;
}

export interface WikiExtractResult {
  readonly memories_processed: number;
  readonly claims_inserted: number;
  readonly claims_per_type: Record<string, number>;
  readonly errors: string[];
  readonly error_count: number;
}

/**
 * Fetch candidate memory rows for extraction.
 * source: mcp_server/handlers/wiki_extract.py:88-119 (_memory_rows)
 *
 * Precondition: db is non-null.
 * Postcondition: returns rows with id, content, tags for memories that
 *   qualify for extraction under the given mode.
 */
async function memoryRows(
  db: WikiDbClient,
  memoryId: number | null,
  limit: number,
  force: boolean,
): Promise<Array<{ id: number; content: string; tags: string[] }>> {
  let r: { rows: Record<string, unknown>[] };
  if (memoryId !== null) {
    r = await db.query(
      "SELECT id, content, tags FROM memories WHERE id = $1",
      [memoryId],
    );
  } else if (force) {
    r = await db.query(
      "SELECT id, content, tags FROM memories ORDER BY id LIMIT $1",
      [limit],
    );
  } else {
    r = await db.query(
      `SELECT m.id, m.content, m.tags
         FROM memories m
        WHERE NOT EXISTS (
          SELECT 1 FROM wiki.claim_events c WHERE c.memory_id = m.id
        )
        ORDER BY m.id
        LIMIT $1`,
      [limit],
    );
  }
  return r.rows.map((row) => ({
    id: row["id"] as number,
    content: (row["content"] as string | null) ?? "",
    tags: (row["tags"] as string[] | null) ?? [],
  }));
}

/**
 * Claim extraction handler.
 *
 * Precondition:  db is non-null.
 * Postcondition: for each candidate memory, claim_events rows are inserted
 *   (with delete-before-insert when force=true or single memory re-extract);
 *   returns real counts of memories_processed, claims_inserted, claims_per_type.
 *
 * source: mcp_server/handlers/wiki_extract.py:139-187
 */
export async function wikiExtractHandler(
  args: WikiExtractArgs,
  db: WikiDbClient,
): Promise<WikiExtractResult> {
  const memoryId = typeof args.memory_id === "number" ? args.memory_id : null;
  const force = args.force === true;
  const limit = typeof args.limit === "number" ? args.limit : EXTRACT_DEFAULT_LIMIT;

  const rows = await memoryRows(db, memoryId, limit, force);
  if (!rows.length) {
    return {
      memories_processed: 0,
      claims_inserted: 0,
      claims_per_type: {},
      errors: [],
      error_count: 0,
    };
  }

  let totalClaims = 0;
  const claimsPerType: Record<string, number> = {};
  const errors: string[] = [];

  // Invariant: totalClaims = sum of claims inserted for rows processed so far
  // Termination: for loop over finite rows array
  for (const row of rows) {
    try {
      const [claims] = extractClaims(row.content, {
        memory_id: row.id,
        entity_ids: [], // entity_ids attached by Phase 2.2 resolver
      });

      // Re-extraction: clear prior claims first to avoid duplicates
      // source: mcp_server/handlers/wiki_extract.py:167-169
      if (force || memoryId !== null) {
        await deleteClaimsForMemory(db, row.id);
      }

      if (!claims.length) continue;

      const payload = claims.map((c) => ({
        memory_id: c.memory_id,
        session_id: c.session_id,
        text: c.text,
        claim_type: c.claim_type,
        entity_ids: c.entity_ids,
        evidence_refs: c.evidence_refs.map((r) => ({
          kind: r.kind,
          target: r.target,
          context: r.context,
        })),
        confidence: c.confidence,
        supersedes: c.supersedes,
      }));

      await insertClaimEvents(db, payload);
      totalClaims += claims.length;

      for (const c of claims) {
        claimsPerType[c.claim_type] = (claimsPerType[c.claim_type] ?? 0) + 1;
      }
    } catch (err) {
      errors.push(`memory ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    memories_processed: rows.length,
    claims_inserted: totalClaims,
    claims_per_type: claimsPerType,
    errors: errors.slice(0, EXTRACT_MAX_ERRORS),
    error_count: errors.length,
  };
}
