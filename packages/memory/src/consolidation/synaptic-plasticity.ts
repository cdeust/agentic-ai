/**
 * Synaptic plasticity — Tsodyks-Markram STP, phase gating, and public API.
 *
 * Tsodyks-Markram short-term plasticity (Tsodyks & Markram 1997, "The neural
 * code between neocortical pyramidal neurons depends on neurotransmitter
 * release probability", PNAS 94:719-723; Markram et al. 1998):
 *
 *   At each spike event:
 *     u_eff = u + U * (1 - u)        (facilitation: residual Ca2+ boost)
 *     x_new = x - u_eff * x          (depression: vesicle depletion)
 *
 *   Between spikes (continuous recovery):
 *     du/dt = -u / tau_F              (facilitation decays, tau_F ~ 530ms)
 *     dx/dt = (1 - x) / tau_D        (vesicles recover, tau_D ~ 130ms)
 *
 *   Effective release = u_eff * x (utilization * available resources)
 *
 *   Timescale adaptation: biological tau_F ~ 530ms, tau_D ~ 130ms.
 *   Adapted to hours: tau_F = 0.5h (30min facilitation), tau_D = 2.0h
 *   (2h vesicle recovery). This is a documented departure — ratio preserved.
 *
 * Phase-gated plasticity: LTP/LTD magnitude is modulated by theta phase
 * (Hasselmo 2005). Encoding phase amplifies LTP; retrieval phase suppresses it.
 *
 * Re-exports Hebbian/STDP functions from synaptic-plasticity-hebbian.
 *
 * Port of: mcp_server/core/synaptic_plasticity.py
 * Pure business logic — no I/O.
 */

// ── Tsodyks-Markram STP Constants (adapted timescale) ──────────────────────

/**
 * U: baseline utilization increment per spike (Tsodyks & Markram 1997)
 * Biological range: 0.15-0.5 depending on synapse type.
 * // source: Tsodyks M & Markram H (1997) "The neural code between neocortical
 * //   pyramidal neurons depends on neurotransmitter release probability."
 * //   PNAS 94:719-723
 */
const U_INCREMENT = 0.2;

/**
 * tau_F: facilitation time constant. Biological: ~530ms.
 * Adapted to hours: 0.5h (30min) — residual Ca2+ decays over ~30 min.
 */
const TAU_F_HOURS = 0.5;

/**
 * tau_D: depression recovery time constant. Biological: ~130ms.
 * Adapted to hours: 2.0h — vesicle replenishment takes ~2h.
 */
const TAU_D_HOURS = 2.0;

const NOISE_SCALE = 0.01;

/** Weight bounds (shared with hebbian module) */
export const MIN_WEIGHT = 0.01;
export const MAX_WEIGHT = 2.0;

// ── Synaptic State (Tsodyks-Markram) ──────────────────────────────────────────

/**
 * Per-edge Tsodyks-Markram STP state.
 *
 * u: utilization parameter (facilitation). Starts at 0, boosted by U on
 *    each spike, decays with tau_F. Represents residual Ca2+ in terminal.
 * x: available resources (1 = full vesicle pool, 0 = depleted). Starts at 1,
 *    depleted by u*x on each spike, recovers with tau_D.
 * access_count: for noise scaling (Bayesian evidence accumulation).
 * hours_since_last_access: for continuous recovery between spikes.
 */
export interface SynapticState {
  u: number;
  x: number;
  access_count: number;
  hours_since_last_access: number;
}

export function makeSynapticState(): SynapticState {
  return { u: 0.0, x: 1.0, access_count: 0, hours_since_last_access: 0.0 };
}

// ── Release Probability (Tsodyks-Markram) ─────────────────────────────────────

/**
 * Effective release: u_eff * x (Tsodyks-Markram 1997).
 *
 * u_eff = U + u * (1 - U): facilitation-boosted utilization.
 * x: available vesicle fraction.
 * Product gives transmission probability, clamped to [0.05, 0.95].
 *
 * Precondition: state.u in [0,1], state.x in [0,1].
 * Postcondition: result in [0.05, 0.95].
 * // source: Tsodyks M & Markram H (1997) PNAS 94:719-723
 */
export function computeEffectiveReleaseProbability(state: SynapticState): number {
  const uEff = U_INCREMENT + state.u * (1.0 - U_INCREMENT);
  const pEff = uEff * state.x;
  return Math.max(0.05, Math.min(0.95, pEff));
}

/**
 * Determine if a synaptic signal propagates (probabilistic).
 *
 * Returns true with probability = effective release probability.
 *
 * Precondition: state is a valid SynapticState.
 * Postcondition: returns a boolean.
 */
export function stochasticTransmit(
  state: SynapticState,
  rng: () => number = Math.random,
): boolean {
  const p = computeEffectiveReleaseProbability(state);
  return rng() < p;
}

// ── Tsodyks-Markram Dynamics ──────────────────────────────────────────────────

function recoverBetweenSpikes(
  u: number,
  x: number,
  hoursElapsed: number,
): [number, number] {
  /**
   * Continuous recovery: u decays to 0, x recovers to 1.
   *
   * Tsodyks-Markram 1997, between-spike analytical solution:
   *   u(t) = u0 * exp(-t / tau_F)
   *   x(t) = 1 - (1 - x0) * exp(-t / tau_D)
   * // source: Tsodyks M & Markram H (1997) PNAS 94:719-723
   */
  if (hoursElapsed <= 0) return [u, x];
  const uNew = u * Math.exp(-hoursElapsed / TAU_F_HOURS);
  const xNew = 1.0 - (1.0 - x) * Math.exp(-hoursElapsed / TAU_D_HOURS);
  return [uNew, xNew];
}

function applySpike(
  u: number,
  x: number,
  accessCount: number,
): [number, number, number, number] {
  /**
   * Spike event: facilitation boost + vesicle depletion.
   *
   * Tsodyks-Markram 1997:
   *   u_new = u + U * (1 - u)    (residual Ca2+ increment)
   *   x_new = x - u_new * x      (release depletes available resources)
   * // source: Tsodyks M & Markram H (1997) PNAS 94:719-723
   */
  const uNew = u + U_INCREMENT * (1.0 - u);
  const xNew = Math.max(0.0, x - uNew * x);
  return [uNew, xNew, accessCount + 1, 0.0];
}

/**
 * Tsodyks-Markram STP update (Tsodyks & Markram 1997).
 *
 * Between spikes (continuous recovery):
 *   u(t) = u0 * exp(-t / tau_F)
 *   x(t) = 1 - (1 - x0) * exp(-t / tau_D)
 *
 * At spike (discrete update):
 *   u_new = u + U * (1 - u)      (facilitation boost)
 *   x_new = x - u_new * x        (vesicle depletion)
 *
 * Precondition: hoursElapsed >= 0; state is a valid SynapticState.
 * Postcondition: returns new SynapticState (original not mutated); u,x in [0,1].
 * // source: Tsodyks M & Markram H (1997) PNAS 94:719-723
 */
export function updateShortTermDynamics(
  state: SynapticState,
  hoursElapsed: number,
  isAccess: boolean = false,
): SynapticState {
  let [u, x] = recoverBetweenSpikes(state.u, state.x, hoursElapsed);

  let accessCount = state.access_count;
  let hoursSince = hoursElapsed;

  if (isAccess) {
    [u, x, accessCount, hoursSince] = applySpike(u, x, accessCount);
  }

  return {
    u: Math.round(u * 1e6) / 1e6,
    x: Math.round(x * 1e6) / 1e6,
    access_count: accessCount,
    hours_since_last_access: hoursSince,
  };
}

// ── Noise Injection ───────────────────────────────────────────────────────────

/**
 * Add Gaussian noise to a weight update, scaled by 1/sqrt(evidence).
 *
 * More observations (higher access_count) -> less noise -> more stable updates.
 *
 * Precondition: accessCount >= 0.
 * Postcondition: returned value is a finite float.
 */
export function computeNoisyWeightUpdate(
  deltaW: number,
  accessCount: number,
  noiseScale: number = NOISE_SCALE,
  rng: () => number = Math.random,
): number {
  const evidenceFactor = accessCount <= 0 ? 1.0 : 1.0 / Math.sqrt(accessCount);
  const sigma = noiseScale * evidenceFactor;
  // Box-Muller approximation for Gaussian noise
  const u1 = Math.max(1e-15, rng());
  const u2 = rng();
  const noise = sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return deltaW + noise;
}

// ── Phase-Gated Plasticity (Hasselmo 2005) ─────────────────────────────────────

/**
 * Modulate plasticity magnitude by theta phase (Hasselmo 2005).
 *
 * Encoding phase (0.0-0.5): LTP amplified, LTD suppressed.
 * Retrieval phase (0.5-1.0): LTP suppressed, LTD amplified.
 * Cosine envelope for smooth transition.
 *
 * Precondition: thetaPhase in [0,1]; deltaW is finite.
 * Postcondition: result has same sign as deltaW.
 * // source: Hasselmo ME (2005) "What is the function of hippocampal theta rhythm?"
 * //   Hippocampus 15:936-949
 */
export function phaseModulatePlasticity(
  deltaW: number,
  thetaPhase: number,
  isLtp: boolean = true,
): number {
  const raw = Math.cos(2.0 * Math.PI * (thetaPhase - 0.25));
  const encodingStrength = 0.65 + 0.35 * raw;

  if (isLtp) return deltaW * encodingStrength;

  const retrievalStrength = 0.65 - 0.35 * raw;
  return deltaW * retrievalStrength;
}

// ── Re-exports from sub-modules ───────────────────────────────────────────────

export {
  applyHebbianUpdate,
  applyStdpBatch,
  computeBcmPhi,
  computeLtd,
  computeLtp,
  computeStdpUpdate,
  updateBcmThreshold,
} from "./synaptic-plasticity-hebbian.js";

export { applyStochasticHebbianUpdate } from "./synaptic-plasticity-stochastic.js";
