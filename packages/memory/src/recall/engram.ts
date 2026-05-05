/**
 * Engram slot allocation — competitive memory storage based on excitability.
 *
 * Implements the Josselyn & Frankland (2007) / Rashid et al. (2016) model:
 * neurons (slots) compete via CREB-like excitability. High-excitability slots
 * win the competition and memories stored nearby in time share the same slot,
 * creating automatic temporal linking with zero explicit logic.
 *
 * Constants without published values (hand-tuned):
 *   boostAmount=0.5 — No published CREB boost magnitude exists; tuned for
 *     reasonable overlap between temporally proximate memories.
 *   inhibitionFactor=0.25 — Biological lateral inhibition is PV+ interneuron-
 *     mediated winner-take-all competition, not distance-based. The radius
 *     model with fixed inhibition factor is an engineering approximation.
 *
 * Pure business logic — no I/O. Receives slot data and returns allocation decisions.
 *
 * Port of: cortex@ed33435 mcp_server/core/engram.py
 *
 * References:
 *   Josselyn SA, Frankland PW (2007) Memory allocation: mechanisms and function.
 *   Rashid AJ et al. (2016) Competition between engrams influences fear memory
 *     formation and recall. Science 353:383-387
 *   Josselyn SA, Tonegawa S (2020) Memory engrams: Recalling the past and
 *     imagining the future. Science 367:eaaw4325
 */

import { isMechanismDisabled, Mechanism } from "./ablation.js";

// ── Decayed excitability ──────────────────────────────────────────────────

/**
 * Apply exponential decay to stored excitability.
 *
 * E(t) = E0 * 2^(-elapsed_hours / half_life)
 *
 * precondition:  halfLifeHours > 0; storedExcitability ∈ [0, 1].
 * postcondition: result ∈ [0, 1]; returns 0.0 if no activation time
 *   or zero excitability.
 *
 * source: cortex@ed33435 mcp_server/core/engram.py:36-60
 *   half_life default = 6.0h from Rashid et al. (2016): CREB elevated at
 *   1.5h, 3h, 6h; baseline by 18h. A 6h half-life fits this decay envelope.
 */
export function computeDecayedExcitability(
  storedExcitability: number,
  lastActivated: string | null,
  halfLifeHours = 6.0, // source: cortex@ed33435 mcp_server/core/engram.py:39 — Rashid et al. (2016)
): number {
  if (lastActivated === null || storedExcitability <= 0.0) return 0.0;
  let lastMs: number;
  try {
    const d = new Date(lastActivated);
    if (isNaN(d.getTime())) return 0.0;
    lastMs = d.getTime();
  } catch {
    return 0.0;
  }
  const elapsedHours = Math.max(0.0, (Date.now() - lastMs) / 3600000);
  return storedExcitability * Math.pow(2.0, -elapsedHours / halfLifeHours);
}

// ── Slot selection ────────────────────────────────────────────────────────

export interface EngramSlot {
  slot_index: number;
  excitability: number;
  last_activated: string | null;
}

/**
 * Find the most excitable slot for memory allocation.
 *
 * precondition:  slots is a non-empty array of EngramSlot objects.
 * postcondition: returned [bestSlotIndex, bestExcitability]; when
 *   ENGRAM_ALLOCATION is ablated, returns [0, 0.5] (no-op baseline).
 *
 * source: cortex@ed33435 mcp_server/core/engram.py:63-95
 */
export function findBestSlot(
  slots: EngramSlot[],
  halfLifeHours = 6.0,
): [number, number] {
  if (isMechanismDisabled(Mechanism.ENGRAM_ALLOCATION)) {
    return [0, 0.5]; // source: cortex@ed33435 mcp_server/core/engram.py:79-80 — no-op baseline
  }

  let bestSlot = 0;
  let bestExc = -1.0;

  for (const slot of slots) {
    const exc = computeDecayedExcitability(
      slot.excitability ?? 0.5,
      slot.last_activated,
      halfLifeHours,
    );
    if (exc > bestExc) {
      bestExc = exc;
      bestSlot = slot.slot_index;
    }
  }

  return [bestSlot, bestExc];
}

// ── Boost ─────────────────────────────────────────────────────────────────

/**
 * Boost excitability after slot activation. Capped at 1.0.
 *
 * boostAmount is hand-tuned (no published CREB boost magnitude).
 *
 * postcondition: result = min(currentExcitability + boostAmount, 1.0).
 * source: cortex@ed33435 mcp_server/core/engram.py:98-106
 *   boost_amount default = 0.5 (hand-tuned)
 */
export function computeBoost(
  currentExcitability: number,
  boostAmount = 0.5, // source: cortex@ed33435 mcp_server/core/engram.py:102 — hand-tuned
): number {
  return Math.min(currentExcitability + boostAmount, 1.0);
}

// ── Lateral inhibition ────────────────────────────────────────────────────

/**
 * Compute lateral inhibition: reduce excitability of neighboring slots.
 *
 * NOTE: Biological lateral inhibition is PV+ interneuron-mediated
 * winner-take-all, not distance-based with a fixed radius. This radius
 * model is an engineering approximation. Both inhibitionFactor and
 * inhibitionRadius are hand-tuned.
 *
 * precondition:  activatedSlot ∈ [0, numSlots); numSlots >= 1.
 * postcondition: returned map has entries for neighbors within radius;
 *   each new excitability = max(current - inhibitionFactor, 0.0).
 *
 * source: cortex@ed33435 mcp_server/core/engram.py:109-135
 *   inhibition_factor = 0.25 (hand-tuned)
 *   inhibition_radius = 2 (hand-tuned)
 */
export function computeLateralInhibition(
  activatedSlot: number,
  numSlots: number,
  allExcitabilities: Map<number, number>,
  inhibitionFactor = 0.25, // source: cortex@ed33435 mcp_server/core/engram.py:114 — hand-tuned
  inhibitionRadius = 2,    // source: cortex@ed33435 mcp_server/core/engram.py:115 — hand-tuned
): Map<number, number> {
  const updates = new Map<number, number>();
  for (let offset = -inhibitionRadius; offset <= inhibitionRadius; offset++) {
    if (offset === 0) continue;
    const neighbor = activatedSlot + offset;
    if (neighbor < 0 || neighbor >= numSlots) continue;
    const current = allExcitabilities.get(neighbor) ?? 0.5;
    updates.set(neighbor, Math.max(current - inhibitionFactor, 0.0));
  }
  return updates;
}

// ── Slot statistics ───────────────────────────────────────────────────────

/**
 * Compute aggregate slot statistics.
 *
 * postcondition: returned object has totalSlots, occupiedSlots,
 *   avgExcitability, maxExcitability, slotDistribution.
 *
 * source: cortex@ed33435 mcp_server/core/engram.py:138-167
 */
export function computeSlotStatistics(
  slots: EngramSlot[],
  occupancy: Map<number, number>,
  halfLifeHours = 6.0,
): Record<string, unknown> {
  const excitabilities = slots.map((slot) =>
    computeDecayedExcitability(
      slot.excitability ?? 0.5,
      slot.last_activated,
      halfLifeHours,
    ),
  );

  const occupied = occupancy.size;
  const avgExc = excitabilities.length > 0
    ? excitabilities.reduce((a, b) => a + b, 0) / excitabilities.length
    : 0.0;
  const maxExc = excitabilities.length > 0 ? Math.max(...excitabilities) : 0.0;

  return {
    total_slots: slots.length,
    occupied_slots: occupied,
    avg_excitability: Math.round(avgExc * 1e4) / 1e4,
    max_excitability: Math.round(maxExc * 1e4) / 1e4,
    slot_distribution: Object.fromEntries(occupancy),
  };
}
