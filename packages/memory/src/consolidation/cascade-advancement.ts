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
 *   No paper provides a mathematical function mapping schema_match to rate.
 *   The exponential model (15^(-schema_match)) is an engineering approximation.
 *   // source: Tse D et al. (2007) Schemas and memory consolidation. Science 316:76-82
 *   // source: Kandel ER (2001) The molecular biology of memory storage.
 *   // source: Nader K et al. (2000) Fear memories require protein synthesis. Nature 406:722-726
 *   // source: McClelland JL et al. (1995) Why are there complementary learning systems. Psychol Rev.
 *   // source: Frey U, Morris RGM (1997) Synaptic tagging and LTP. Nature 385:533-536
 *
 * Pure business logic — no I/O.
 *
 * Port of: mcp_server/core/cascade_advancement.py
 */

import { getStagePropertiesByName } from "./cascade-stages.js";

// ── Stage name constants ──────────────────────────────────────────────────────

const LABILE = "labile";
const EARLY_LTP = "early_ltp";
const LATE_LTP = "late_ltp";
const CONSOLIDATED = "consolidated";
const RECONSOLIDATING = "reconsolidating";

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Compute schema-accelerated minimum dwell time.
 *
 * For systems consolidation stages (late_ltp, consolidated):
 *   Uses exponential acceleration: dwell * 15^(-schema_match).
 *   At schema_match=1.0: ~15x faster (Tse 2007: ~2-4 weeks → 48h).
 *   Engineering approximation — Tse 2007 provides no equation.
 *   // source: Tse D et al. (2007) Science 316:76-82
 *
 * For earlier stages (labile, early_ltp, reconsolidating):
 *   Modest linear factor: dwell * (1 - schema_match * 0.2).
 *   Schema acceleration is a systems consolidation phenomenon.
 *
 * Precondition: stageName is one of the 5 consolidation stage names.
 * Postcondition: returns a non-negative float (hours).
 */
function effectiveMinDwell(stageName: string, schemaMatch: number): number {
  const props = getStagePropertiesByName(stageName);
  const base = props.minDwellHours;
  if (stageName === LATE_LTP || stageName === CONSOLIDATED) {
    const schemaFactor = Math.pow(15.0, -schemaMatch); // source: Tse 2007 ~15x
    return base * schemaFactor;
  }
  const schemaFactor = 1.0 - schemaMatch * 0.2;
  return base * schemaFactor;
}

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
 */
function checkLabileAdvancement(
  dopamineLevel: number,
  importance: number,
): [boolean, string, number] {
  const daReady = dopamineLevel >= 1.0;
  const importanceReady = importance > 0.3;
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
 */
function checkEarlyLtpAdvancement(
  replayCount: number,
  importance: number,
): [boolean, string, number] {
  const replayReady = replayCount >= 1;
  const importanceBoost = importance > 0.4;
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
 *   - replayCount >= replayThreshold (3 normally, 1 with schema > 0.5)
 *
 * // source: Tse D et al. (2007) Science 316:76-82
 */
function checkLateLtpAdvancement(
  replayCount: number,
  schemaMatch: number,
): [boolean, string, number] {
  const replayThreshold = schemaMatch < 0.5 ? 3 : 1;
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

// ── Public API ────────────────────────────────────────────────────────────────

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
 * Precondition: currentStage is one of the 5 stage names; hoursInStage >= 0.
 * Postcondition: returns { ready, nextStage, readinessScore in [0, 1] }.
 *   When ready=false, nextStage equals currentStage.
 *   When ready=true, nextStage is the next stage in the cascade.
 */
export function computeAdvancementReadiness(
  currentStage: string,
  hoursInStage: number,
  opts: AdvancementReadinessOptions = {},
): AdvancementReadinessResult {
  const dopamineLevel = opts.dopamineLevel ?? 1.0;
  const replayCount = opts.replayCount ?? 0;
  const schemaMatch = opts.schemaMatch ?? 0.0;
  const importance = opts.importance ?? 0.5;

  const minDwell = effectiveMinDwell(currentStage, schemaMatch);

  if (hoursInStage < minDwell) {
    const readiness = Math.min(0.99, hoursInStage / Math.max(minDwell, 0.01));
    return { ready: false, nextStage: currentStage, readinessScore: readiness };
  }

  let result: [boolean, string, number];
  if (currentStage === LABILE) {
    result = checkLabileAdvancement(dopamineLevel, importance);
  } else if (currentStage === EARLY_LTP) {
    result = checkEarlyLtpAdvancement(replayCount, importance);
  } else if (currentStage === LATE_LTP) {
    result = checkLateLtpAdvancement(replayCount, schemaMatch);
  } else if (currentStage === RECONSOLIDATING) {
    result = checkReconsolidatingAdvancement(hoursInStage, minDwell);
  } else {
    return { ready: false, nextStage: currentStage, readinessScore: 1.0 };
  }

  const [ready, nextStage, readinessScore] = result;
  return { ready, nextStage, readinessScore };
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
 * Precondition: mismatchScore in [0, 1]; stability in [0, 1].
 * Postcondition: returns { triggered, newStage }.
 */
export function triggerReconsolidation(
  currentStage: string,
  mismatchScore: number,
  stability = 0.5,
  opts: { mismatchThreshold?: number } = {},
): { triggered: boolean; newStage: string } {
  const mismatchThreshold = opts.mismatchThreshold ?? 0.3;

  if (currentStage !== CONSOLIDATED && currentStage !== LATE_LTP) {
    return { triggered: false, newStage: currentStage };
  }

  const effectiveThreshold = mismatchThreshold + stability * 0.2;
  if (mismatchScore >= effectiveThreshold) {
    return { triggered: true, newStage: RECONSOLIDATING };
  }
  return { triggered: false, newStage: currentStage };
}
