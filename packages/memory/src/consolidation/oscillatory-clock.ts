/**
 * Oscillatory phase computation and clock state transitions.
 *
 * Theta gating implements Hasselmo's piecewise model (2002) via sigmoid:
 *   gate(phase) = 1 / (1 + exp(-k * (phase - 0.5)))
 *   enc(phase)  = 1.0 - gate(phase) * X       (EC->CA1 gain)
 *   ret(phase)  = (1-X) + gate(phase) * X     (CA3->CA1 gain)
 *   ach(phase)  = 1.0 - gate(phase) * (1 - ach_baseline)
 *
 * X=0.7 from Hasselmo 2002 Table 1; k=20 for sharp differentiable transition.
 * At k->inf this recovers the paper's discrete piecewise switch.
 * enc + ret = 2 - X = 1.3 at all phases (zero-sum tradeoff).
 *
 * // source: Hasselmo, Bodelon & Wyble (2002) Neural Computation 14:793-817.
 *   X=0.7 from Table 1 — best performance at high cholinergic suppression.
 * // source: Hasselmo (2005) Hippocampus 15:936-949 — ACh modulation formula.
 * // source: Lisman & Jensen (2013) Neuron 77:1002-1016 — gamma capacity 7 items.
 * // source: Buzsaki (2015) Hippocampus 25:1073-1188 — SWR consolidation windows.
 * // source: Olafsdottir et al. (2018) Curr Biol 28:R37-R50 — replay priority.
 *
 * Port of: mcp_server/core/oscillatory_clock.py + oscillatory_phases.py
 * Pure business logic — no I/O.
 */

// ── Phase Enumerations ────────────────────────────────────────────────────────

export type ThetaPhaseName = "encoding" | "retrieval" | "transition";
export type SWRStateName = "quiescent" | "ripple" | "refractory";

// ── Hasselmo Piecewise Gating Parameters ────────────────────────────────────

// Suppression magnitude X: fraction of transmission reduction in the
// suppressed pathway. X=0.7 means 70% suppression of CA3->CA1 during
// encoding (or EC->CA1 during retrieval).
// // source: Hasselmo, Bodelon & Wyble (2002), Table 1.
export const SUPPRESSION_X = 0.7;

// Sigmoid steepness for the encoding/retrieval transition.
// k=20 gives a sharp transition where gate(0.25) < 0.01 and gate(0.75) > 0.99.
export const SIGMOID_STEEPNESS = 20;

// Tonic ACh floor during retrieval phase.
// // source: Hasselmo (2005): during encoding ACh is near 1.0; retrieval drops to baseline.
export const ACH_BASELINE = 0.3;

// Transition zone width (fraction of cycle on each side of phase boundary)
export const TRANSITION_WIDTH = 0.08;

// Gamma capacity per theta cycle.
// // source: Lisman & Jensen (2013): ~7 items.
export const GAMMA_CAPACITY = 7;

// SWR engineering constants — hand-tuned, not from a specific paper.
export const SWR_MIN_INTERVAL_HOURS = 0.5;
export const SWR_BASE_PROBABILITY = 0.3;
export const SWR_BURST_STEPS = 5;
export const SWR_REFRACTORY_STEPS = 3;

// ── Oscillatory State ─────────────────────────────────────────────────────────

export interface OscillatoryState {
  readonly thetaPhase: number;
  readonly gammaCount: number;
  readonly swrState: SWRStateName;
  readonly swrStepsRemaining: number;
  readonly thetaCyclesTotal: number;
  readonly operationsSinceSwr: number;
  readonly hoursSinceLastSwr: number;
  readonly achLevel: number;
}

export function makeInitialOscillatoryState(): OscillatoryState {
  return {
    thetaPhase: 0.0,
    gammaCount: 0,
    swrState: "quiescent",
    swrStepsRemaining: 0,
    thetaCyclesTotal: 0,
    operationsSinceSwr: 0,
    hoursSinceLastSwr: 0.0,
    achLevel: 0.8, // Start in encoding mode
  };
}

// ── Sigmoid Gate (Hasselmo piecewise model) ───────────────────────────────────

function sigmoidGate(phase: number, k = SIGMOID_STEEPNESS): number {
  const exponent = -k * (phase - 0.5);
  // Clamp to avoid overflow in exp()
  if (exponent > 500.0) return 0.0;
  if (exponent < -500.0) return 1.0;
  return 1.0 / (1.0 + Math.exp(exponent));
}

// ── Theta Phase Logic ─────────────────────────────────────────────────────────

/** Classify a theta phase value into encoding, retrieval, or transition. */
export function classifyThetaPhase(phase: number): ThetaPhaseName {
  const p = phase % 1.0;
  if (p < TRANSITION_WIDTH || p > 1.0 - TRANSITION_WIDTH) return "transition";
  if (Math.abs(p - 0.5) < TRANSITION_WIDTH) return "transition";
  if (p < 0.5) return "encoding";
  return "retrieval";
}

/**
 * EC->CA1 gain: 1.0 during encoding, (1-X)=0.3 during retrieval.
 * // source: Hasselmo 2002: enc(phase) = 1.0 - gate(phase) * X.
 */
export function computeEncodingStrength(phase: number): number {
  const p = phase % 1.0;
  return 1.0 - sigmoidGate(p) * SUPPRESSION_X;
}

/**
 * CA3->CA1 gain: (1-X)=0.3 during encoding, 1.0 during retrieval.
 * // source: Hasselmo 2002: ret(phase) = (1-X) + gate(phase) * X.
 * Complementary: enc + ret = 2 - X = 1.3 at all phases.
 */
export function computeRetrievalStrength(phase: number): number {
  const p = phase % 1.0;
  return (1.0 - SUPPRESSION_X) + sigmoidGate(p) * SUPPRESSION_X;
}

/**
 * ACh level: ~1.0 during encoding, ACH_BASELINE=0.3 during retrieval.
 * // source: Hasselmo 2005: ach(phase) = 1.0 - gate(phase) * (1 - ach_baseline).
 */
export function computeAchFromPhase(phase: number): number {
  const p = phase % 1.0;
  return 1.0 - sigmoidGate(p) * (1.0 - ACH_BASELINE);
}

// ── Gamma Binding ─────────────────────────────────────────────────────────────

/** Check if there is gamma capacity to bind another item this theta cycle. */
export function canBindItem(gammaCount: number, capacity = GAMMA_CAPACITY): boolean {
  return gammaCount < capacity;
}

/**
 * Compute binding strength for the Nth item in a gamma sequence.
 * Models the serial position effect (primacy + recency).
 * Returns value in [0.5, 1.0].
 */
export function gammaBindingStrength(position: number, capacity = GAMMA_CAPACITY): number {
  if (capacity <= 1) return 1.0;
  const primacy = Math.exp(-0.5 * position);
  const recency = Math.exp(-0.5 * (capacity - 1 - position));
  const raw = Math.max(primacy, recency);
  return 0.5 + 0.5 * Math.min(raw, 1.0);
}

// ── SWR Logic ─────────────────────────────────────────────────────────────────

function computeSwrProbability(
  operationsSinceSwr: number,
  hoursSinceLastSwr: number,
  accumulatedImportance: number,
  baseProbability: number,
): number {
  const opFactor = Math.min(operationsSinceSwr / 20.0, 1.0);
  const impFactor = Math.min(accumulatedImportance / 5.0, 1.0);
  const timeFactor = Math.min(hoursSinceLastSwr / 4.0, 1.0);
  return baseProbability * (0.4 * opFactor + 0.3 * impFactor + 0.3 * timeFactor);
}

/** Determine whether to generate a sharp-wave ripple event. */
export function shouldGenerateSwr(
  operationsSinceSwr: number,
  hoursSinceLastSwr: number,
  accumulatedImportance = 0.0,
  opts: {
    minIntervalHours?: number;
    baseProbability?: number;
  } = {},
): boolean {
  const { minIntervalHours = SWR_MIN_INTERVAL_HOURS, baseProbability = SWR_BASE_PROBABILITY } = opts;
  if (hoursSinceLastSwr < minIntervalHours) return false;
  if (operationsSinceSwr < 3) return false;
  const probability = computeSwrProbability(
    operationsSinceSwr,
    hoursSinceLastSwr,
    accumulatedImportance,
    baseProbability,
  );
  return probability >= baseProbability * 0.5;
}

// ── Replay Priority ───────────────────────────────────────────────────────────

function computeHeatScore(heat: number): number {
  return Math.max(0.0, 1.0 - 4.0 * Math.pow(heat - 0.5, 2));
}

/**
 * Compute which memories should be replayed during an SWR event.
 *
 * Prioritizes: high importance, moderate heat, high surprise, low access count,
 * and recent memories.
 * // source: Olafsdottir et al. (2018) Curr Biol 28:R37-R50.
 */
export function computeReplayPriority(
  heat: number,
  importance: number,
  surprise: number,
  accessCount: number,
  hoursSinceCreation: number,
): number {
  const heatScore = computeHeatScore(heat);
  const rehearsalNeed = 1.0 / (1.0 + accessCount * 0.5);
  const recency = Math.exp(-hoursSinceCreation / 168.0); // Week time constant

  const priority =
    importance * 0.35 +
    heatScore * 0.20 +
    surprise * 0.20 +
    rehearsalNeed * 0.15 +
    recency * 0.10;

  return Math.min(1.0, Math.max(0.0, priority));
}

// ── State Transitions ─────────────────────────────────────────────────────────

/**
 * Advance the theta clock by a number of operations.
 *
 * Each operation advances the phase by 1/operationsPerCycle. When the phase
 * wraps past 1.0, a new theta cycle begins and gamma resets.
 */
export function advanceTheta(
  state: OscillatoryState,
  operations = 1,
  operationsPerCycle = 20,
): OscillatoryState {
  const phaseIncrement = operations / operationsPerCycle;
  const rawPhase = state.thetaPhase + phaseIncrement;
  const newCycles = state.thetaCyclesTotal + Math.floor(rawPhase);
  const newPhase = rawPhase % 1.0;

  const gammaCount =
    Math.floor(state.thetaPhase + phaseIncrement) === 0 ? state.gammaCount : 0;

  return {
    ...state,
    thetaPhase: Math.round(newPhase * 1_000_000) / 1_000_000,
    gammaCount,
    thetaCyclesTotal: newCycles,
    operationsSinceSwr: state.operationsSinceSwr + operations,
    achLevel: Math.round(computeAchFromPhase(newPhase) * 10000) / 10000,
  };
}

/** Record a gamma binding event (one item bound). */
export function advanceGamma(state: OscillatoryState): OscillatoryState {
  return { ...state, gammaCount: state.gammaCount + 1 };
}

/** Transition to SWR (sharp-wave ripple) state. */
export function beginSwr(state: OscillatoryState): OscillatoryState {
  return {
    ...state,
    swrState: "ripple",
    swrStepsRemaining: SWR_BURST_STEPS,
    operationsSinceSwr: 0,
    hoursSinceLastSwr: 0.0,
  };
}

function nextSwrState(
  swrState: SWRStateName,
  remaining: number,
): [SWRStateName, number] {
  if (swrState === "ripple") {
    const newRemaining = remaining - 1;
    if (newRemaining <= 0) return ["refractory", SWR_REFRACTORY_STEPS];
    return [swrState, newRemaining];
  }
  if (swrState === "refractory") {
    const newRemaining = remaining - 1;
    if (newRemaining <= 0) return ["quiescent", 0];
    return [swrState, newRemaining];
  }
  return [swrState, remaining];
}

/** Advance one consolidation step during SWR or refractory period. */
export function stepSwr(state: OscillatoryState): OscillatoryState {
  const [swrState, remaining] = nextSwrState(state.swrState, state.swrStepsRemaining);
  return { ...state, swrState, swrStepsRemaining: remaining };
}

/** Check if the system is in an active SWR (replay/plasticity enabled). */
export function isSwrActive(state: OscillatoryState): boolean {
  return state.swrState === "ripple";
}

// ── Phase-Gated Modulation ────────────────────────────────────────────────────

/** Apply oscillatory modulation to an encoding operation. SWR suppresses new encoding. */
export function modulateEncoding(baseStrength: number, state: OscillatoryState): number {
  let phaseMod = computeEncodingStrength(state.thetaPhase);
  if (isSwrActive(state)) phaseMod *= 0.3;
  return baseStrength * phaseMod;
}

/** Apply oscillatory modulation to a retrieval operation. */
export function modulateRetrieval(baseScore: number, state: OscillatoryState): number {
  return baseScore * computeRetrievalStrength(state.thetaPhase);
}

/**
 * Apply oscillatory modulation to a plasticity update (LTP/LTD).
 * During SWR, replay-driven plasticity is boosted.
 */
export function modulatePlasticity(baseDelta: number, state: OscillatoryState): number {
  if (isSwrActive(state)) return baseDelta * 1.5;
  return baseDelta * computeEncodingStrength(state.thetaPhase);
}

// ── Serialization ─────────────────────────────────────────────────────────────

export function stateToDict(state: OscillatoryState): Record<string, unknown> {
  return {
    theta_phase: state.thetaPhase,
    gamma_count: state.gammaCount,
    swr_state: state.swrState,
    swr_steps_remaining: state.swrStepsRemaining,
    theta_cycles_total: state.thetaCyclesTotal,
    operations_since_swr: state.operationsSinceSwr,
    hours_since_last_swr: state.hoursSinceLastSwr,
    ach_level: state.achLevel,
  };
}

export function stateFromDict(data: Record<string, unknown>): OscillatoryState {
  return {
    thetaPhase: (data["theta_phase"] as number | undefined) ?? 0.0,
    gammaCount: (data["gamma_count"] as number | undefined) ?? 0,
    swrState: ((data["swr_state"] as string | undefined) ?? "quiescent") as SWRStateName,
    swrStepsRemaining: (data["swr_steps_remaining"] as number | undefined) ?? 0,
    thetaCyclesTotal: (data["theta_cycles_total"] as number | undefined) ?? 0,
    operationsSinceSwr: (data["operations_since_swr"] as number | undefined) ?? 0,
    hoursSinceLastSwr: (data["hours_since_last_swr"] as number | undefined) ?? 0.0,
    achLevel: (data["ach_level"] as number | undefined) ?? 0.8,
  };
}
