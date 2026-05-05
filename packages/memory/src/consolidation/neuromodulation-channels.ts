/**
 * Individual neuromodulator channel computations.
 *
 * Computes per-channel updates for the 4 neuromodulatory channels (DA, NE, ACh, 5-HT)
 * and their cross-coupling interactions.
 *
 * Neuroscience references (see full docstring rationale in source):
 *   Rescorla RA, Wagner AR (1972) Classical Conditioning II, pp. 64-99.
 *     (RPE equation: delta_V = alpha * beta * (lambda - V_total))
 *   Schultz W (1997) Science 275:1593-1599
 *     (DA firing rate data: ~5 Hz tonic, ~20-30 Hz burst)
 *   Doya K (2002) Neural Networks 15:495-506 (framework inspiration)
 *   Aston-Jones G, Cohen JD (2005) Annu Rev Neurosci 28:403-450 (tonic/phasic LC)
 *   Hasselmo ME (2005) Hippocampus 15:936-949 (ACh theta gating)
 *   Dayan P, Huys QJM (2009) Annu Rev Neurosci 32:95-126 (5-HT behavioral inhibition)
 *
 * Port of: mcp_server/core/neuromodulation_channels.py
 * Pure business logic — no I/O.
 */

// ── EMA rates for each channel ────────────────────────────────────────────────
// Ordered by biological response speed. See module docstring for rationale.

/**
 * DA phasic RPE bursts (~100ms in biology).
 * // source: Schultz W (1997) Science 275:1593-1599 (response latency ~100ms)
 */
export const DA_ALPHA = 0.3;

/**
 * LC phasic responses (~seconds in biology).
 * // source: Aston-Jones G, Cohen JD (2005) Annu Rev Neurosci 28:403-450
 */
export const NE_ALPHA = 0.2;

/**
 * ACh tracks theta oscillations (~200ms cycle).
 * // source: Hasselmo ME (2005) Hippocampus 15:936-949
 */
export const ACH_ALPHA = 0.4;

/**
 * 5-HT tonic modulation (minutes/hours in biology).
 * // source: Dayan P, Huys QJM (2009) Annu Rev Neurosci 32:95-126
 */
export const SER_ALPHA = 0.15;

// ── Cross-coupling strengths ──────────────────────────────────────────────────
// Engineering heuristic. Directions are qualitatively plausible but specific
// values are hand-tuned. No paper provides these coupling equations.

const DA_NE_COUPLING = -0.15;  // High DA dampens NE (success reduces arousal)
const NE_ACH_COUPLING = 0.2;   // High NE boosts ACh (arousal enhances encoding)
const SER_DA_COUPLING = -0.1;  // High 5-HT dampens DA (inhibition reduces reward sensitivity)
const ACH_SER_COUPLING = -0.15; // High ACh dampens 5-HT (encoding reduces exploration)

// ── Habituation constants ─────────────────────────────────────────────────────
// Engineering values for NE habituation (repeated stressors reduce response).

export const NE_HABITUATION_RATE = 0.05;
export const NE_HABITUATION_DECAY = 0.02;

// ── Channel Computation Functions ─────────────────────────────────────────────

/**
 * Rescorla-Wagner RPE (Rescorla & Wagner 1972; Schultz 1997).
 *
 * Implements single-CS Rescorla-Wagner:
 *   delta = actual - V(s)                    (prediction error)
 *   V(s) := V(s) + alpha*beta * delta        (learning rule)
 *   DA = 1.0 + delta                         (firing rate mapping)
 *
 * Combined alpha*beta = 0.1 — hand-tuned within standard simulation
 * range [0.01-0.25] (Daw 2011, Sutton & Barto 1998).
 *
 * Clamped to [0.0, 3.0]:
 *   Floor 0.0 — DA neurons cannot fire below zero (Schultz 1997).
 *   Ceiling 3.0 — conservative bound (~3x baseline).
 *
 * @returns [da_level, updated_baseline]
 *
 * Precondition: memoryImportance in [0,1]; daBaseline in [0.1, 0.9].
 * Postcondition: da_level in [0.0, 3.0]; updated_baseline in [0.1, 0.9].
 * // source: Rescorla RA, Wagner AR (1972) Classical Conditioning II, pp. 64-99
 * // source: Schultz W (1997) Science 275:1593-1599
 */
export function computeDopamineRpe(
  outcomePositive: boolean,
  outcomeNegative: boolean,
  memoryImportance: number,
  daBaseline: number,
): [number, number] {
  // Hand-tuned reward mapping — no paper provides this translation.
  let actual: number;
  if (outcomePositive) {
    actual = 0.7 + memoryImportance * 0.3;
  } else if (outcomeNegative) {
    actual = 0.2 - memoryImportance * 0.1;
  } else {
    actual = 0.5;
  }

  // Rescorla-Wagner: delta = lambda - V(s)
  const delta = actual - daBaseline;
  // Schultz: DA firing = baseline * (1 + delta), clamped to [0, 3x baseline]
  const da = Math.max(0.0, Math.min(3.0, 1.0 + delta));

  // Rescorla-Wagner: V(s) := V(s) + alpha*beta * (actual - V(s))
  // Combined alpha*beta = 0.1 (hand-tuned, within standard range)
  const newBaseline = Math.max(0.1, Math.min(0.9, daBaseline + 0.1 * (actual - daBaseline)));

  return [da, newBaseline];
}

/**
 * Arousal model inspired by Aston-Jones & Cohen (2005) tonic/phasic LC framework.
 *
 * Simplified to burst/decay for hours timescale. Errors trigger phasic NE burst
 * (attenuated by habituation). Absence of errors decays NE toward tonic baseline (1.0).
 * All numeric constants are hand-tuned.
 *
 * @returns [ne_level, updated_adaptation]
 *
 * Precondition: currentNe in [0.3, 2.0]; neAdaptation in [0.0, 0.8].
 * Postcondition: ne_level in [0.3, 2.0]; updated_adaptation in [0.0, 0.8].
 * // source: Aston-Jones G, Cohen JD (2005) Annu Rev Neurosci 28:403-450 (qualitative)
 */
export function computeNorepinephrineArousal(
  errorEncountered: boolean,
  currentNe: number,
  neAdaptation: number,
): [number, number] {
  let ne: number;
  let newAdapt: number;

  if (errorEncountered) {
    const burst = 0.5 * (1.0 - neAdaptation);
    ne = Math.min(2.0, currentNe + burst);
    newAdapt = Math.min(0.8, neAdaptation + NE_HABITUATION_RATE);
  } else {
    ne = currentNe + 0.1 * (1.0 - currentNe);
    newAdapt = Math.max(0.0, neAdaptation - NE_HABITUATION_DECAY);
  }

  return [Math.max(0.3, Math.min(2.0, ne)), newAdapt];
}

/**
 * Exploration/exploitation signal — engineering translation of Dayan & Huys (2009).
 *
 * Dayan & Huys show 5-HT opposes impulsive responding and promotes behavioral
 * inhibition. High schema match promotes exploitation (lower 5-HT), high novelty
 * promotes exploration (higher 5-HT). Direction is qualitatively consistent;
 * specific formula is an engineering approximation.
 *
 * @returns Updated 5-HT level (EMA-blended with current).
 *
 * Precondition: schemaMatch in [0,1]; novelEntities >= 0; totalEntities >= 0.
 * Postcondition: result in [0.3, 1.8].
 * // source: Dayan P, Huys QJM (2009) Annu Rev Neurosci 32:95-126 (direction only)
 */
export function computeSerotoninExploration(
  schemaMatch: number,
  novelEntities: number,
  totalEntities: number,
  currentSer: number,
): number {
  const noveltyRatio =
    totalEntities > 0 ? novelEntities / Math.max(totalEntities, 1) : 0.5;
  const exploitationSignal = schemaMatch;

  const target = Math.max(
    0.3,
    Math.min(1.8, 0.5 + noveltyRatio * 0.8 - exploitationSignal * 0.5),
  );

  return currentSer + SER_ALPHA * (target - currentSer);
}

/**
 * Linear additive cross-coupling — engineering heuristic.
 *
 * Coupling directions are qualitatively plausible:
 *   DA dampens NE — success reduces arousal.
 *   NE boosts ACh — arousal enhances encoding.
 *   5-HT dampens DA — inhibition reduces reward sensitivity.
 *   ACh dampens 5-HT — encoding reduces exploration.
 * Specific coupling constants are hand-tuned. No paper provides these equations.
 *
 * @returns Post-coupling [da, ne, ach, ser].
 *
 * Precondition: da in [0,3]; ne, ach, ser in [0.3, 2.0].
 * Postcondition: da in [0,3]; ne, ach, ser in [0.3, 2.0].
 */
export function applyCrossCoupling(
  da: number,
  ne: number,
  ach: number,
  ser: number,
): [number, number, number, number] {
  const neCoupled = ne + DA_NE_COUPLING * (da - 1.0);
  const achCoupled = ach + NE_ACH_COUPLING * (ne - 1.0);
  const daCoupled = da + SER_DA_COUPLING * (ser - 1.0);
  const serCoupled = ser + ACH_SER_COUPLING * (ach - 1.0);

  return [
    Math.max(0.0, Math.min(3.0, daCoupled)),  // DA: asymmetric [0, 3] per Schultz 1997
    Math.max(0.3, Math.min(2.0, neCoupled)),
    Math.max(0.3, Math.min(2.0, achCoupled)),
    Math.max(0.3, Math.min(2.0, serCoupled)),
  ];
}
