/**
 * Decay cycle — periodic heat decay with consolidation-dependent permastore.
 *
 * Two decay models, both gated by consolidation stage and permastore floor:
 *
 * 1. Exponential (default): heat(t) = heat(0) * lambda^t  (Ebbinghaus 1885).
 *    Decay rate is stage-adjusted via computeStageAdjustedDecay():
 *    LABILE decays 2x faster, CONSOLIDATED decays 2x slower.
 *
 * 2. ACT-R base-level activation (adaptiveDecay=true):
 *    Anderson JR, Lebiere C (1998) "The Atomic Components of Thought", Eq. 4.4.
 *    B_i = ln(n) - d * ln(L)  where n=accesses, L=lifetime, d=0.5.
 *
 * Both paths enforce a consolidation-dependent heat floor (permastore):
 *   - LABILE, EARLY_LTP: floor = 0.0 (can decay to zero)
 *   - LATE_LTP: floor = 0.05 (partial structural support)
 *   - CONSOLIDATED: floor = 0.10 (permanent — Bahrick 1984, Kandel 2001)
 *   - RECONSOLIDATING: floor = 0.05 (was consolidated, temporarily labile)
 *
 * The permastore mechanism is grounded in:
 *   // source: Bahrick HP (1984) "Semantic memory content in permastore" —
 *     30-year retention plateau without rehearsal.
 *   // source: Kandel ER (2001) "Molecular biology of memory storage" —
 *     at 72h post-encoding, structural synaptic changes are permanent.
 *   // source: Benna MK & Fusi S (2016) "Computational principles of synaptic memory
 *     consolidation" — cascade models produce non-zero retention floors.
 *
 * Port of: mcp_server/core/decay_cycle.py
 * Pure business logic — no I/O.
 */

import { computeStageAdjustedDecay, getHeatFloor } from "./cascade-stages.js";
import { computeDecay } from "./thermodynamics.js";

// ── ACT-R Constants (Anderson & Lebiere 1998) ─────────────────────────────────

// d: base decay parameter. Standard ACT-R value is 0.5.
const ACT_R_DECAY_D = 0.5;

// s: noise parameter for activation → probability mapping.
// Standard ACT-R uses s ≈ 0.4. We use 1.0 for our hours timescale.
const ACT_R_NOISE_S = 1.0;

// Minimum hours to avoid log(0)
const MIN_LIFETIME_HOURS = 0.01;

// ── DateTime Helpers ──────────────────────────────────────────────────────────

function parseDatetime(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string" && value) {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function hoursSinceAccess(
  mem: Record<string, unknown>,
  now: Date,
): number | null {
  const lastAccessed = mem["last_accessed"] ?? mem["created_at"] ?? "";
  const lastDt = parseDatetime(lastAccessed);
  if (!lastDt) return null;
  const hours = (now.getTime() - lastDt.getTime()) / 3_600_000;
  return hours > 0 ? hours : null;
}

function hoursSinceCreation(
  mem: Record<string, unknown>,
  now: Date,
): number | null {
  const created = mem["created_at"] ?? "";
  const createdDt = parseDatetime(created);
  if (!createdDt) return null;
  const hours = (now.getTime() - createdDt.getTime()) / 3_600_000;
  return Math.max(MIN_LIFETIME_HOURS, hours);
}

// ── ACT-R Path ────────────────────────────────────────────────────────────────

/**
 * ACT-R base-level activation (Anderson & Lebiere 1998, Eq. 4.4).
 *
 * B_i = ln(sum_j(t_j^{-d}))
 *
 * Approximation assuming uniformly spaced accesses over lifetime:
 * B_i ≈ ln(n) - d * ln(L)
 *
 * where n = accessCount (minimum 1), L = lifetime in hours.
 *
 * Returns raw activation (can be negative = below retrieval threshold).
 * // source: Anderson JR, Lebiere C (1998) "The Atomic Components of Thought", Eq. 4.4.
 */
export function computeActrBaseLevel(
  accessCount: number,
  lifetimeHours: number,
  d = ACT_R_DECAY_D,
): number {
  const n = Math.max(1, accessCount);
  const L = Math.max(MIN_LIFETIME_HOURS, lifetimeHours);
  return Math.log(n) - d * Math.log(L);
}

/**
 * Map ACT-R base-level activation to heat [0, 1] via logistic.
 *
 * P(recall) = 1 / (1 + exp(-B_i / s))  (Anderson & Lebiere 1998, Eq. 4.5)
 * // source: Anderson JR, Lebiere C (1998) "The Atomic Components of Thought", Eq. 4.5.
 */
export function actrActivationToHeat(baseLevel: number, s = ACT_R_NOISE_S): number {
  return 1.0 / (1.0 + Math.exp(-baseLevel / s));
}

function computeActrDecay(
  mem: Record<string, unknown>,
  now: Date,
  importance = 0.5,
  valence = 0.0,
): number | null {
  const lifetime = hoursSinceCreation(mem, now);
  if (lifetime === null) return null;

  const accessCount = (mem["access_count"] as number | undefined) ?? 1;

  // Modulate d based on importance and emotion
  let d = ACT_R_DECAY_D;
  if (importance > 0.7) d *= 0.8; // Important memories decay 20% slower
  d *= 1.0 - Math.abs(valence) * 0.3; // Emotional memories resist decay
  d = Math.max(0.1, d); // Floor to prevent d=0

  const baseLevel = computeActrBaseLevel(accessCount, lifetime, d);
  return actrActivationToHeat(baseLevel);
}

// ── Single Memory Decay ───────────────────────────────────────────────────────

function computeSingleDecay(
  mem: Record<string, unknown>,
  now: Date,
  decayFactor: number,
  importanceDecayFactor: number,
  emotionalDecayResistance: number,
  adaptiveDecay = false,
): [number, number] | null {
  const currentHeat = (mem["heat"] as number | undefined) ?? 0.0;
  const stage = (mem["consolidation_stage"] as string | undefined) ?? "labile";

  // Permastore floor: consolidated memories are always retrievable
  const floor = getHeatFloor(stage);

  let newHeat: number;

  if (adaptiveDecay) {
    // ACT-R path: compute heat from base-level activation
    const actrResult = computeActrDecay(
      mem,
      now,
      (mem["importance"] as number | undefined) ?? 0.5,
      (mem["emotional_valence"] as number | undefined) ?? 0.0,
    );
    if (actrResult === null) return null;
    newHeat = Math.min(currentHeat, actrResult);
  } else {
    // Ebbinghaus exponential path with stage-adjusted rate
    const hours = hoursSinceAccess(mem, now);
    if (hours === null) return null;

    // Apply consolidation stage multiplier (Kandel 2001)
    const adjDecay = computeStageAdjustedDecay(decayFactor, stage);
    const adjImpDecay = computeStageAdjustedDecay(importanceDecayFactor, stage);

    newHeat = computeDecay(
      currentHeat,
      hours,
      (mem["importance"] as number | undefined) ?? 0.5,
      (mem["emotional_valence"] as number | undefined) ?? 0.0,
      (mem["confidence"] as number | undefined) ?? 1.0,
      {
        decayFactor: adjDecay,
        importanceDecayFactor: adjImpDecay,
        emotionalDecayResistance,
      },
    );
  }

  // Enforce permastore floor (Bahrick 1984)
  newHeat = Math.max(floor, newHeat);

  if (Math.abs(newHeat - currentHeat) > 0.001) {
    return [(mem["id"] as number), Math.round(newHeat * 1_000_000) / 1_000_000];
  }
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface DecayOptions {
  decayFactor?: number;
  importanceDecayFactor?: number;
  emotionalDecayResistance?: number;
  coldThreshold?: number;
  adaptiveDecay?: boolean;
}

/**
 * Compute new heat values for all memories.
 *
 * Returns list of (memoryId, newHeat) tuples for memories that changed.
 * Skips protected memories and already-cold memories.
 *
 * When adaptiveDecay=true, uses ACT-R base-level activation
 * (Anderson & Lebiere 1998) instead of exponential forgetting.
 */
export function computeDecayUpdates(
  memories: readonly Record<string, unknown>[],
  now: Date | null = null,
  opts: DecayOptions = {},
): Array<[number, number]> {
  const ts = now ?? new Date();
  const {
    decayFactor = 0.95,
    importanceDecayFactor = 0.998,
    emotionalDecayResistance = 0.5,
    coldThreshold = 0.05,
    adaptiveDecay = false,
  } = opts;

  const updates: Array<[number, number]> = [];
  for (const mem of memories) {
    if (mem["is_protected"] || ((mem["heat"] as number | undefined) ?? 0.0) < coldThreshold) {
      continue;
    }
    const result = computeSingleDecay(
      mem,
      ts,
      decayFactor,
      importanceDecayFactor,
      emotionalDecayResistance,
      adaptiveDecay,
    );
    if (result !== null) updates.push(result);
  }
  return updates;
}

/**
 * Compute new heat values for entities.
 *
 * Entities use exponential decay (simpler — no access history tracked).
 * Returns list of (entityId, newHeat) tuples.
 */
export function computeEntityDecay(
  entities: readonly Record<string, unknown>[],
  now: Date | null = null,
  opts: { decayFactor?: number; coldThreshold?: number } = {},
): Array<[number, number]> {
  const ts = now ?? new Date();
  const { decayFactor = 0.98, coldThreshold = 0.05 } = opts;

  const updates: Array<[number, number]> = [];
  for (const entity of entities) {
    const currentHeat = (entity["heat"] as number | undefined) ?? 0.0;
    if (currentHeat < coldThreshold) continue;

    const lastAccessed = entity["last_accessed"] ?? entity["created_at"] ?? "";
    const lastDt = parseDatetime(lastAccessed);
    if (!lastDt) continue;

    const hours = (ts.getTime() - lastDt.getTime()) / 3_600_000;
    if (hours <= 0) continue;

    const newHeat = currentHeat * Math.pow(decayFactor, hours);
    if (Math.abs(newHeat - currentHeat) > 0.001) {
      updates.push([entity["id"] as number, Math.round(newHeat * 1_000_000) / 1_000_000]);
    }
  }
  return updates;
}
