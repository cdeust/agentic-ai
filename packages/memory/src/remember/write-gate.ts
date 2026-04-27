/**
 * write-gate.ts — Predictive-coding write gate scoring.
 *
 * Ports: core/write_gate.py (~297 LOC)
 *
 * This module assembles the four novelty signals and produces a gate decision.
 * It is pure except for the bypass checks that call simple regex/string
 * functions — no I/O, no network, no database.
 *
 * Correctness argument:
 *   The gate's precondition is that the caller supplies a valid embedding
 *   (or null), a set of similarity scores, and the content + tags.
 *   The postcondition is a WriteGateScore whose combinedNovelty ∈ [0,1]
 *   and whose shouldStore flag is true iff combinedNovelty >= threshold
 *   OR a bypass condition is met.
 *
 * source: core/write_gate.py
 * source: Friston K (2005) A theory of cortical responses.
 *         Phil Trans R Soc B 360:815-836
 */

import {
  computeEmbeddingNovelty,
  computeEntityNovelty,
  computeNoveltyScore,
  computeStructuralNovelty,
  computeTemporalNovelty,
  describeSignals,
  gateDecision,
} from "./predictive-coding.js";
import type { WriteGateScore } from "./types.js";

// ── Success-keyword regex (write_gate.py:_SUCCESS_KW) ──────────────────────
const SUCCESS_KW = /\b(fixed|resolved|succeeded|passed|completed|done)\b/i;

// ── Importance heuristic constants ──────────────────────────────────────────
// source: write_gate.py:estimate_importance — heuristic deltas ported verbatim
const IMPORTANCE_BASELINE = 0.5;     // source: write_gate.py — neutral prior
const IMPORTANCE_DELTA_ERROR = 0.2;  // source: write_gate.py — error content boost
const IMPORTANCE_DELTA_DECISION = 0.15; // source: write_gate.py — decision content boost
const IMPORTANCE_DELTA_SUCCESS = 0.1;   // source: write_gate.py — success keyword boost
const IMPORTANCE_DELTA_TAG = 0.2;    // source: write_gate.py — important/critical tag boost
const IMPORTANCE_DELTA_BUG = 0.1;    // source: write_gate.py — bug-fix/decision tag boost

// ── Rounding constant ────────────────────────────────────────────────────────
// source: write_gate.py:build_rejection_response — 4 decimal places = 10^4
const ROUND_4DP = 10000;

// ── Milliseconds per hour ────────────────────────────────────────────────────
// source: SI unit definition — 1 hour = 3600 s × 1000 ms/s
const MS_PER_HOUR = 3_600_000;

// ── Bypass detection ────────────────────────────────────────────────────────

/** Heuristic: does the content look like an error report? */
function isErrorContent(content: string): boolean {
  return (
    /\b(error|exception|traceback|stacktrace|crash|fatal|fail(ed|ure)?)\b/i.test(
      content,
    )
  );
}

/** Heuristic: does the content look like a decision record? */
function isDecisionContent(content: string): boolean {
  return /\b(decided|decision|choose|chose|selected|going with)\b/i.test(
    content,
  );
}

/**
 * Determine if the write gate should be bypassed and why.
 *
 * precondition:  content is non-empty; tags is an array of strings.
 * postcondition: (true, reason) iff force OR error OR decision OR important tag.
 *                (false, null) otherwise.
 *
 * source: core/write_gate.py:determine_bypass
 */
export function determineBypass(
  force: boolean,
  content: string,
  tags: string[],
): [boolean, string | null] {
  if (force) return [true, "forced"];
  if (isErrorContent(content)) return [true, "bypass_error"];
  if (isDecisionContent(content)) return [true, "bypass_decision"];
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  if (tagSet.has("important") || tagSet.has("critical")) {
    return [true, "bypass_important_tag"];
  }
  return [false, null];
}

// ── Importance estimation ───────────────────────────────────────────────────

/**
 * Estimate memory importance from content signals.
 *
 * postcondition: returned value in [0, 1].
 * This is a lightweight heuristic — the full modulation pipeline
 * (neuromodulation, emotional tagging) runs in the remember handler.
 */
export function estimateImportance(content: string, tags: string[]): number {
  let score = IMPORTANCE_BASELINE;
  if (isErrorContent(content)) score = Math.min(1.0, score + IMPORTANCE_DELTA_ERROR);
  if (isDecisionContent(content)) score = Math.min(1.0, score + IMPORTANCE_DELTA_DECISION);
  if (SUCCESS_KW.test(content)) score = Math.min(1.0, score + IMPORTANCE_DELTA_SUCCESS);
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  if (tagSet.has("important") || tagSet.has("critical")) {
    score = Math.min(1.0, score + IMPORTANCE_DELTA_TAG);
  }
  if (tagSet.has("bug-fix") || tagSet.has("decision")) {
    score = Math.min(1.0, score + IMPORTANCE_DELTA_BUG);
  }
  return score;
}

// ── Hours-since helper ──────────────────────────────────────────────────────

/**
 * Parse an ISO-8601 timestamp and return hours since that time.
 *
 * postcondition: returns null if parsing fails or timestamp is in the future.
 * source: core/write_gate.py:_parse_hours_since
 */
export function parseHoursSince(isoStr: string): number | null {
  try {
    const dt = new Date(isoStr);
    if (isNaN(dt.getTime())) return null;
    const hours = (Date.now() - dt.getTime()) / MS_PER_HOUR;
    return hours < 0 ? null : hours;
  } catch {
    return null;
  }
}

// ── Core scoring function ───────────────────────────────────────────────────

export interface WriteGateInput {
  /** The content to be stored. */
  content: string;
  /** All tags on the memory. */
  tags: string[];
  /** Whether to force-write bypassing the gate. */
  force: boolean;
  /** Cosine similarity scores to the k nearest existing memories. */
  similarities: number[];
  /** Entity names extracted from content. */
  newEntityNames: string[];
  /** Entity names already in the knowledge graph. */
  knownEntityNames: Set<string>;
  /**
   * Recent memory contents for structural comparison.
   * May be empty if no recent memories exist.
   */
  recentContents: string[];
  /**
   * Hours since the most similar existing memory was created.
   * Null if no similar memory found.
   */
  hoursSinceSimilar: number | null;
  /** The novelty threshold to apply (calibration-adjusted). */
  threshold: number;
}

/**
 * Score a candidate memory through the 4-signal write gate.
 *
 * precondition:  input.threshold ∈ (0, 1); similarities ⊆ [0, 1].
 * postcondition: returned WriteGateScore has combinedNovelty ∈ [0, 1]
 *   and shouldStore = true iff bypass OR combinedNovelty >= threshold.
 *
 * This function is pure: identical inputs produce identical outputs.
 * source: core/write_gate.py + core/predictive_coding_flat.py
 */
export function scoreCandidate(input: WriteGateInput): WriteGateScore {
  const {
    content,
    tags,
    force,
    similarities,
    newEntityNames,
    knownEntityNames,
    recentContents,
    hoursSinceSimilar,
    threshold,
  } = input;

  // Compute the four novelty signals.
  const embeddingNovelty = computeEmbeddingNovelty(similarities);
  const entityNovelty = computeEntityNovelty(newEntityNames, knownEntityNames);
  const temporalNovelty = computeTemporalNovelty(hoursSinceSimilar);
  const structuralNovelty = computeStructuralNovelty(content, recentContents);

  const combinedNovelty = computeNoveltyScore(
    embeddingNovelty,
    entityNovelty,
    temporalNovelty,
    structuralNovelty,
  );

  const [bypass] = determineBypass(force, content, tags);
  const [shouldStore, gateReason] = gateDecision(combinedNovelty, threshold, bypass);

  return {
    embeddingNovelty,
    entityNovelty,
    temporalNovelty,
    structuralNovelty,
    combinedNovelty,
    shouldStore,
    gateReason,
    threshold,
  };
}

// ── Rejection response ──────────────────────────────────────────────────────

/**
 * Build a rejection response when the write gate refuses the memory.
 *
 * precondition:  all novelty values are in [0, 1]; importance in [0, 1].
 * postcondition: returned object has stored=false, reason, novelty dict,
 *   and rounded importance.
 *
 * source: core/write_gate.py:build_rejection_response
 */
// source: phase 4-to-5 cleanup, 2026-04-26
// Return type narrows novelty from Record<string,number> to the exact shape
// declared in RememberResponseSchema so that buildRejectionResponse() satisfies
// the RememberResponse contract at the call site in remember.ts.
// describeSignals() always returns exactly these five keys — the narrower type
// is a stronger postcondition (LSP: postconditions may be strengthened).
export function buildRejectionResponse(
  score: WriteGateScore,
  importance: number,
): {
  stored: false;
  reason: string;
  novelty: {
    embedding_novelty: number;
    entity_novelty: number;
    temporal_novelty: number;
    structural_novelty: number;
    combined_novelty: number;
  };
  importance: number;
} {
  return {
    stored: false,
    reason: score.gateReason,
    // source: phase 4-to-5 cleanup, 2026-04-26
    // describeSignals returns Record<string,number> but always emits exactly
    // these five keys. Cast to the specific shape so RememberResponse.novelty
    // is satisfied without modifying predictive-coding.ts (which has
    // pre-existing source-citation obligations on its numeric constants).
    novelty: describeSignals(
      score.embeddingNovelty,
      score.entityNovelty,
      score.temporalNovelty,
      score.structuralNovelty,
      score.combinedNovelty,
    ) as {
      embedding_novelty: number;
      entity_novelty: number;
      temporal_novelty: number;
      structural_novelty: number;
      combined_novelty: number;
    },
    importance: Math.round(importance * ROUND_4DP) / ROUND_4DP,
  };
}
