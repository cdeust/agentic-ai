/**
 * Consolidation cascade — stage advancement and reconsolidation logic.
 *
 * Split from cascade.py to keep files under the 300-line cap.
 * Contains the transition logic that determines when memories advance
 * between consolidation stages.
 *
 * Schema acceleration (Tse et al. 2007):
 *   Tse showed that rodents with pre-existing spatial schemas consolidated
 *   new schema-consistent associations in ~48 hours, compared to ~2-4 weeks
 *   for schema-inconsistent ones — an approximately 10-15x acceleration.
 *   This applies specifically to systems consolidation (LATE_LTP → CONSOLIDATED),
 *   not to earlier synaptic stages.
 *
 *   IMPORTANT: Tse 2007 is an experimental finding, not a computational model.
 *   No paper in this chain provides a mathematical function mapping
 *   schema_match to consolidation rate. The exponential model used here
 *   (15^(-schema_match)) is an engineering approximation chosen to:
 *   (a) match the ~15x magnitude at full schema match,
 *   (b) provide diminishing returns at low match,
 *   (c) equal 1.0 (no acceleration) at zero match.
 *   The functional form and the 15.0 constant are engineering choices,
 *   not paper-derived equations.
 *
 * References:
 *   Tse D et al. (2007) Schemas and memory consolidation. Science 316:76-82
 *   Kandel ER (2001) The molecular biology of memory storage.
 *   Nader K et al. (2000) Fear memories require protein synthesis in the
 *     amygdala for reconsolidation after retrieval. Nature 406:722-726
 *   McClelland JL et al. (1995) Why are there complementary learning systems. Psychol Rev.
 *   Frey U, Morris RGM (1997) Synaptic tagging and LTP. Nature 385:533-536
 *
 * Pure business logic — no I/O.
 *
 * Port of: mcp_server/core/cascade_advancement.py
 * source: cortex@ed33435 mcp_server/core/cascade_advancement.py
 */

import { isMechanismDisabled, Mechanism } from "./ablation.js";

// ── Stage constants ────────────────────────────────────────────────────────

export const ConsolidationStage = {
  LABILE: "labile",
  EARLY_LTP: "early_ltp",
  LATE_LTP: "late_ltp",
  CONSOLIDATED: "consolidated",
  RECONSOLIDATING: "reconsolidating",
} as const;

export type ConsolidationStageValue =
  (typeof ConsolidationStage)[keyof typeof ConsolidationStage];

// Stage name constants (local aliases for readability)
const LABILE = ConsolidationStage.LABILE;
const EARLY_LTP = ConsolidationStage.EARLY_LTP;
const LATE_LTP = ConsolidationStage.LATE_LTP;
const CONSOLIDATED = ConsolidationStage.CONSOLIDATED;
const RECONSOLIDATING = ConsolidationStage.RECONSOLIDATING;

// Minimum dwell hours per stage (from cascade_stages.py StageProperties).
// source: cortex@ed33435 mcp_server/core/cascade_stages.py (imported by cascade_advancement.py)
const STAGE_MIN_DWELL_HOURS: Record<string, number> = {
  labile: 0.0,
  early_ltp: 1.0,
  late_ltp: 6.0,
  consolidated: 48.0,
  reconsolidating: 2.0,
};

// Systems consolidation stages (Tse 2007 applies to these two).
// source: cortex@ed33435 mcp_server/core/cascade_advancement.py:141
const SYSTEMS_STAGES = new Set<string>([LATE_LTP, CONSOLIDATED]);

// ── Schema acceleration ────────────────────────────────────────────────────

/**
 * Compute schema-accelerated minimum dwell time.
 *
 * For systems consolidation stages (late_ltp, consolidated):
 *   Uses exponential acceleration: dwell * 15^(-schema_match).
 *   At schema_match=1.0: ~15x faster (Tse 2007: ~2-4 weeks → 48h).
 *   At schema_match=0.0: no acceleration.
 *   Engineering approximation — Tse 2007 provides no equation.
 *   The 15.0 constant matches the experimental ~10-15x magnitude.
 *   // source: cortex@ed33435 mcp_server/core/cascade_advancement.py:144
 *
 * For earlier stages: Modest linear factor (hand-tuned, no paper basis).
 *   // source: cortex@ed33435 mcp_server/core/cascade_advancement.py:147
 *
 * precondition:  stage is one of the 5 consolidation stage names; schemaMatch in [0, 1].
 * postcondition: returns a non-negative float (hours).
 *
 * Port of: mcp_server/core/cascade_advancement.py::_effective_min_dwell
 * source: cortex@ed33435 mcp_server/core/cascade_advancement.py:122
 */
export function effectiveMinDwell(
  stage: string,
  schemaMatch: number,
): number {
  const baseDwell = STAGE_MIN_DWELL_HOURS[stage] ?? 0;
  if (SYSTEMS_STAGES.has(stage)) {
    // Tse et al. (2007): ~15x acceleration for schema-consistent memories.
    // Engineering approximation: exponential gives diminishing returns.
    const schemaFactor = Math.pow(15.0, -schemaMatch); // source: cortex@ed33435 cascade_advancement.py:144
    return baseDwell * schemaFactor;
  }
  // Earlier stages: modest acceleration (hand-tuned)
  const schemaFactor = 1.0 - schemaMatch * 0.2; // source: cortex@ed33435 cascade_advancement.py:147
  return baseDwell * schemaFactor;
}

// ── Stage-specific checks ──────────────────────────────────────────────────

/**
 * Check LABILE -> EARLY_LTP advancement conditions.
 *
 * Biological basis (Frey & Morris 1997): synaptic tagging requires
 * dopamine signal (DA >= 1.0) indicating the event was noteworthy,
 * OR sufficient importance from the encoding context.
 *
 * Advances if:
 *   - dopamineLevel >= 1.0 (encoding signal present), OR
 *   - importance > 0.3 (moderately important)
 *
 * // source: Frey U, Morris RGM (1997) Synaptic tagging and LTP. Nature 385:533-536
 * // source: cortex@ed33435 mcp_server/core/cascade_advancement.py:43
 */
function checkLabileAdvancement(
  dopamineLevel: number,
  importance: number,
): [boolean, string, number] {
  const daReady = dopamineLevel >= 1.0; // source: cortex@ed33435 cascade_advancement.py:58
  const importanceReady = importance > 0.3; // source: cortex@ed33435 cascade_advancement.py:59
  const readiness = Math.min(1.0, (dopamineLevel - 0.5) / 1.5 + importance * 0.5);
  if (daReady || importanceReady) {
    return [true, EARLY_LTP, readiness];
  }
  return [false, LABILE, readiness];
}

/**
 * Check EARLY_LTP -> LATE_LTP advancement conditions.
 *
 * Biological basis (Kandel 2001): transition to late LTP requires
 * protein synthesis triggered by replay (reactivation) or high
 * importance (strong initial encoding).
 *
 * Advances if:
 *   - replayCount >= 1 (memory has been replayed/accessed), OR
 *   - importance > 0.4 (strong encoding)
 *
 * // source: Kandel ER (2001) The molecular biology of memory storage.
 * // source: cortex@ed33435 mcp_server/core/cascade_advancement.py:66
 */
function checkEarlyLtpAdvancement(
  replayCount: number,
  importance: number,
): [boolean, string, number] {
  const replayReady = replayCount >= 1; // source: cortex@ed33435 cascade_advancement.py:81
  const importanceBoost = importance > 0.4; // source: cortex@ed33435 cascade_advancement.py:82
  const readiness = Math.min(1.0, replayCount / 2.0 + importance * 0.5);
  if (replayReady || importanceBoost) {
    return [true, LATE_LTP, readiness];
  }
  return [false, EARLY_LTP, readiness];
}

/**
 * Check LATE_LTP -> CONSOLIDATED advancement conditions.
 *
 * Biological basis (McClelland 1995, Kandel 2001): systems consolidation
 * requires hippocampal replay to transfer traces to cortical networks.
 * Schema-consistent memories consolidate faster (Tse 2007).
 *
 * Advances if:
 *   - replayCount >= replayThreshold (3 normally, 1 with schema >= 0.5)
 *
 * // source: Tse D et al. (2007) Science 316:76-82
 * // source: cortex@ed33435 mcp_server/core/cascade_advancement.py:89
 */
function checkLateLtpAdvancement(
  replayCount: number,
  schemaMatch: number,
): [boolean, string, number] {
  const replayThreshold = schemaMatch < 0.5 ? 3 : 1; // source: cortex@ed33435 cascade_advancement.py:103
  const replayReady = replayCount >= replayThreshold;
  const readiness = Math.min(1.0, replayCount / Math.max(replayThreshold, 1));
  if (replayReady) {
    return [true, CONSOLIDATED, readiness];
  }
  return [false, LATE_LTP, readiness];
}

/**
 * Check RECONSOLIDATING -> EARLY_LTP re-stabilization.
 *
 * // source: Nader K et al. (2000) Nature 406:722-726
 * // source: cortex@ed33435 mcp_server/core/cascade_advancement.py:111
 */
function checkReconsolidatingAdvancement(
  hoursInStage: number,
  effectiveMinDwellHours: number,
): [boolean, string, number] {
  if (hoursInStage >= effectiveMinDwellHours) {
    return [true, EARLY_LTP, 1.0];
  }
  const readiness = hoursInStage / Math.max(effectiveMinDwellHours, 0.01);
  return [false, RECONSOLIDATING, readiness];
}

// ── Public API ─────────────────────────────────────────────────────────────

// opts-object form kept for backward-compat with existing cascade.ts caller.
export interface AdvancementReadinessOptions {
  dopamineLevel?: number;
  replayCount?: number;
  schemaMatch?: number;
  importance?: number;
}

export interface AdvancementReadinessResult {
  ready: boolean;
  nextStage: string;
  readinessScore: number;
}

/**
 * Determine if a memory is ready to advance to the next consolidation stage.
 *
 * Overload 1 (positional, tuple return — Python-parity form):
 *   computeAdvancementReadiness(stage, hours, dopamine, replay, schema, importance)
 *   → [ready, nextStage, readinessScore]
 *
 * Overload 2 (opts-object, struct return — TS-idiomatic form for existing callers):
 *   computeAdvancementReadiness(stage, hours, opts?)
 *   → { ready, nextStage, readinessScore }
 *
 * precondition: currentStage is one of the 5 stage names; hoursInStage >= 0.
 * postcondition: when ready=false, nextStage equals currentStage.
 *   When ready=true, nextStage is the next stage in the cascade.
 *   readinessScore in [0, 1].
 *   When CASCADE ablated: always returns (false, currentStage, 0.0).
 *
 * Port of: mcp_server/core/cascade_advancement.py::compute_advancement_readiness
 * source: cortex@ed33435 mcp_server/core/cascade_advancement.py:151
 */
export function computeAdvancementReadiness(
  currentStage: string,
  hoursInStage: number,
  dopamineLevelOrOpts?: number | AdvancementReadinessOptions,
  replayCount?: number,
  schemaMatch?: number,
  importance?: number,
): [boolean, string, number] | AdvancementReadinessResult {
  // Determine calling convention.
  // - undefined third arg → treat as positional (Python-parity tuple return)
  // - object third arg     → opts form (TS-idiomatic struct return)
  // - number third arg     → positional form
  // The tests call computeAdvancementReadiness("unknown_stage", 100) with no
  // third arg and destructure the result as a tuple, so undefined must take
  // the positional branch.
  const isOptsForm =
    typeof dopamineLevelOrOpts === "object" && dopamineLevelOrOpts !== null;

  let dopamine: number;
  let replay: number;
  let schema: number;
  let imp: number;

  if (isOptsForm) {
    const opts = (dopamineLevelOrOpts as AdvancementReadinessOptions | undefined) ?? {};
    dopamine = opts.dopamineLevel ?? 1.0;
    replay = opts.replayCount ?? 0;
    schema = opts.schemaMatch ?? 0.0;
    imp = opts.importance ?? 0.5;
  } else {
    dopamine = (dopamineLevelOrOpts as number) ?? 1.0;
    replay = replayCount ?? 0;
    schema = schemaMatch ?? 0.0;
    imp = importance ?? 0.5;
  }

  // Ablation guard
  if (isMechanismDisabled(Mechanism.CASCADE)) {
    if (isOptsForm) {
      return { ready: false, nextStage: currentStage, readinessScore: 0.0 };
    }
    return [false, currentStage, 0.0];
  }

  // Unknown stage guard
  if (!(currentStage in STAGE_MIN_DWELL_HOURS)) {
    if (isOptsForm) {
      return { ready: false, nextStage: currentStage, readinessScore: 0.0 };
    }
    return [false, currentStage, 0.0];
  }

  const minDwell = effectiveMinDwell(currentStage, schema);

  if (hoursInStage < minDwell) {
    const readiness = Math.min(hoursInStage / Math.max(minDwell, 0.01), 0.99);
    if (isOptsForm) {
      return { ready: false, nextStage: currentStage, readinessScore: readiness };
    }
    return [false, currentStage, readiness];
  }

  let result: [boolean, string, number];
  if (currentStage === LABILE) {
    result = checkLabileAdvancement(dopamine, imp);
  } else if (currentStage === EARLY_LTP) {
    result = checkEarlyLtpAdvancement(replay, imp);
  } else if (currentStage === LATE_LTP) {
    result = checkLateLtpAdvancement(replay, schema);
  } else if (currentStage === RECONSOLIDATING) {
    result = checkReconsolidatingAdvancement(hoursInStage, minDwell);
  } else {
    // CONSOLIDATED: no further advancement
    if (isOptsForm) {
      return { ready: false, nextStage: currentStage, readinessScore: 1.0 };
    }
    return [false, currentStage, 1.0];
  }

  const [ready, nextStage, readinessScore] = result;
  if (isOptsForm) {
    return { ready, nextStage, readinessScore };
  }
  return [ready, nextStage, readinessScore];
}

/**
 * Determine if retrieval should trigger reconsolidation.
 *
 * Only CONSOLIDATED and LATE_LTP memories can reconsolidate.
 * Requires sufficient mismatch between retrieval context and stored context.
 * Higher stability means higher mismatch threshold needed.
 *
 * // source: Nader K et al. (2000) Fear memories require protein synthesis. Nature 406:722-726
 *
 * precondition: mismatchScore in [0, 1]; stability in [0, 1].
 * postcondition: returns tuple (triggered, newStage).
 *   triggered=true only for CONSOLIDATED or LATE_LTP stages.
 *
 * Port of: mcp_server/core/cascade_advancement.py::trigger_reconsolidation
 * source: cortex@ed33435 mcp_server/core/cascade_advancement.py:192
 */
export function triggerReconsolidation(
  currentStage: string,
  mismatchScore: number,
  stability: number = 0.5,
  mismatchThreshold: number = 0.3, // source: cortex@ed33435 cascade_advancement.py:197
): [boolean, string] {
  if (currentStage !== CONSOLIDATED && currentStage !== LATE_LTP) {
    return [false, currentStage];
  }

  const effectiveThreshold = mismatchThreshold + stability * 0.3; // source: cortex@ed33435 cascade_advancement.py:222

  if (mismatchScore >= effectiveThreshold) {
    return [true, RECONSOLIDATING];
  }

  return [false, currentStage];
}
