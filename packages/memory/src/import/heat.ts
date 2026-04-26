/**
 * Age-decayed initial heat for historical memory imports.
 *
 * Pre-v3.12.2, every memory entered the store at heat=1.0, including
 * backfills. A bulk import of 300+ sessions produced a sharp peak at
 * heat ≈ 0.94–1.0, which Turrigiano multiplicative scaling cannot flatten.
 * User-visible symptom: recall pinned to the import cohort for 24+h.
 *
 * Fix: compute initial heat from the source session's age via an
 * Ebbinghaus-style exponential decay. Floor of 0.3 preserves semantic
 * retrievability — old memories still surface via WRRF on matching
 * query intent, they just do not dominate on heat alone.
 *
 * Port of: mcp_server/handlers/backfill_helpers.py::age_decayed_heat
 *          mcp_server/handlers/backfill_helpers.py::compute_age_days
 *
 * source: Ebbinghaus, H. (1885). "Über das Gedächtnis." r(t) = exp(-t/S)
 * source: half-life tuned to the Cortex 30-day consolidation window
 *         (core/cascade.py, ADR-013 thermodynamic memory model)
 * source: issue #14 P1 — age-decayed initial heat fix
 */

// source: _DEFAULT_HALF_LIFE_DAYS=30.0 — backfill_helpers.py
const DEFAULT_HALF_LIFE_DAYS = 30.0;

// source: _DEFAULT_HEAT_FLOOR=0.3 — backfill_helpers.py
const DEFAULT_HEAT_FLOOR = 0.3;

// source: math.log(2) — backfill_helpers.py
const LN2 = Math.LN2;

/**
 * Compute initial heat for a historical memory, decayed from its content age.
 *
 * Pre: ageDays is a number; negative values are clamped to 0.
 * Post: returns a value in [floor, 1.0]. Monotone non-increasing in
 * ageDays. h(0)=1.0; h→floor as ageDays→infinity.
 *
 * Curve: h(t) = floor + (1 - floor) · exp(-t · ln(2) / halfLifeDays)
 *
 * Reference points (floor=0.3, halfLife=30d):
 *   age=0   → 1.000
 *   age=7   → 0.879
 *   age=30  → 0.650
 *   age=90  → 0.388
 *   age=180 → 0.311
 *   age=365 → 0.301
 *
 * Port of: mcp_server/handlers/backfill_helpers.py::age_decayed_heat
 *
 * source: Ebbinghaus (1885); half-life tuned to Cortex 30-day window.
 */
export function ageDecayedHeat(
  ageDays: number,
  halfLifeDays: number = DEFAULT_HALF_LIFE_DAYS,
  floor: number = DEFAULT_HEAT_FLOOR,
): number {
  const clampedAge = Math.max(0.0, ageDays);
  const decay = Math.exp((-clampedAge * LN2) / halfLifeDays);
  return floor + (1.0 - floor) * decay;
}

/**
 * Age in days between an ISO-8601 timestamp and now (default: Date.now()).
 *
 * Pre: timestamp is an ISO-8601 string or null/undefined/empty.
 * Post: returns age in days (≥ 0). Returns 0.0 on missing, unparseable,
 * or future-dated input (safe fallback: callers then get h(0)=1.0,
 * matching legacy behaviour).
 *
 * Port of: mcp_server/handlers/backfill_helpers.py::compute_age_days
 *
 * source: mcp_server/handlers/backfill_helpers.py::compute_age_days
 */
export function computeAgeDays(
  timestamp: string | null | undefined,
  nowMs?: number,
): number {
  if (!timestamp) return 0.0;
  const ts = timestamp.trim();
  const parsed = Date.parse(ts);
  if (Number.isNaN(parsed)) return 0.0;
  const reference = nowMs ?? Date.now();
  const deltaMs = reference - parsed;
  return Math.max(0.0, deltaMs / 86_400_000);
}
