/**
 * Emergence tracker — system-level metric tracking for neuroscience insights.
 *
 * Tracks properties that EMERGE from the interaction of individual mechanisms,
 * not from any single module. These validate whether Cortex's neuroscience model
 * produces biologically realistic behavior:
 *
 *   - Spacing effect: spaced repetitions improve retention vs massed practice
 *   - Testing effect: retrieval practice strengthens memory more than re-encoding
 *   - Schema acceleration: schema-consistent memories consolidate faster
 *   - Phase-locking: encoding during theta encoding-phase improves retention
 *
 * Forgetting curve fitting and aggregate report are in emergence-metrics.ts.
 *
 * Pure business logic — no I/O.
 *
 * source: cortex@ed33435 mcp_server/core/emergence_tracker.py
 */

// ── Memory event ──────────────────────────────────────────────────────────────

/**
 * A single event in a memory's lifecycle for tracking.
 * source: cortex@ed33435 mcp_server/core/emergence_tracker.py:29-39
 */
export interface MemoryEvent {
  memoryId: number;
  /** One of: "encode", "retrieve", "replay", "consolidate", "forget" */
  eventType: string;
  /** Hours since system start. */
  timestampHours: number;
  thetaPhase?: number;
  achLevel?: number;
  schemaMatch?: number;
  consolidationStage?: string;
  heat?: number;
  success?: boolean;
}

// ── Spacing Effect ────────────────────────────────────────────────────────────

/**
 * Measure spacing effect: do spaced accesses correlate with higher heat?
 *
 * Returns spacing regularity score [0, 1] where:
 *   1.0 = perfectly spaced (equal intervals)
 *   0.0 = maximally massed (all accesses clustered)
 *
 * precondition: accessTimes is sorted ascending; currentHeat in [0, 1]
 * postcondition: result in [0, 1]; returns 0.5 for fewer than 3 accesses
 *
 * source: cortex@ed33435 mcp_server/core/emergence_tracker.py:46-80
 */
export function computeSpacingBenefit(
  accessTimes: number[],
  currentHeat: number,
): number {
  if (accessTimes.length < 3) return 0.5;

  const intervals = accessTimes
    .slice(1)
    .map((t, i) => t - accessTimes[i]!);

  if (intervals.length === 0) return 0.5;

  const meanInterval = intervals.reduce((s, v) => s + v, 0) / intervals.length;
  if (meanInterval < 0.01) return 0;

  const variance =
    intervals.reduce((s, v) => s + (v - meanInterval) ** 2, 0) / intervals.length;
  const cv = meanInterval > 0 ? Math.sqrt(variance) / meanInterval : 0;

  const regularity = Math.max(0, 1.0 - cv / 2.0);
  return Math.round(regularity * 10000) / 10000;
}

// ── Testing Effect ────────────────────────────────────────────────────────────

export interface TestingBenefitResult {
  retrieval_fraction: number;
  heat: number;
  testing_benefit: number;
}

/**
 * Measure testing effect: does retrieval practice preserve heat better?
 *
 * precondition: retrievalCount and reEncodeCount >= 0; currentHeat in [0, 1]
 * postcondition: retrieval_fraction in [0, 1]; testing_benefit in [0, 1]
 *
 * source: cortex@ed33435 mcp_server/core/emergence_tracker.py:86-105
 */
export function computeTestingBenefit(
  retrievalCount: number,
  reEncodeCount: number,
  currentHeat: number,
): TestingBenefitResult {
  const total = retrievalCount + reEncodeCount;
  if (total === 0) {
    return { retrieval_fraction: 0, heat: currentHeat, testing_benefit: 0 };
  }

  const retrievalFraction = retrievalCount / total;
  const testingBenefit = retrievalFraction * currentHeat;

  return {
    retrieval_fraction: Math.round(retrievalFraction * 10000) / 10000,
    heat: Math.round(currentHeat * 10000) / 10000,
    testing_benefit: Math.round(testingBenefit * 10000) / 10000,
  };
}

// ── Schema Acceleration ───────────────────────────────────────────────────────

interface MemoryForSchema {
  consolidation_stage?: string;
  hours_in_stage?: number;
}

function avgConsolidationTime(mems: MemoryForSchema[]): number {
  const times = mems
    .filter((m) => m.consolidation_stage === "consolidated")
    .map((m) => (m.hours_in_stage ?? 0) + 24.0);
  return times.length > 0 ? times.reduce((s, v) => s + v, 0) / times.length : Infinity;
}

function consolidatedFraction(mems: MemoryForSchema[]): number {
  if (mems.length === 0) return 0;
  return (
    mems.filter((m) => m.consolidation_stage === "consolidated").length / mems.length
  );
}

export interface SchemaAccelerationResult {
  consistent_count: number;
  inconsistent_count: number;
  consistent_consolidated_fraction: number;
  inconsistent_consolidated_fraction: number;
  acceleration_ratio: number;
  ratio_defined: boolean;
  reason_for_undefined?: string;
}

/**
 * Measure schema acceleration: do schema-consistent memories consolidate faster?
 *
 * Compares average hours to reach CONSOLIDATED stage.
 *
 * When consistent_count == 0 (bootstrap state), ratio is mathematically 1.0
 * but not a measurement. Report ratio_defined: false + reason_for_undefined.
 *
 * postcondition: acceleration_ratio >= 0; ratio_defined indicates measurement validity
 *
 * source: cortex@ed33435 mcp_server/core/emergence_tracker.py:130-184
 */
export function computeSchemaAccelerationMetric(
  schemaConsistentMemories: MemoryForSchema[],
  schemaInconsistentMemories: MemoryForSchema[],
): SchemaAccelerationResult {
  const consistentCount = schemaConsistentMemories.length;
  const inconsistentCount = schemaInconsistentMemories.length;

  const consistentTime = avgConsolidationTime(schemaConsistentMemories);
  const inconsistentTime = avgConsolidationTime(schemaInconsistentMemories);

  let ratioDefined = true;
  let reasonForUndefined = "";
  let accelerationRatio = 1.0;

  if (consistentCount === 0) {
    ratioDefined = false;
    reasonForUndefined = "no_schemas_promoted_yet";
    accelerationRatio = 1.0;
  } else if (inconsistentCount === 0) {
    ratioDefined = false;
    reasonForUndefined = "no_baseline_population";
    accelerationRatio = 1.0;
  } else if (inconsistentTime > 0 && consistentTime < Infinity) {
    accelerationRatio = inconsistentTime / Math.max(consistentTime, 0.1);
  } else {
    ratioDefined = false;
    reasonForUndefined = "no_consolidated_memories";
    accelerationRatio = 1.0;
  }

  const result: SchemaAccelerationResult = {
    consistent_count: consistentCount,
    inconsistent_count: inconsistentCount,
    consistent_consolidated_fraction:
      Math.round(consolidatedFraction(schemaConsistentMemories) * 10000) / 10000,
    inconsistent_consolidated_fraction:
      Math.round(consolidatedFraction(schemaInconsistentMemories) * 10000) / 10000,
    acceleration_ratio: Math.round(accelerationRatio * 10000) / 10000,
    ratio_defined: ratioDefined,
  };

  if (reasonForUndefined) {
    result.reason_for_undefined = reasonForUndefined;
  }

  return result;
}

// ── Phase-Locking ─────────────────────────────────────────────────────────────

interface MemoryForPhase {
  heat?: number;
}

export interface PhaseLockingResult {
  encoding_phase_count: number;
  retrieval_phase_count: number;
  encoding_phase_avg_heat: number;
  retrieval_phase_avg_heat: number;
  phase_benefit: number;
  encoding_phase_survival: number;
  retrieval_phase_survival: number;
}

/**
 * Measure whether encoding during theta encoding-phase improves retention.
 *
 * Compares heat/survival of memories encoded at different theta phases.
 *
 * postcondition: all fields are finite numbers >= 0
 *
 * source: cortex@ed33435 mcp_server/core/emergence_tracker.py:190-220
 */
export function computePhaseLockingBenefit(
  encodingPhaseMemories: MemoryForPhase[],
  retrievalPhaseMemories: MemoryForPhase[],
): PhaseLockingResult {
  function avgHeat(mems: MemoryForPhase[]): number {
    const heats = mems.map((m) => m.heat ?? 0);
    return heats.length > 0 ? heats.reduce((s, v) => s + v, 0) / heats.length : 0;
  }

  function survivalRate(mems: MemoryForPhase[], minHeat = 0.1): number {
    if (mems.length === 0) return 0;
    const alive = mems.filter((m) => (m.heat ?? 0) >= minHeat).length;
    return alive / mems.length;
  }

  const encHeat = avgHeat(encodingPhaseMemories);
  const retHeat = avgHeat(retrievalPhaseMemories);

  return {
    encoding_phase_count: encodingPhaseMemories.length,
    retrieval_phase_count: retrievalPhaseMemories.length,
    encoding_phase_avg_heat: Math.round(encHeat * 10000) / 10000,
    retrieval_phase_avg_heat: Math.round(retHeat * 10000) / 10000,
    phase_benefit: Math.round((encHeat - retHeat) * 10000) / 10000,
    encoding_phase_survival: Math.round(survivalRate(encodingPhaseMemories) * 10000) / 10000,
    retrieval_phase_survival: Math.round(survivalRate(retrievalPhaseMemories) * 10000) / 10000,
  };
}
