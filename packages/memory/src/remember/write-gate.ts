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
  let score = 0.5;
  if (isErrorContent(content)) score = Math.min(1.0, score + 0.2);
  if (isDecisionContent(content)) score = Math.min(1.0, score + 0.15);
  if (SUCCESS_KW.test(content)) score = Math.min(1.0, score + 0.1);
  const tagSet = new Set(tags.map((t) => t.toLowerCase()));
  if (tagSet.has("important") || tagSet.has("critical")) {
    score = Math.min(1.0, score + 0.2);
  }
  if (tagSet.has("bug-fix") || tagSet.has("decision")) {
    score = Math.min(1.0, score + 0.1);
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
    const hours = (Date.now() - dt.getTime()) / 3_600_000;
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
export function buildRejectionResponse(
  score: WriteGateScore,
  importance: number,
): {
  stored: false;
  reason: string;
  novelty: Record<string, number>;
  importance: number;
} {
  return {
    stored: false,
    reason: score.gateReason,
    novelty: describeSignals(
      score.embeddingNovelty,
      score.entityNovelty,
      score.temporalNovelty,
      score.structuralNovelty,
      score.combinedNovelty,
    ),
    importance: Math.round(importance * 10000) / 10000,
  };
}
