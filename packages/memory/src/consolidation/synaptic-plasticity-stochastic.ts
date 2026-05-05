/**
 * Stochastic Hebbian LTP/LTD with Tsodyks-Markram gating and phase modulation.
 *
 * Combines Tsodyks-Markram stochastic release (Tsodyks & Markram 1997), BCM
 * Hebbian LTP/LTD (Bienenstock, Cooper & Munro 1982), additive noise, and
 * theta-phase gating (Hasselmo 2005).
 *
 * Port of: mcp_server/core/synaptic_plasticity_stochastic.py
 * Pure business logic — no I/O.
 */

import type { SynapticState } from "./synaptic-plasticity.js";
import {
  MIN_WEIGHT,
  MAX_WEIGHT,
  computeNoisyWeightUpdate,
  phaseModulatePlasticity,
  stochasticTransmit,
  updateShortTermDynamics,
} from "./synaptic-plasticity.js";

import { computeLtp, computeLtd } from "./synaptic-plasticity-hebbian.js";

// LTP/LTD rates — mirrors defaults from hebbian module
const LTP_RATE = 0.05;
const LTD_RATE = 0.02;

function buildSynapticState(
  edge: Record<string, unknown>,
  hours: number,
): SynapticState {
  return {
    u: (edge["u"] as number | undefined) ?? 0.0,
    x: (edge["x"] as number | undefined) ?? 1.0,
    access_count: (edge["access_count"] as number | undefined) ?? 0,
    hours_since_last_access:
      (edge["hours_since_last_access"] as number | undefined) ?? hours,
  };
}

function stochasticLtp(
  w: number,
  syn: SynapticState,
  src: number,
  tgt: number,
  activities: Map<number, number>,
  thresholds: Map<number, number>,
  thetaPhase: number | null,
  ltpRate: number,
  rng: () => number,
): [number, string] {
  /**
   * Stochastic LTP: gate -> compute -> phase-modulate -> add noise.
   * Precondition: syn is a valid SynapticState; w in [MIN_WEIGHT, MAX_WEIGHT].
   * Postcondition: returns [new_weight, action]; new_weight in [MIN_WEIGHT, MAX_WEIGHT].
   */
  if (!stochasticTransmit(syn, rng)) return [w, "blocked"];

  const newW = computeLtp(
    w,
    1.0,                                          // co_activation
    activities.get(src) ?? 0.5,
    activities.get(tgt) ?? 0.5,
    thresholds.get(tgt) ?? 0.5,
    ltpRate,
  );
  let delta = newW - w;
  if (thetaPhase !== null && delta > 0) {
    delta = phaseModulatePlasticity(delta, thetaPhase, true);
  }
  delta = computeNoisyWeightUpdate(delta, syn.access_count, 0.01, rng);
  const finalW = Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, w + delta));
  return [finalW, finalW > w ? "ltp" : "none"];
}

function stochasticLtd(
  w: number,
  hours: number,
  thetaPhase: number | null,
  ltdRate: number,
): [number, string] {
  /**
   * LTD with optional phase gating for non-co-accessed edges.
   * Postcondition: new_weight in [MIN_WEIGHT, MAX_WEIGHT].
   */
  let newW = computeLtd(w, hours, ltdRate);
  let delta = newW - w;
  if (thetaPhase !== null && delta < 0) {
    delta = phaseModulatePlasticity(delta, thetaPhase, false);
    newW = Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, w + delta));
  }
  return [newW, newW < w ? "ltd" : "none"];
}

function stochasticSingle(
  edge: Record<string, unknown>,
  coAccessedPairs: Set<string>,
  entityActivities: Map<number, number>,
  entityThresholds: Map<number, number>,
  hours: number,
  thetaPhase: number | null,
  ltpRate: number,
  ltdRate: number,
  rng: () => number,
): Record<string, unknown> {
  /**
   * Process a single edge for stochastic Hebbian update.
   *
   * Tsodyks-Markram order of operations at a spike:
   *   1. Recover u and x between spikes (continuous dynamics)
   *   2. Compute u_eff and check stochastic release (pre-spike state)
   *   3. Apply spike update (facilitation boost + vesicle depletion)
   */
  const src = edge["source_entity_id"] as number;
  const tgt = edge["target_entity_id"] as number;
  const w = (edge["weight"] as number | undefined) ?? 1.0;
  const pairKey = `${Math.min(src, tgt)},${Math.max(src, tgt)}`;
  const isCo = coAccessedPairs.has(pairKey);

  // 1. Recover between spikes (but don't apply spike yet)
  const preSpike = updateShortTermDynamics(buildSynapticState(edge, hours), hours, false);

  let newW: number;
  let action: string;
  let postSpike: SynapticState;

  if (isCo) {
    // 2. Check transmission using pre-spike state
    [newW, action] = stochasticLtp(
      w, preSpike, src, tgt, entityActivities, entityThresholds, thetaPhase, ltpRate, rng,
    );
    // 3. Apply spike update after transmission check
    postSpike = updateShortTermDynamics(preSpike, 0.0, true);
  } else {
    [newW, action] = stochasticLtd(w, hours, thetaPhase, ltdRate);
    postSpike = preSpike;
  }

  return {
    ...edge,
    weight: Math.round(newW * 1e6) / 1e6,
    delta: Math.round((newW - w) * 1e6) / 1e6,
    action,
    u: postSpike.u,
    x: postSpike.x,
    access_count: postSpike.access_count,
  };
}

/**
 * Hebbian LTP/LTD with Tsodyks-Markram stochastic gating + phase modulation.
 *
 * @param edges - List of edge objects (each with source_entity_id, target_entity_id, weight).
 * @param coAccessedPairs - Set of "min,max" entity ID pair strings that were co-accessed.
 * @param entityActivities - Map of entity_id -> activity level.
 * @param entityThresholds - Map of entity_id -> BCM threshold.
 * @param hoursSinceLastUpdate - Time since last update (hours).
 * @param thetaPhase - Current theta phase [0,1] or null to disable phase gating.
 * @param ltpRate - LTP learning rate.
 * @param ltdRate - LTD learning rate.
 * @param rng - Random number generator (Math.random by default).
 * @returns Updated edge objects with weight, delta, action, u, x, access_count.
 *
 * Precondition: edges is an array; coAccessedPairs contains "min,max" formatted strings.
 * Postcondition: result.length === edges.length; each edge has updated weight in [MIN_WEIGHT, MAX_WEIGHT].
 */
export function applyStochasticHebbianUpdate(
  edges: Record<string, unknown>[],
  coAccessedPairs: Set<string>,
  entityActivities: Map<number, number>,
  entityThresholds: Map<number, number>,
  hoursSinceLastUpdate: number = 1.0,
  thetaPhase: number | null = null,
  ltpRate: number = LTP_RATE,
  ltdRate: number = LTD_RATE,
  rng: () => number = Math.random,
): Record<string, unknown>[] {
  return edges.map((edge) =>
    stochasticSingle(
      edge,
      coAccessedPairs,
      entityActivities,
      entityThresholds,
      hoursSinceLastUpdate,
      thetaPhase,
      ltpRate,
      ltdRate,
      rng,
    ),
  );
}
