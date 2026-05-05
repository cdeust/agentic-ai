/**
 * Hebbian LTP/LTD and STDP updates.
 *
 * BCM theory (Bienenstock, Cooper & Munro 1982, "Theory for the development
 * of neuron selectivity", J Neuroscience 2:32-48):
 *   phi(c, theta_m) = c * (c - theta_m)
 *   dw/dt = phi(c, theta_m) * d
 *   theta_m = E[c^2]  (sliding threshold)
 *
 *   When c > theta_m: phi > 0 → LTP
 *   When 0 < c < theta_m: phi < 0 → LTD
 *   theta_m slides up with high activity, down with low activity.
 *
 * STDP (Bi & Poo 1998, "Synaptic modifications in cultured hippocampal
 * neurons", J Neuroscience 18:10464-10472):
 *   Pre-before-post (dt > 0): delta_w = A+ * exp(-dt/tau+)
 *   Post-before-pre (dt < 0): delta_w = -A- * exp(dt/tau-)
 *   With A+ > A-, tau+ ≈ 17ms, tau- ≈ 34ms (biological).
 *   Adapted to hours timescale: tau+ = tau- = 24h.
 *
 * Constants: LTP_RATE, LTD_RATE are overall scaling factors (hand-tuned).
 * STDP amplitudes A+/A- maintain the A+ > A- asymmetry from Bi & Poo.
 * Time constants are adapted from ms to hours (documented adaptation).
 *
 * Pure business logic — no I/O.
 *
 * Port of: cortex@ed33435 mcp_server/core/synaptic_plasticity_hebbian.py
 *
 * D-14 fix: ablation guard was missing from applyHebbianUpdate. Python returns
 * no-op shape (weight unchanged, delta=0, action="none") for all edges when
 * SYNAPTIC_PLASTICITY is ablated. TS was returning raw edges without those
 * keys, breaking _apply_updates downstream with a silent KeyError.
 * source: cortex@ed33435 mcp_server/core/synaptic_plasticity_hebbian.py:168-185
 *
 * D-15 / style fix: minified one-liners expanded to multi-line per §4.2.
 */

// ── Weight bounds ──────────────────────────────────────────────────────────

export const MAX_WEIGHT = 5.0; // source: cortex@ed33435 mcp_server/core/synaptic_plasticity.py:_MAX_WEIGHT
export const MIN_WEIGHT = 0.01; // source: cortex@ed33435 mcp_server/core/synaptic_plasticity.py:_MIN_WEIGHT

// ── Rate constants ─────────────────────────────────────────────────────────

// Hand-tuned engineering constants — no paper derivation cited in source.
const LTP_RATE: number = 0.05; // source: cortex@ed33435 mcp_server/core/synaptic_plasticity_hebbian.py:37
const LTD_RATE: number = 0.02; // source: cortex@ed33435 mcp_server/core/synaptic_plasticity_hebbian.py:38
const BCM_THETA_DECAY: number = 0.95; // source: cortex@ed33435 mcp_server/core/synaptic_plasticity_hebbian.py:39

// STDP amplitudes from Bi & Poo (1998) J Neuroscience 18:10464-10472, A+ > A-.
// Time constants adapted from ms to hours (documented in Python source).
const STDP_A_PLUS: number = 0.03; // source: Bi & Poo (1998) A+ amplitude; cortex@ed33435 synaptic_plasticity_hebbian.py:40
const STDP_A_MINUS: number = 0.02; // source: Bi & Poo (1998) A- amplitude; cortex@ed33435 synaptic_plasticity_hebbian.py:41
const STDP_TAU_PLUS: number = 24.0; // source: cortex@ed33435 synaptic_plasticity_hebbian.py:42 (adapted ms → 24h)
const STDP_TAU_MINUS: number = 24.0; // source: cortex@ed33435 synaptic_plasticity_hebbian.py:43 (adapted ms → 24h)

// ── Derived constants ──────────────────────────────────────────────────────

// Default BCM theta_m: midpoint of [0,1] — used as the default sliding threshold.
// source: cortex@ed33435 synaptic_plasticity_hebbian.py:63,84 (theta=0.5 default)
const DEFAULT_THETA: number = 0.5;

// Default pre- and post-synaptic activity level (neutral / unknown).
// source: cortex@ed33435 synaptic_plasticity_hebbian.py:60-62 (pre_activity=1.0 default)
const DEFAULT_ACTIVITY: number = 1.0;

// Rounding factor for 6 decimal places (round(x, 6) → x * 10^6 / 10^6).
// source: cortex@ed33435 synaptic_plasticity_hebbian.py:150-151 (round(new_w, 6))
const ROUND_6DP: number = 1_000_000; // source: cortex@ed33435 synaptic_plasticity_hebbian.py:150 (round factor for 6dp)

// Hours-per-day denominator for the inactivity decay time scale.
// source: cortex@ed33435 synaptic_plasticity_hebbian.py:105 (/ 24.0 normalisation)
const HOURS_PER_DAY: number = 24.0; // source: cortex@ed33435 synaptic_plasticity_hebbian.py:105

// STDP temporal resolution threshold: dt below this is treated as simultaneous.
// source: cortex@ed33435 synaptic_plasticity_hebbian.py:212,232-236 (abs(dt) < 0.001)
const STDP_DT_THRESHOLD: number = 0.001; // source: cortex@ed33435 synaptic_plasticity_hebbian.py:212

// ── BCM functions ──────────────────────────────────────────────────────────

/**
 * BCM quadratic phi function: phi(c, theta_m) = c * (c - theta_m).
 *
 * source: Bienenstock, Cooper & Munro (1982), Eq. 3.
 * postcondition: positive when c > theta_m (LTP); negative when 0 < c < theta_m (LTD).
 */
export function computeBcmPhi(postActivity: number, theta: number): number {
  return postActivity * (postActivity - theta);
}

/**
 * BCM LTP: dw = rate * phi(c, theta_m) * d * co_activation.
 *
 * Only applies potentiation (phi > 0); returns current weight unchanged when
 * phi <= 0 (use computeLtd for depression).
 *
 * source: cortex@ed33435 mcp_server/core/synaptic_plasticity_hebbian.py:58-76
 * postcondition: returned weight is in [currentWeight, maxWeight].
 */
export function computeLtp(
  currentWeight: number,
  coActivation: number,
  preActivity: number = DEFAULT_ACTIVITY,
  postActivity: number = DEFAULT_ACTIVITY,
  theta: number = DEFAULT_THETA,
  ltpRate: number = LTP_RATE,
  maxWeight: number = MAX_WEIGHT,
): number {
  const phi = computeBcmPhi(postActivity, theta);
  if (phi <= 0) return currentWeight;
  const delta = ltpRate * phi * preActivity * coActivation;
  return Math.min(maxWeight, currentWeight + delta);
}

/**
 * BCM LTD: activity-based depression when 0 < c < theta_m.
 *
 * Two mechanisms:
 *   1. Activity-based (BCM 1982): phi(c, theta_m) < 0 when 0 < c < theta_m.
 *      dw = ltd_rate * phi(c, theta_m).
 *   2. Inactivity-based (fallback): logarithmic decay for edges with no
 *      recent co-access. Engineering heuristic, not from BCM.
 *
 * source: cortex@ed33435 mcp_server/core/synaptic_plasticity_hebbian.py:79-106
 * postcondition: returned weight is in [minWeight, currentWeight].
 */
// Zero post-activity default: no signal means inactivity path.
// source: cortex@ed33435 synaptic_plasticity_hebbian.py:84 (post_activity=0.0 default)
const DEFAULT_POST_ACTIVITY_LTD: number = 0.0; // source: cortex@ed33435 synaptic_plasticity_hebbian.py:84

export function computeLtd(
  currentWeight: number,
  timeSinceCoAccessHours: number,
  ltdRate: number = LTD_RATE,
  minWeight: number = MIN_WEIGHT,
  postActivity: number = DEFAULT_POST_ACTIVITY_LTD,
  theta: number = DEFAULT_THETA,
): number {
  if (postActivity > 0) {
    const phi = computeBcmPhi(postActivity, theta);
    if (phi < 0) {
      return Math.max(minWeight, currentWeight - ltdRate * Math.abs(phi));
    }
    return currentWeight;
  }
  if (timeSinceCoAccessHours <= 0) return currentWeight;
  const decay = ltdRate * Math.log1p(timeSinceCoAccessHours / HOURS_PER_DAY); // source: cortex@ed33435 synaptic_plasticity_hebbian.py:105
  return Math.max(minWeight, currentWeight - decay);
}

/**
 * BCM sliding threshold: theta_m' = decay * theta_m + (1 - decay) * c^2.
 *
 * Implemented as EMA over c^2. Faithful to BCM (1982) Eq. 5.
 *
 * source: cortex@ed33435 mcp_server/core/synaptic_plasticity_hebbian.py:109-119
 */
export function updateBcmThreshold(
  currentTheta: number,
  entityActivity: number,
  decay: number = BCM_THETA_DECAY,
): number {
  return decay * currentTheta + (1.0 - decay) * (entityActivity ** 2);
}

// ── Edge types ─────────────────────────────────────────────────────────────

export interface Edge {
  source_entity_id: number;
  target_entity_id: number;
  weight?: number;
  [key: string]: unknown;
}

export type HebbianEdgeResult = Edge & {
  weight: number;
  delta: number;
  action: string;
};

// ── Internal single-edge processor ────────────────────────────────────────

/**
 * Process a single edge for Hebbian LTP or LTD.
 *
 * precondition:  edge has source_entity_id and target_entity_id (integers).
 * postcondition: returned object carries weight (rounded 6dp), delta (rounded
 *   6dp), and action ("ltp" | "ltd" | "none").
 *
 * source: cortex@ed33435 mcp_server/core/synaptic_plasticity_hebbian.py:122-155
 */
function hebbianSingle(
  edge: Edge,
  coAccessedPairs: ReadonlySet<string>,
  entityActivities: Map<number, number>,
  entityThresholds: Map<number, number>,
  hours: number,
  ltpRate: number,
  ltdRate: number,
): HebbianEdgeResult {
  const src = edge.source_entity_id;
  const tgt = edge.target_entity_id;
  const w = edge.weight ?? 1.0;

  // Pair key: canonical (min,max) string — mirrors Python (min(src,tgt),max(src,tgt))
  // source: cortex@ed33435 synaptic_plasticity_hebbian.py:134
  // Note on D-15: Python uses set[tuple[int,int]]; TS uses ReadonlySet<string>
  // with "min,max" key serialization. Functionally equivalent: both test whether
  // the canonical unordered pair exists in the co-access set.
  const pairKey = `${Math.min(src, tgt)},${Math.max(src, tgt)}`;

  let newWeight: number;
  let action: string;

  if (coAccessedPairs.has(pairKey)) {
    newWeight = computeLtp(
      w,
      DEFAULT_ACTIVITY, // co_activation=1.0 when pair is co-accessed
      entityActivities.get(src) ?? DEFAULT_THETA,
      entityActivities.get(tgt) ?? DEFAULT_THETA,
      entityThresholds.get(tgt) ?? DEFAULT_THETA,
      ltpRate,
    );
    action = newWeight > w ? "ltp" : "none";
  } else {
    newWeight = computeLtd(w, hours, ltdRate);
    action = newWeight < w ? "ltd" : "none";
  }

  const roundedWeight = Math.round(newWeight * ROUND_6DP) / ROUND_6DP; // source: cortex@ed33435 synaptic_plasticity_hebbian.py:150 (round(new_w,6))
  const roundedDelta = Math.round((newWeight - w) * ROUND_6DP) / ROUND_6DP; // source: cortex@ed33435 synaptic_plasticity_hebbian.py:151 (round(new_w-w,6))

  return {
    ...edge,
    weight: roundedWeight,
    delta: roundedDelta,
    action,
  };
}

/**
 * Apply Hebbian LTP/LTD to a batch of edges.
 *
 * D-14 fix: when CORTEX_ABLATE_SYNAPTIC_PLASTICITY=1, returns a no-op list
 * where every edge keeps its original weight, delta=0, action="none".
 * Python returns this exact shape at synaptic_plasticity_hebbian.py:168-185.
 * The previous TS port returned raw edges (without the weight/delta/action
 * keys), causing downstream KeyError in _apply_updates.
 *
 * precondition:  edges is a list of Edge objects; coAccessedPairs uses
 *   "min,max" string keys.
 * postcondition: every result dict has weight (number), delta (number),
 *   action ("ltp" | "ltd" | "none").
 *
 * source: cortex@ed33435 mcp_server/core/synaptic_plasticity_hebbian.py:158-196
 */
export function applyHebbianUpdate(
  edges: readonly Edge[],
  coAccessedPairs: ReadonlySet<string>,
  entityActivities: Map<number, number>,
  entityThresholds: Map<number, number>,
  hoursSinceLastUpdate: number = 1.0,
  ltpRate: number = LTP_RATE,
  ltdRate: number = LTD_RATE,
): HebbianEdgeResult[] {
  // Ablation guard: when SYNAPTIC_PLASTICITY is disabled, return no-op shape.
  // Every edge in the result must carry weight, delta=0, action="none" so that
  // downstream handlers (_apply_updates in consolidation pipeline) do not
  // KeyError on missing fields.
  // source: cortex@ed33435 mcp_server/core/synaptic_plasticity_hebbian.py:170-185
  if (process.env["CORTEX_ABLATE_SYNAPTIC_PLASTICITY"] === "1") {
    return edges.map((edge) => ({
      ...edge,
      weight: edge.weight ?? 1.0,
      delta: 0.0,
      action: "none",
    }));
  }

  return edges.map((edge) =>
    hebbianSingle(
      edge,
      coAccessedPairs,
      entityActivities,
      entityThresholds,
      hoursSinceLastUpdate,
      ltpRate,
      ltdRate,
    )
  );
}

// ── STDP ───────────────────────────────────────────────────────────────────

/**
 * STDP: dt > 0 (pre before post) → LTP; dt < 0 → LTD.
 *
 * source: Bi & Poo (1998) J Neuroscience 18:10464-10472.
 *         cortex@ed33435 mcp_server/core/synaptic_plasticity_hebbian.py:200-218
 * postcondition: returned weight is in [MIN_WEIGHT, MAX_WEIGHT], rounded 6dp.
 */
export function computeStdpUpdate(
  currentWeight: number,
  deltaT: number,
  aPlus: number = STDP_A_PLUS,
  aMinus: number = STDP_A_MINUS,
  tauPlus: number = STDP_TAU_PLUS,
  tauMinus: number = STDP_TAU_MINUS,
  minWeight: number = MIN_WEIGHT,
  maxWeight: number = MAX_WEIGHT,
): number {
  if (Math.abs(deltaT) < STDP_DT_THRESHOLD) return currentWeight; // source: cortex@ed33435 synaptic_plasticity_hebbian.py:212
  const deltaW =
    deltaT > 0
      ? aPlus * Math.exp(-deltaT / tauPlus)
      : -aMinus * Math.exp(deltaT / tauMinus);
  const newWeight = currentWeight + deltaW;
  return Math.max(minWeight, Math.min(maxWeight, Math.round(newWeight * ROUND_6DP) / ROUND_6DP)); // source: cortex@ed33435 synaptic_plasticity_hebbian.py:218
}

interface TemporalPair {
  source_entity_id: number;
  target_entity_id: number;
  delta_t_hours?: number;
  current_weight?: number;
}

/**
 * Apply STDP to a batch of temporal entity co-occurrences.
 *
 * source: cortex@ed33435 mcp_server/core/synaptic_plasticity_hebbian.py:247-256
 */
export function applyStdpBatch(
  pairs: readonly TemporalPair[],
  aPlus: number = STDP_A_PLUS,
  aMinus: number = STDP_A_MINUS,
  tauPlus: number = STDP_TAU_PLUS,
  tauMinus: number = STDP_TAU_MINUS,
): Array<{
  source_entity_id: number;
  target_entity_id: number;
  new_weight: number;
  delta: number;
  direction: string;
}> {
  return pairs.map((p) => {
    const dt = p.delta_t_hours ?? 0;
    const w = p.current_weight ?? DEFAULT_ACTIVITY;
    const newWeight = computeStdpUpdate(w, dt, aPlus, aMinus, tauPlus, tauMinus);
    // source: cortex@ed33435 synaptic_plasticity_hebbian.py:232-236
    const direction =
      dt > STDP_DT_THRESHOLD ? "causal" : dt < -STDP_DT_THRESHOLD ? "anti-causal" : "none";
    return {
      source_entity_id: p.source_entity_id,
      target_entity_id: p.target_entity_id,
      new_weight: newWeight,
      delta: Math.round((newWeight - w) * ROUND_6DP) / ROUND_6DP, // source: cortex@ed33435 synaptic_plasticity_hebbian.py:242
      direction,
    };
  });
}
