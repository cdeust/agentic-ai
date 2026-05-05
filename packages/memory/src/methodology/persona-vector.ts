/**
 * Extended 12D persona vector (9 numeric + 3 categorical).
 *
 * Dimensions 1-3: activeReflective, sensingIntuitive, sequentialGlobal (CognitiveStyle)
 * Dimensions 4-9: thoroughness, autonomy, verbosity, riskTolerance, focusScope, iterationSpeed
 *
 * Port of: cortex@ed33435 mcp_server/core/persona_vector.py
 */

import { add, cosineSimilarity, scale, zeros } from "../shared/linear-algebra.js";

// ── Dimension registry ────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/persona_vector.py:13-23

export const PERSONA_DIMENSIONS = [
  "activeReflective",
  "sensingIntuitive",
  "sequentialGlobal",
  "thoroughness",
  "autonomy",
  "verbosity",
  "riskTolerance",
  "focusScope",
  "iterationSpeed",
] as const;

export type PersonaDimension = typeof PERSONA_DIMENSIONS[number];
export type PersonaVector = Record<PersonaDimension, number>;

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Clamp value to [-1, 1].
 * source: cortex@ed33435 mcp_server/core/persona_vector.py:26-27
 */
function clamp(v: number): number {
  return Math.max(-1.0, Math.min(1.0, v));
}

/**
 * Map value to [-1, 1]: below low=-1, above high=+1, linear between.
 * source: cortex@ed33435 mcp_server/core/persona_vector.py:30-38
 */
function normalizeSignal(value: number, low: number, high: number): number {
  if (value > high) return 1.0;
  if (value < low) return -1.0;
  const mid = (low + high) / 2;
  const halfRange = (high - low) / 2;
  return (value - mid) / halfRange;
}

// ── Behavioral dimensions computation ─────────────────────────────────────

/**
 * Compute the 6 behavioral persona dimensions from session and tool data.
 *
 * precondition:  ss is sessionShape dict; tp is toolPreferences dict.
 * postcondition: returned object has all 6 behavioral dimension keys,
 *   values clamped to [-1, 1].
 *
 * source: cortex@ed33435 mcp_server/core/persona_vector.py:41-74
 */
function computeBehavioralDims(
  ss: Record<string, unknown>,
  tp: Record<string, unknown>,
): Record<string, number> {
  const avgDuration = (ss["avgDuration"] as number | undefined) ?? 0;
  const avgTurns = (ss["avgTurns"] as number | undefined) ?? 0;
  // source: cortex@ed33435 mcp_server/core/persona_vector.py:45-47
  const durationSignal = normalizeSignal(avgDuration, 300000, 1800000);
  const turnsSignal = normalizeSignal(avgTurns, 5, 30);
  const thoroughness = clamp((durationSignal + turnsSignal) / 2);

  const agentRatio = ((tp["Agent"] as Record<string, number> | undefined)?.["ratio"]) ?? 0;
  const bashRatio = ((tp["Bash"] as Record<string, number> | undefined)?.["ratio"]) ?? 0;
  const autonomy = clamp((agentRatio * 2 + bashRatio) - 0.5); // source: cortex@ed33435 mcp_server/core/persona_vector.py:51

  const avgMessages = (ss["avgMessages"] as number | undefined) ?? 0;
  const verbosity = clamp(normalizeSignal(avgMessages, 5, 20) * 0.5);

  const editRatio = ((tp["Edit"] as Record<string, number> | undefined)?.["ratio"]) ?? 0;
  const readRatio = ((tp["Read"] as Record<string, number> | undefined)?.["ratio"]) ?? 0;
  const riskTolerance = clamp((editRatio - readRatio) * 2);

  const globRatio = ((tp["Glob"] as Record<string, number> | undefined)?.["ratio"]) ?? 0;
  const grepRatio = ((tp["Grep"] as Record<string, number> | undefined)?.["ratio"]) ?? 0;
  const focusScope = clamp((globRatio + grepRatio) * 2 - 0.5);

  const burstRatio = (ss["burstRatio"] as number | undefined) ?? 0;
  const iterationSpeed = clamp(normalizeSignal(burstRatio, 0.3, 0.7) * 0.8);

  return { thoroughness, autonomy, verbosity, riskTolerance, focusScope, iterationSpeed };
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Build a 9D persona vector from a profile object.
 *
 * precondition:  profile has metacognitive, sessionShape, toolPreferences keys.
 * postcondition: returned PersonaVector has all 9 PERSONA_DIMENSIONS set.
 *
 * source: cortex@ed33435 mcp_server/core/persona_vector.py:77-88
 */
export function buildPersonaVector(profile: Record<string, unknown>): PersonaVector {
  const mc = (profile["metacognitive"] ?? {}) as Record<string, number>;
  const ss = (profile["sessionShape"] ?? {}) as Record<string, unknown>;
  const tp = (profile["toolPreferences"] ?? {}) as Record<string, unknown>;

  const behavioral = computeBehavioralDims(ss, tp);

  return {
    activeReflective: (mc["activeReflective"] as number | undefined) ?? 0,
    sensingIntuitive: (mc["sensingIntuitive"] as number | undefined) ?? 0,
    sequentialGlobal: (mc["sequentialGlobal"] as number | undefined) ?? 0,
    thoroughness: behavioral["thoroughness"] ?? 0,
    autonomy: behavioral["autonomy"] ?? 0,
    verbosity: behavioral["verbosity"] ?? 0,
    riskTolerance: behavioral["riskTolerance"] ?? 0,
    focusScope: behavioral["focusScope"] ?? 0,
    iterationSpeed: behavioral["iterationSpeed"] ?? 0,
  };
}

/**
 * Convert a PersonaVector to a numeric array in dimension order.
 *
 * postcondition: returned array has PERSONA_DIMENSIONS.length elements.
 * source: cortex@ed33435 mcp_server/core/persona_vector.py:91-92
 */
export function personaToArray(pv: Record<string, number>): number[] {
  return PERSONA_DIMENSIONS.map((dim) => pv[dim] ?? 0);
}

/**
 * Compute distance between two persona vectors (1 - cosine similarity).
 *
 * postcondition: result ∈ [0, 2] (cosine distance bound).
 * source: cortex@ed33435 mcp_server/core/persona_vector.py:95-96
 */
export function personaDistance(
  a: Record<string, number>,
  b: Record<string, number>,
): number {
  return 1 - cosineSimilarity(personaToArray(a), personaToArray(b));
}

/**
 * Compute drift between old and new persona vectors.
 *
 * postcondition: returned object has magnitude, direction (per-dimension diffs),
 *   and interpretation (human-readable).
 *
 * source: cortex@ed33435 mcp_server/core/persona_vector.py:99-134
 */
export function personaDrift(
  oldPv: Record<string, number>,
  newPv: Record<string, number>,
): Record<string, unknown> {
  const oldArr = personaToArray(oldPv);
  const newArr = personaToArray(newPv);

  const direction: Record<string, number> = {};
  let maxDrift = 0.0;
  let maxDim = "";

  for (let i = 0; i < PERSONA_DIMENSIONS.length; i++) {
    const dim = PERSONA_DIMENSIONS[i];
    const diff = (newArr[i] ?? 0) - (oldArr[i] ?? 0);
    direction[dim] = Math.round(diff * 100) / 100;
    if (Math.abs(diff) > Math.abs(maxDrift)) {
      maxDrift = diff;
      maxDim = dim;
    }
  }

  const magnitude = 1 - cosineSimilarity(oldArr, newArr);

  // source: cortex@ed33435 mcp_server/core/persona_vector.py:115-128
  const dimLabels: Record<string, [string, string]> = {
    activeReflective: ["more reflective", "more active"],
    sensingIntuitive: ["more intuitive", "more sensing"],
    sequentialGlobal: ["more global", "more sequential"],
    thoroughness: ["quicker", "more thorough"],
    autonomy: ["more guided", "more autonomous"],
    verbosity: ["more terse", "more verbose"],
    riskTolerance: ["more conservative", "bolder"],
    focusScope: ["narrower focus", "broader scope"],
    iterationSpeed: ["more deliberate", "faster iteration"],
  };

  const labels = dimLabels[maxDim] ?? ["shifted", "shifted"];
  const interpretation = maxDrift < 0 ? labels[0] : labels[1];

  return { magnitude, direction, interpretation };
}

/**
 * Compose multiple persona vectors via weighted sum.
 *
 * precondition:  vectors and weights have matching lengths (weights[i] >= 0).
 * postcondition: returned PersonaVector is the normalized weighted sum;
 *   all dimensions clamped to [-1, 1].
 *
 * source: cortex@ed33435 mcp_server/core/persona_vector.py:137-152
 */
export function composePersonas(
  vectors: Record<string, number>[],
  weights: number[],
): PersonaVector {
  if (vectors.length === 0) {
    return Object.fromEntries(PERSONA_DIMENSIONS.map((d) => [d, 0])) as PersonaVector;
  }

  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  let result = zeros(PERSONA_DIMENSIONS.length);

  for (let i = 0; i < vectors.length; i++) {
    const arr = personaToArray(vectors[i] ?? {});
    const w = (weights[i] ?? 0) / totalWeight;
    result = add(result, scale(arr, w));
  }

  const pv: Record<string, number> = {};
  for (let i = 0; i < PERSONA_DIMENSIONS.length; i++) {
    const dim = PERSONA_DIMENSIONS[i];
    pv[dim] = clamp(Math.round((result[i] ?? 0) * 100) / 100);
  }
  return pv as PersonaVector;
}

/**
 * Steer a context string based on persona vector adjustments.
 *
 * precondition:  targetAdjustments maps dimension names to target values.
 * postcondition: returns baseContext unchanged if no significant adjustments;
 *   otherwise appends steering sentences.
 *
 * source: cortex@ed33435 mcp_server/core/persona_vector.py:155-194
 */
export function steerContext(
  baseContext: string,
  personaVector: Record<string, number>,
  targetAdjustments: Record<string, number> | null = null,
): string {
  if (!targetAdjustments) return baseContext;

  const steeringMapPos: Record<string, string> = {
    thoroughness: "Be more thorough and exhaustive.",
    autonomy: "Take more initiative.",
    verbosity: "Provide more detail.",
    riskTolerance: "Try bolder approaches.",
    focusScope: "Consider the broader picture.",
    iterationSpeed: "Move faster, iterate quickly.",
  };
  const steeringMapNeg: Record<string, string> = {
    thoroughness: "Be more concise and quick.",
    autonomy: "Ask before acting.",
    verbosity: "Keep responses brief.",
    riskTolerance: "Prefer safe, incremental changes.",
    focusScope: "Focus on the specific task.",
    iterationSpeed: "Take time to think through each step.",
  };

  const driftThreshold = 0.2; // source: cortex@ed33435 mcp_server/core/persona_vector.py:162
  const sentences: string[] = [];

  for (const [dim, target] of Object.entries(targetAdjustments)) {
    const current = personaVector[dim];
    if (current === undefined) continue;
    const diff = target - current;
    if (Math.abs(diff) < driftThreshold) continue;
    const sentence = diff > 0 ? steeringMapPos[dim] : steeringMapNeg[dim];
    if (sentence) sentences.push(sentence);
  }

  if (sentences.length === 0) return baseContext;
  return baseContext + " " + sentences.join(" ");
}
