/**
 * Two-stage transfer — hippocampal-cortical transfer delta and interleaving.
 *
 * Handles the McClelland et al. (1995) transfer computation and interleaved
 * replay scheduling.
 *
 * Pure business logic — no I/O.
 *
 * Port of: cortex@ed33435 mcp_server/core/two_stage_transfer.py
 *
 * References:
 *   McClelland JL, McNaughton BL, O'Reilly RC (1995) Why there are
 *     complementary learning systems. Psychol Rev 102:419-457
 *   Ketz NA, et al. (2023) C-HORSE. eLife 12:e77185
 *     Hippocampal LR = 0.02, cortical LR = 0.002 (10:1 ratio)
 *   Tse D, et al. (2007) Schemas and memory consolidation. Science 316:76-82
 *     Schema-consistent memories consolidate 15x faster (30 days -> 48h)
 */

// ── Configuration ─────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/two_stage_transfer.py:26-46

/**
 * Cortical learning rate from C-HORSE model (Ketz et al., eLife 12:e77185, 2023).
 * C-HORSE specifies hippocampal LR = 0.02 and cortical LR = 0.002 (10:1 ratio).
 * source: cortex@ed33435 mcp_server/core/two_stage_transfer.py:29
 */
const REPLAY_TRANSFER_RATE = 0.02;

/**
 * Schema-accelerated transfer multiplier.
 * Tse et al. (2007) showed 15x acceleration in rats (30 days -> 48 hours).
 * Engineering adaptation: compressed to 2.5x for AI memory system timescale.
 * source: cortex@ed33435 mcp_server/core/two_stage_transfer.py:37
 */
const SCHEMA_ACCELERATION = 2.5;

/**
 * Minimum replays before transfer begins. Engineering choice — no direct paper.
 * source: cortex@ed33435 mcp_server/core/two_stage_transfer.py:42
 */
const MIN_REPLAYS_FOR_TRANSFER = 2;

/**
 * Below this hippocampal dependency, the trace can be freed.
 * Engineering choice calibrated to the transfer rate above.
 * source: cortex@ed33435 mcp_server/core/two_stage_transfer.py:46
 */
const HIPPOCAMPAL_RELEASE_THRESHOLD = 0.05;

// ── Transfer computation ──────────────────────────────────────────────────

/**
 * Compute base transfer rate with diminishing returns.
 *
 * Early replays matter most; later ones have diminishing impact.
 * Formula: transfer_rate / sqrt(effective_replays)
 *
 * source: cortex@ed33435 mcp_server/core/two_stage_transfer.py:95-105
 */
function computeBaseRate(
  replayCount: number,
  minReplays: number,
  transferRate: number,
): number {
  const effectiveReplays = replayCount - minReplays + 1;
  return transferRate / Math.sqrt(effectiveReplays);
}

/**
 * Compute how much hippocampal dependency decreases from one replay event.
 *
 * Each SWR replay strengthens the cortical trace and weakens hippocampal
 * dependency. The base rate is the cortical learning rate from C-HORSE
 * (Ketz et al., 2023, eLife 12:e77185). Schema consistency accelerates
 * transfer per Tse et al. (2007), adapted to compressed timescale.
 *
 * precondition:  currentDependency ∈ [0, 1]; replayCount >= 0;
 *   schemaMatch ∈ [0, 1]; importance ∈ [0, 1].
 * postcondition: result >= 0; result <= currentDependency.
 *
 * source: cortex@ed33435 mcp_server/core/two_stage_transfer.py:52-92
 *   REPLAY_TRANSFER_RATE = 0.02 (Ketz et al. 2023)
 *   SCHEMA_ACCELERATION = 2.5 (adapted from Tse et al. 2007 15x -> 2.5x)
 *   MIN_REPLAYS_FOR_TRANSFER = 2 (engineering choice)
 */
export function computeTransferDelta(
  currentDependency: number,
  replayCount: number,
  schemaMatch = 0.0,
  importance = 0.5,
  transferRate = REPLAY_TRANSFER_RATE,
  schemaAcceleration = SCHEMA_ACCELERATION,
  minReplays = MIN_REPLAYS_FOR_TRANSFER,
): number {
  if (replayCount < minReplays) return 0.0;
  if (currentDependency <= HIPPOCAMPAL_RELEASE_THRESHOLD) return 0.0;

  const base = computeBaseRate(replayCount, minReplays, transferRate);
  const schemaFactor = 1.0 + schemaMatch * (schemaAcceleration - 1.0);
  const importanceFactor = 0.8 + importance * 0.4;

  const delta = base * schemaFactor * importanceFactor;
  return Math.min(delta, currentDependency);
}

/**
 * Update hippocampal dependency after a replay event.
 *
 * precondition:  currentDependency ∈ [0, 1].
 * postcondition: result ∈ [0, 1]; rounded to 4 decimal places.
 *
 * source: cortex@ed33435 mcp_server/core/two_stage_transfer.py:108-124
 */
export function updateHippocampalDependency(
  currentDependency: number,
  replayCount: number,
  schemaMatch = 0.0,
  importance = 0.5,
): number {
  const delta = computeTransferDelta(
    currentDependency,
    replayCount,
    schemaMatch,
    importance,
  );
  return Math.max(0.0, Math.round((currentDependency - delta) * 1e4) / 1e4);
}

// ── Interleaved training ──────────────────────────────────────────────────

/**
 * Group candidate indices by their domain.
 * source: cortex@ed33435 mcp_server/core/two_stage_transfer.py:152-158
 */
function groupByDomain(
  candidates: Record<string, unknown>[],
): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (let i = 0; i < candidates.length; i++) {
    const domain = (candidates[i]?.["domain"] as string | undefined) ?? "default";
    if (!groups.has(domain)) groups.set(domain, []);
    groups.get(domain)!.push(i);
  }
  return groups;
}

/**
 * Produce a round-robin interleaved schedule across domains.
 * source: cortex@ed33435 mcp_server/core/two_stage_transfer.py:161-181
 */
function roundRobinSchedule(
  domainGroups: Map<string, number[]>,
  total: number,
): number[] {
  const schedule: number[] = [];
  const domainIters = new Map<string, IterableIterator<number>>(
    Array.from(domainGroups.entries()).map(([d, indices]) => [d, indices[Symbol.iterator]()]),
  );
  const domains = Array.from(domainGroups.keys());

  // Invariant: schedule grows by at least 1 per iteration if progress is made
  // Termination: when all iterators are exhausted, progress = false → break
  while (schedule.length < total) {
    let progress = false;
    for (const domain of domains) {
      const it = domainIters.get(domain)!;
      const next = it.next();
      if (!next.done) {
        schedule.push(next.value);
        progress = true;
      }
    }
    if (!progress) break;
  }

  return schedule;
}

/**
 * Generate an interleaved replay schedule from candidates.
 *
 * Interleaving prevents catastrophic interference in cortical learning.
 * Rather than replaying all similar memories consecutively, we interleave
 * memories from different clusters/domains.
 *
 * precondition:  candidates is an array; each may have a "domain" field.
 * postcondition: returned array is a permutation of [0..candidates.length);
 *   memories from the same domain are spaced as far apart as possible.
 *
 * source: cortex@ed33435 mcp_server/core/two_stage_transfer.py:130-149
 */
export function computeInterleavingSchedule(
  candidates: Record<string, unknown>[],
): number[] {
  if (candidates.length <= 1) {
    return Array.from({ length: candidates.length }, (_, i) => i);
  }
  const domainGroups = groupByDomain(candidates);
  return roundRobinSchedule(domainGroups, candidates.length);
}

// Re-export constants for testing
export {
  REPLAY_TRANSFER_RATE, SCHEMA_ACCELERATION,
  MIN_REPLAYS_FOR_TRANSFER, HIPPOCAMPAL_RELEASE_THRESHOLD,
};
