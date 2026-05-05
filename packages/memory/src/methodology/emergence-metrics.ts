/**
 * Emergence metrics — forgetting curve fitting and aggregate report.
 *
 * Contains the forgetting curve analysis (log-linear regression) and the
 * aggregate emergence report generator.
 *
 * Pure business logic — no I/O.
 *
 * source: cortex@ed33435 mcp_server/core/emergence_metrics.py
 */

import {
  computePhaseLockingBenefit,
  computeSchemaAccelerationMetric,
} from "./emergence-tracker.js";

// ── Forgetting Curve ──────────────────────────────────────────────────────────

/**
 * Bin memories by age and compute average heat per bin.
 *
 * source: cortex@ed33435 mcp_server/core/emergence_metrics.py:18-39
 */
function binMemoriesByAge(
  memoriesByAge: Array<[number, number]>,
  binWidthHours = 6.0,
): Array<[number, number]> {
  const bins = new Map<number, number[]>();

  for (const [age, heat] of memoriesByAge) {
    const binIdx = Math.max(0, Math.floor(age / binWidthHours));
    if (!bins.has(binIdx)) bins.set(binIdx, []);
    bins.get(binIdx)!.push(heat);
  }

  return [...bins.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([idx, heats]) => [
      idx * binWidthHours + binWidthHours / 2,
      heats.reduce((s, v) => s + v, 0) / heats.length,
    ]);
}

const DEGENERATE_RESULT: ForgettingCurveResult = {
  curve_type: "degenerate",
  r_squared: 0,
  fit_quality: "degenerate" as never,
  half_life_hours: 0,
  retention_at_24h: 0,
};

function olsSums(
  logHeats: Array<[number, number]>,
): [number, number, number, number, number] {
  const n = logHeats.length;
  const sumX = logHeats.reduce((s, [t]) => s + t, 0);
  const sumY = logHeats.reduce((s, [, y]) => s + y, 0);
  const sumXY = logHeats.reduce((s, [t, y]) => s + t * y, 0);
  const sumX2 = logHeats.reduce((s, [t]) => s + t * t, 0);
  return [n, sumX, sumY, sumXY, sumX2];
}

/**
 * Bucket r² into a consumer-friendly quality label.
 *
 * Thresholds:
 *   r² < 0.10 → "poor"  — model explains < 10% of variance
 *   r² < 0.50 → "weak"  — some signal, oversimplification
 *   else      → "good"  — explains >= 50% of variance
 *
 * source: cortex@ed33435 mcp_server/core/emergence_metrics.py:103-121
 */
function fitQualityFor(rSquared: number): "poor" | "weak" | "good" {
  if (rSquared < 0.1) return "poor";
  if (rSquared < 0.5) return "weak";
  return "good";
}

/**
 * Fit log-linear regression: log(heat) = log(a) - b * age via OLS.
 *
 * source: cortex@ed33435 mcp_server/core/emergence_metrics.py:63-100
 */
function fitLogLinear(logHeats: Array<[number, number]>): ForgettingCurveResult {
  const [n, sumX, sumY, sumXY, sumX2] = olsSums(logHeats);

  const denom = n * sumX2 - sumX ** 2;
  if (Math.abs(denom) < 1e-10) return { ...DEGENERATE_RESULT };

  const b = -(n * sumXY - sumX * sumY) / denom;
  const logA = (sumY + b * sumX) / n;
  const a = Math.exp(logA);

  const meanY = sumY / n;
  const ssTot = logHeats.reduce((s, [, y]) => s + (y - meanY) ** 2, 0);
  const ssRes = logHeats.reduce(
    (s, [t, y]) => s + (y - (logA - b * t)) ** 2,
    0,
  );
  const r2 = 1.0 - ssRes / Math.max(ssTot, 1e-10);
  const r2Clamped = Math.max(0, r2);

  const halfLife = b > 0 ? Math.log(2) / Math.max(b, 1e-10) : Infinity;
  const retention24h = b > 0 ? a * Math.exp(-b * 24) : a;

  return {
    curve_type: "exponential",
    r_squared: Math.round(r2Clamped * 10000) / 10000,
    fit_quality: fitQualityFor(r2Clamped),
    half_life_hours: Math.round(Math.min(halfLife, 10000) * 10) / 10,
    retention_at_24h: Math.round(Math.max(0, Math.min(1, retention24h)) * 10000) / 10000,
    decay_rate: Math.round(b * 1e6) / 1e6,
    initial_retention: Math.round(Math.min(a, 1) * 10000) / 10000,
  };
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface ForgettingCurveResult {
  curve_type: string;
  r_squared: number;
  fit_quality: "poor" | "weak" | "good" | "insufficient_data" | "degenerate";
  half_life_hours: number;
  retention_at_24h: number;
  decay_rate?: number;
  initial_retention?: number;
}

const INSUFFICIENT: ForgettingCurveResult = {
  curve_type: "insufficient_data",
  r_squared: 0,
  fit_quality: "insufficient_data",
  half_life_hours: 0,
  retention_at_24h: 0,
};

/**
 * Fit a forgetting curve to memory age vs heat data.
 *
 * Biology shows power-law forgetting: R(t) = a * t^(-b).
 * If Cortex's mechanisms produce a similar curve, the system behaves realistically.
 *
 * precondition: memoriesByAge is a list of (age_hours, heat) tuples
 * postcondition: r_squared in [0, 1]; half_life_hours >= 0
 *
 * source: cortex@ed33435 mcp_server/core/emergence_metrics.py:133-171
 */
export function computeForgettingCurve(
  memoriesByAge: Array<[number, number]>,
): ForgettingCurveResult {
  if (memoriesByAge.length < 5) return { ...INSUFFICIENT };

  const binMeans = binMemoriesByAge(memoriesByAge);
  if (binMeans.length < 3) {
    return {
      curve_type: "insufficient_bins",
      r_squared: 0,
      fit_quality: "insufficient_data",
      half_life_hours: 0,
      retention_at_24h: 0,
    };
  }

  const logHeats: Array<[number, number]> = binMeans
    .filter(([, h]) => h > 0.01)
    .map(([t, h]) => [t, Math.log(Math.max(h, 0.01))]);

  if (logHeats.length < 3) {
    return {
      curve_type: "no_fit",
      r_squared: 0,
      fit_quality: "insufficient_data",
      half_life_hours: 0,
      retention_at_24h: 0,
    };
  }

  return fitLogLinear(logHeats);
}

// ── Aggregate Report ──────────────────────────────────────────────────────────

interface MemoryForReport {
  hours_in_stage?: number;
  heat?: number;
  schema_match_score?: number;
  theta_phase_at_encoding?: number;
  consolidation_stage?: string;
  interference_score?: number;
}

export interface EmergenceReport {
  timestamp: string;
  memory_count: number;
  forgetting_curve: ForgettingCurveResult;
  schema_acceleration: ReturnType<typeof computeSchemaAccelerationMetric>;
  phase_locking: ReturnType<typeof computePhaseLockingBenefit>;
  stage_distribution: Record<string, number>;
  avg_interference: number;
}

function computeStageDistribution(memories: MemoryForReport[]): Record<string, number> {
  const stages: Record<string, number> = {};
  for (const m of memories) {
    const stage = m.consolidation_stage ?? "unknown";
    stages[stage] = (stages[stage] ?? 0) + 1;
  }
  return stages;
}

function computeAvgInterference(memories: MemoryForReport[]): number {
  const scores = memories.map((m) => m.interference_score ?? 0);
  return Math.round((scores.reduce((s, v) => s + v, 0) / Math.max(scores.length, 1)) * 10000) / 10000;
}

/**
 * Generate a full emergence report from memory data.
 *
 * precondition: memories is an array of memory objects with optional fields
 * postcondition: all report fields are present; forgetting_curve is valid
 *
 * source: cortex@ed33435 mcp_server/core/emergence_metrics.py:192-222
 */
export function generateEmergenceReport(
  memories: MemoryForReport[],
): EmergenceReport {
  const ageHeat: Array<[number, number]> = memories
    .filter((m) => (m.heat ?? 0) > 0.01)
    .map((m) => [(m.hours_in_stage ?? 0) + 1.0, m.heat ?? 0.5]);

  const consistent = memories.filter((m) => (m.schema_match_score ?? 0) >= 0.5);
  const inconsistent = memories.filter((m) => (m.schema_match_score ?? 0) < 0.3);
  const encPhase = memories.filter((m) => (m.theta_phase_at_encoding ?? 0) < 0.5);
  const retPhase = memories.filter((m) => (m.theta_phase_at_encoding ?? 0) >= 0.5);

  return {
    timestamp: new Date().toISOString(),
    memory_count: memories.length,
    forgetting_curve: computeForgettingCurve(ageHeat),
    schema_acceleration: computeSchemaAccelerationMetric(consistent, inconsistent),
    phase_locking: computePhaseLockingBenefit(encPhase, retPhase),
    stage_distribution: computeStageDistribution(memories),
    avg_interference: computeAvgInterference(memories),
  };
}
