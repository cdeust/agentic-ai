/**
 * Heat-base decay computation for memory thermodynamics.
 *
 * Heat is the primary thermodynamic signal that measures a memory's
 * relevance/importance. It decays over time (Ebbinghaus forgetting curve)
 * and is boosted on access (hippocampal replay — McClelland 1995).
 *
 * Port of: portions of mcp_server/core/decay_cycle.py
 *          mcp_server/core/thermodynamics.py (session coherence)
 *
 * Pure logic — no I/O.
 */

// ── Ebbinghaus decay ──────────────────────────────────────────────────────
// source: Ebbinghaus, H. (1885). "Über das Gedächtnis." r(t) = exp(-t/S)
// source: half-life tuned to the Cortex 30-day consolidation window

const EBBINGHAUS_HALF_LIFE_DAYS = 30;

/**
 * Compute the Ebbinghaus forgetting-curve retention for elapsed time.
 *
 * r(t) = exp(-t / S)  where S = EBBINGHAUS_HALF_LIFE_DAYS
 *
 * Returns a value in (0, 1] — 1.0 at t=0, decays toward 0.
 *
 * source: Ebbinghaus, H. (1885). "Über das Gedächtnis." r(t) = exp(-t/S)
 * source: half-life tuned to the Cortex 30-day consolidation window
 */
export function ebbinghausRetention(elapsedDays: number): number {
  if (elapsedDays < 0) return 1.0;
  return Math.exp(-elapsedDays / EBBINGHAUS_HALF_LIFE_DAYS);
}

/**
 * Compute the per-hour exponential decay factor.
 *
 * The legacy decay cycle ran ~daily and applied factor 0.95 per run.
 * A3 migration converted this to continuous per-hour equivalent:
 *
 *   p_factor = 0.95^(1/24) ≈ 0.99787
 *
 * This preserves the macroscopic decay rate while making the function
 * continuous in elapsed hours.
 *
 * source: docs/program/phase-3-a3-migration-design.md §2.
 */
// source: 0.95^(1/24) ≈ 0.99787 — phase-3-a3-migration-design.md §2
const PER_HOUR_DECAY_FACTOR = 0.99787;

/**
 * Apply exponential heat decay over a number of elapsed hours.
 * Returns the new heat value, floored at the permastore heat floor.
 *
 * source: Apply consolidation stage multiplier (Kandel 2001)
 * source: Enforce permastore floor (Bahrick 1984)
 */
export function applyHeatDecay(
  heatBase: number,
  elapsedHours: number,
  heatFloor = 0.1,
): number {
  // source: Enforce permastore floor (Bahrick 1984)
  const decayed = heatBase * Math.pow(PER_HOUR_DECAY_FACTOR, elapsedHours);
  return Math.max(decayed, heatFloor);
}

// ── Session coherence boost ───────────────────────────────────────────────

/**
 * Compute effective heat with session-coherence bonus.
 *
 * Within a recent time window, memories that were created or accessed
 * get a coherence bonus — they are contextually relevant to the current
 * session. This is a simplified port; the full version lives in
 * mcp_server/core/thermodynamics.py::compute_session_coherence.
 *
 * Port of: mcp_server/core/thermodynamics.py::compute_session_coherence
 */
export function computeSessionCoherence(
  heat: number,
  createdAt: string,
  bonus = 0.1,
  windowHours = 4,
): number {
  if (!createdAt) return heat;
  const createdMs = Date.parse(createdAt);
  if (Number.isNaN(createdMs)) return heat;
  const elapsedHours = (Date.now() - createdMs) / 3_600_000;
  if (elapsedHours <= windowHours) {
    return Math.min(1.0, heat + bonus);
  }
  return heat;
}

// ── Recency boost ─────────────────────────────────────────────────────────

/**
 * Exponential recency boost for a memory based on its creation timestamp.
 *
 * Port of: mcp_server/core/temporal.py::compute_recency_boost
 */
export function computeRecencyBoost(
  createdAt: string,
  boostMax = 0.3,
  halflifeDays = 7,
  cutoffDays = 30,
): number {
  if (!createdAt) return 0;
  const createdMs = Date.parse(createdAt);
  if (Number.isNaN(createdMs)) return 0;
  const elapsedDays = (Date.now() - createdMs) / 86_400_000;
  if (elapsedDays > cutoffDays) return 0;
  return boostMax * Math.exp((-elapsedDays * Math.LN2) / halflifeDays);
}
