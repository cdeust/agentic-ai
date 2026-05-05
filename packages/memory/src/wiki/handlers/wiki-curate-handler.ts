/**
 * Wiki Phase 2.4 — Curate pending drafts (handler).
 *
 * Two modes:
 *   Auto-sweep: scan all pending drafts, score each against the kind's
 *     rule-gate (claim count, section coverage, confidence threshold),
 *     and transition pending → approved | rejected. Drafts in the middle
 *     stay "hold" for refinement.
 *   Manual decision: wiki_curate({draft_id, decision}) forces a verdict.
 *
 * Composition root: wires draft evaluation (inline) against pg-wiki-store-concepts.
 *
 * source: mcp_server/handlers/wiki_curate.py (Cortex ed33435)
 * source: mcp_server/core/draft_curator.py (evaluate_draft logic)
 * source: mcp_server/infrastructure/pg_store_wiki.py:686-758 (draft I/O)
 */

import type { WikiDbClient } from "../storage/pg-wiki-store-pages.js";
import {
  listDrafts,
  updateDraftStatus,
  insertMemo,
} from "../storage/pg-wiki-store-concepts.js";
import type { KindDefinition } from "../schema-loader.js";

// source: mcp_server/core/draft_curator.py:28 — approval confidence floor
const APPROVAL_CONFIDENCE_FLOOR = 0.55;

// source: mcp_server/core/draft_curator.py:29 — rejection confidence ceiling
const REJECTION_CONFIDENCE_CEIL = 0.30;

// source: mcp_server/core/draft_curator.py:30 — min sections fraction for hold
const MIN_SECTIONS_FRACTION = 0.5;

// Score weight for confidence component
// source: mcp_server/core/draft_curator.py:87
const SCORE_CONFIDENCE_WEIGHT = 0.6;

// Score weight for section coverage component
// source: mcp_server/core/draft_curator.py:87
const SCORE_SECTION_WEIGHT = 0.4;

// Default confidence when not provided
// source: mcp_server/core/draft_curator.py:50
const DEFAULT_CONFIDENCE = 0.5;

// Max sample holds to include in result
// source: mcp_server/handlers/wiki_curate.py:151
const MAX_SAMPLE_HOLDS = 5;

// Score rounding: 2 decimal places for sample display
// source: mcp_server/handlers/wiki_curate.py:157
const SCORE_DISPLAY_ROUND_FACTOR = 100;

// Score rounding: 3 decimal places for memo storage
// source: mcp_server/handlers/wiki_curate.py:170
const SCORE_MEMO_ROUND_FACTOR = 1000;

// Percentage conversion factor
// source: mathematical constant (fraction → percent)
const PERCENT_FACTOR = 100;

// Manual decision confidence (user-reviewed = full confidence)
// source: mcp_server/handlers/wiki_curate.py:126
const MANUAL_DECISION_CONFIDENCE = 1.0;

// source: mcp_server/handlers/wiki_curate.py:148 — default sweep limit
const CURATE_DEFAULT_LIMIT = 200;

// source: mcp_server/handlers/wiki_curate.py:151 — errors capped at 10
const CURATE_MAX_ERRORS = 10;

export interface WikiCurateArgs {
  readonly draft_id?: number | null;
  readonly decision?: string | null;
  readonly reason?: string | null;
  readonly limit?: number | null;
  readonly kind?: string | null;
  [key: string]: unknown;
}

export interface WikiCurateResult {
  readonly drafts_evaluated: number;
  readonly approved: number;
  readonly rejected: number;
  readonly held: number;
  readonly sample_held: Array<{ id: number; score: number; reasons: string[] }>;
  readonly errors: string[];
  readonly error_count: number;
}

interface DraftVerdictResult {
  readonly verdict: "approved" | "rejected" | "hold";
  readonly score: number;
  readonly reasons: string[];
}

/**
 * Evaluate a single draft against its kind's gate rules.
 * Ported from mcp_server/core/draft_curator.py::evaluate_draft
 *
 * Precondition: draft is a non-null draft row dict.
 * Postcondition: returns verdict ∈ {approved, rejected, hold} with score ∈ [0,1].
 *
 * source: mcp_server/core/draft_curator.py:40-110
 */
function evaluateDraft(
  draft: Record<string, unknown>,
  kindDef: KindDefinition | null | undefined,
): DraftVerdictResult {
  const reasons: string[] = [];
  const confidence = typeof draft["confidence"] === "number"
    ? draft["confidence"]
    : DEFAULT_CONFIDENCE;

  // Hard reject: very low confidence
  // source: mcp_server/core/draft_curator.py:55-60
  if (confidence < REJECTION_CONFIDENCE_CEIL) {
    return {
      verdict: "rejected",
      score: confidence,
      reasons: [`confidence ${confidence.toFixed(2)} below rejection floor ${REJECTION_CONFIDENCE_CEIL}`],
    };
  }

  // Section coverage check
  // source: mcp_server/core/draft_curator.py:63-82
  const sections = Array.isArray(draft["sections"]) ? draft["sections"] as unknown[] : [];
  const filledSections = sections.filter((s) => {
    if (typeof s === "object" && s !== null) {
      const body = (s as Record<string, unknown>)["body"];
      return typeof body === "string" && body.trim().length > 0;
    }
    return false;
  }).length;
  const requiredSections = kindDef?.required_sections?.length ?? 1;
  const sectionFraction = requiredSections > 0
    ? filledSections / requiredSections
    : 1.0;

  if (sectionFraction < MIN_SECTIONS_FRACTION) {
    const pctFilled = (sectionFraction * PERCENT_FACTOR).toFixed(0);
    const pctRequired = (MIN_SECTIONS_FRACTION * PERCENT_FACTOR).toFixed(0);
    reasons.push(
      `sections filled ${filledSections}/${requiredSections} ` +
        `(${pctFilled}%) below ${pctRequired}% gate`, // source: mcp_server/core/draft_curator.py:74 (fraction → percent)
    );
  }

  // Score: weighted combination of confidence and section coverage
  // source: mcp_server/core/draft_curator.py:85-95
  const score = SCORE_CONFIDENCE_WEIGHT * confidence + SCORE_SECTION_WEIGHT * Math.min(1.0, sectionFraction);

  if (reasons.length > 0) {
    return { verdict: "hold", score, reasons };
  }

  if (score >= APPROVAL_CONFIDENCE_FLOOR) {
    return { verdict: "approved", score, reasons: [] };
  }

  return {
    verdict: "hold",
    score,
    reasons: [`composite score ${score.toFixed(2)} below approval floor ${APPROVAL_CONFIDENCE_FLOOR}`],
  };
}

/**
 * Draft curation handler.
 *
 * Precondition:  db is non-null.
 * Postcondition (auto-sweep): all pending drafts up to limit are evaluated;
 *   approved/rejected drafts get status transitions + memos; held drafts
 *   are left untouched; returns real counts.
 * Postcondition (manual): targeted draft gets forced verdict + memo;
 *   returns {draft_id, verdict, manual: true}.
 *
 * source: mcp_server/handlers/wiki_curate.py:107-187
 */
export async function wikiCurateHandler(
  args: WikiCurateArgs,
  db: WikiDbClient,
): Promise<WikiCurateResult | Record<string, unknown>> {
  // Manual decision path
  // source: mcp_server/handlers/wiki_curate.py:113-131
  if (args.draft_id != null && args.decision) {
    const draftId = Number(args.draft_id);
    const decision = args.decision as string;
    const reason = typeof args.reason === "string"
      ? args.reason
      : "manual decision via wiki_curate";

    const ok = await updateDraftStatus(db, draftId, decision);
    if (!ok) return { error: `draft ${draftId} not found` };

    await insertMemo(
      db,
      "draft",
      draftId,
      decision,
      reason,
      [],
      {},
      MANUAL_DECISION_CONFIDENCE,
      "user_manual",
    );
    return { draft_id: draftId, verdict: decision, manual: true };
  }

  // Auto-sweep path
  // source: mcp_server/handlers/wiki_curate.py:133-186
  const kind = typeof args.kind === "string" ? args.kind : undefined;
  const limit = typeof args.limit === "number" ? args.limit : CURATE_DEFAULT_LIMIT;
  const pending = await listDrafts(db, "pending", kind ?? null, limit);

  const counts = { approved: 0, rejected: 0, hold: 0 };
  const errors: string[] = [];
  const sampleHolds: Array<{ id: number; score: number; reasons: string[] }> = [];

  // Invariant: counts.approved + counts.rejected + counts.hold <= loop iterations
  // Termination: for loop over finite pending array
  for (const d of pending) {
    try {
      const verdict = evaluateDraft(d, undefined);

      if (verdict.verdict === "hold") {
        counts.hold++;
        if (sampleHolds.length < MAX_SAMPLE_HOLDS) {
          sampleHolds.push({
            id: d["id"] as number,
            score: Math.round(verdict.score * SCORE_DISPLAY_ROUND_FACTOR) / SCORE_DISPLAY_ROUND_FACTOR, // source: mcp_server/handlers/wiki_curate.py:157 (2 decimal places)
            reasons: verdict.reasons.slice(),
          });
        }
        continue;
      }

      await updateDraftStatus(db, d["id"] as number, verdict.verdict);
      await insertMemo(
        db,
        "draft",
        d["id"] as number,
        verdict.verdict,
        verdict.reasons.length
          ? verdict.reasons.join(" | ")
          : "all rule-gate checks passed",
        [],
        { score: Math.round(verdict.score * SCORE_MEMO_ROUND_FACTOR) / SCORE_MEMO_ROUND_FACTOR }, // source: mcp_server/handlers/wiki_curate.py:170 (3 decimal places)
        verdict.score,
        "curator_auto",
      );
      if (verdict.verdict === "approved") counts.approved++;
      else counts.rejected++;
    } catch (err) {
      errors.push(`draft ${d["id"]}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    drafts_evaluated: pending.length,
    approved: counts.approved,
    rejected: counts.rejected,
    held: counts.hold,
    sample_held: sampleHolds,
    errors: errors.slice(0, CURATE_MAX_ERRORS),
    error_count: errors.length,
  };
}
