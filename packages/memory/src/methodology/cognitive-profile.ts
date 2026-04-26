/**
 * Cognitive profile — EMA updates for Felder-Silverman style and persona vector.
 *
 * This module is the Level-1 update surface: pure functions that transform
 * profile data given a session observation. The Level-2 interpretation
 * (which profile to update, how to route sessions to domains) lives in
 * methodology-engine.ts. Never collapse these levels.
 *
 * source: mcp_server/core/profile_builder.py
 * source: mcp_server/core/style_classifier_ema.py
 * source: mcp_server/core/persona_vector.py
 */

import type {
  CognitiveStyle,
  DomainProfile,
  PersonaNumericDim,
  PersonaVector,
  SessionShape,
  ToolPreferences,
} from "./types.js";
import { PERSONA_NUMERIC_DIMENSIONS } from "./types.js";
import { cosineSimilarity, add, scale, zeros } from "./linear-algebra.js";

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Sessions shorter than this (ms) are classified "burst".
 * source: mcp_server/core/profile_builder.py _BURST_THRESHOLD_MS
 */
const BURST_THRESHOLD_MS = 600_000;

/**
 * Sessions with more turns than this are classified "exploration".
 * source: mcp_server/core/profile_builder.py _EXPLORATION_THRESHOLD_TURNS
 */
const EXPLORATION_THRESHOLD_TURNS = 20;

/**
 * Default EMA alpha for incremental profile updates.
 * source: mcp_server/core/profile_builder.py _EMA_ALPHA
 */
const EMA_ALPHA = 0.1;

// ── Pure helpers ─────────────────────────────────────────────────────────────

function clamp(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

function normalizeSignal(value: number, low: number, high: number): number {
  if (value > high) return 1;
  if (value < low) return -1;
  const mid = (low + high) / 2;
  const halfRange = (high - low) / 2;
  return (value - mid) / halfRange;
}

// ── Felder-Silverman EMA ──────────────────────────────────────────────────────

/**
 * Blend continuous Felder-Silverman axes via EMA.
 * source: mcp_server/core/style_classifier_ema.py _blend_continuous
 */
function blendContinuous(
  oldStyle: CognitiveStyle,
  newObs: Partial<CognitiveStyle>,
  alpha: number,
): Pick<CognitiveStyle, "activeReflective" | "sensingIntuitive" | "sequentialGlobal"> {
  return {
    activeReflective: clamp(
      alpha * (newObs.activeReflective ?? 0) + (1 - alpha) * (oldStyle.activeReflective ?? 0),
    ),
    sensingIntuitive: clamp(
      alpha * (newObs.sensingIntuitive ?? 0) + (1 - alpha) * (oldStyle.sensingIntuitive ?? 0),
    ),
    sequentialGlobal: clamp(
      alpha * (newObs.sequentialGlobal ?? 0) + (1 - alpha) * (oldStyle.sequentialGlobal ?? 0),
    ),
  };
}

/**
 * Select categorical dimensions based on alpha threshold.
 * source: mcp_server/core/style_classifier_ema.py _select_categorical
 */
function selectCategorical(
  oldStyle: CognitiveStyle,
  newObs: Partial<CognitiveStyle>,
  alpha: number,
): Pick<CognitiveStyle, "problemDecomposition" | "explorationStyle" | "verificationBehavior"> {
  const adoptNew = alpha >= 0.5;
  const primary = adoptNew ? newObs : oldStyle;
  const fallback = adoptNew ? oldStyle : newObs;
  return {
    problemDecomposition: primary.problemDecomposition ?? fallback.problemDecomposition,
    explorationStyle: primary.explorationStyle ?? fallback.explorationStyle,
    verificationBehavior: primary.verificationBehavior ?? fallback.verificationBehavior,
  };
}

/**
 * Blend an existing style with a new observation using EMA.
 * source: mcp_server/core/style_classifier_ema.py update_style_ema
 */
export function updateStyleEma(
  oldStyle: CognitiveStyle | null,
  newObs: Partial<CognitiveStyle> | null,
  alpha: number = EMA_ALPHA,
): CognitiveStyle {
  if (!oldStyle && newObs) return newObs as CognitiveStyle;
  if (!newObs && oldStyle) return oldStyle;
  if (!oldStyle || !newObs) return { activeReflective: 0, sensingIntuitive: 0, sequentialGlobal: 0 };

  return {
    ...blendContinuous(oldStyle, newObs, alpha),
    ...selectCategorical(oldStyle, newObs, alpha),
  };
}

// ── Persona vector ────────────────────────────────────────────────────────────

/**
 * Compute behavioral persona dimensions from session and tool statistics.
 * source: mcp_server/core/persona_vector.py _compute_behavioral_dims
 */
function computeBehavioralDims(
  ss: Partial<SessionShape>,
  tp: ToolPreferences,
): Record<PersonaNumericDim, number> {
  const avgDuration = ss.avgDuration ?? 0;
  const avgTurns = ss.avgTurns ?? 0;
  const durationSignal = normalizeSignal(avgDuration, 300_000, 1_800_000);
  const turnsSignal = normalizeSignal(avgTurns, 5, 30);
  const thoroughness = clamp((durationSignal + turnsSignal) / 2);

  const agentRatio = tp["Agent"]?.ratio ?? 0;
  const bashRatio = tp["Bash"]?.ratio ?? 0;
  const autonomy = clamp(agentRatio * 2 + bashRatio - 0.5);

  const avgMessages = (ss as Record<string, unknown>)["avgMessages"] as number | undefined ?? 0;
  const verbosity = clamp(normalizeSignal(avgMessages, 5, 20) * 0.5);

  const editRatio = tp["Edit"]?.ratio ?? 0;
  const readRatio = tp["Read"]?.ratio ?? 0;
  const riskTolerance = clamp((editRatio - readRatio) * 2);

  const globRatio = tp["Glob"]?.ratio ?? 0;
  const grepRatio = tp["Grep"]?.ratio ?? 0;
  const focusScope = clamp((globRatio + grepRatio) * 2 - 0.5);

  const burstRatio = ss.burstRatio ?? 0;
  const iterationSpeed = clamp(normalizeSignal(burstRatio, 0.3, 0.7) * 0.8);

  return {
    activeReflective: 0, // filled from metacognitive below
    sensingIntuitive: 0,
    sequentialGlobal: 0,
    thoroughness,
    autonomy,
    verbosity,
    riskTolerance,
    focusScope,
    iterationSpeed,
  };
}

/**
 * Build the 9-dimensional numeric persona vector from a domain profile.
 * source: mcp_server/core/persona_vector.py build_persona_vector
 */
export function buildPersonaVector(profile: Partial<DomainProfile>): PersonaVector {
  const mc = profile.metacognitive ?? { activeReflective: 0, sensingIntuitive: 0, sequentialGlobal: 0 };
  const ss = profile.sessionShape ?? ({} as SessionShape);
  const tp = profile.toolPreferences ?? {};

  const behavioral = computeBehavioralDims(ss, tp);
  return {
    activeReflective: mc.activeReflective ?? 0,
    sensingIntuitive: mc.sensingIntuitive ?? 0,
    sequentialGlobal: mc.sequentialGlobal ?? 0,
    thoroughness: behavioral.thoroughness,
    autonomy: behavioral.autonomy,
    verbosity: behavioral.verbosity,
    riskTolerance: behavioral.riskTolerance,
    focusScope: behavioral.focusScope,
    iterationSpeed: behavioral.iterationSpeed,
  };
}

/**
 * Serialize a persona vector to a numeric array (for distance calculation).
 * source: mcp_server/core/persona_vector.py persona_to_array
 */
export function personaToArray(pv: PersonaVector): number[] {
  return PERSONA_NUMERIC_DIMENSIONS.map((dim) => pv[dim] ?? 0);
}

/**
 * Cosine-distance between two persona vectors.
 * Returns 0 for identical vectors, 1 for orthogonal.
 * source: mcp_server/core/persona_vector.py persona_distance
 */
export function personaDistance(a: PersonaVector, b: PersonaVector): number {
  return 1 - cosineSimilarity(personaToArray(a), personaToArray(b));
}

export interface PersonaDrift {
  magnitude: number;
  direction: Record<string, number>;
  interpretation: string;
}

/**
 * Compute drift between two persona vectors.
 * source: mcp_server/core/persona_vector.py persona_drift
 */
export function personaDrift(oldPv: PersonaVector, newPv: PersonaVector): PersonaDrift {
  const oldArr = personaToArray(oldPv);
  const newArr = personaToArray(newPv);

  const direction: Record<string, number> = {};
  let maxDrift = 0;
  let maxDim = "";

  for (let i = 0; i < PERSONA_NUMERIC_DIMENSIONS.length; i++) {
    const dim = PERSONA_NUMERIC_DIMENSIONS[i] as string;
    const diff = (newArr[i] ?? 0) - (oldArr[i] ?? 0);
    direction[dim] = Math.round(diff * 100) / 100;
    if (Math.abs(diff) > Math.abs(maxDrift)) {
      maxDrift = diff;
      maxDim = dim;
    }
  }

  const magnitude = 1 - cosineSimilarity(oldArr, newArr);

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

  const labels = dimLabels[maxDim] ?? (["shifted", "shifted"] as [string, string]);
  const interpretation = maxDrift < 0 ? labels[0] : labels[1];

  return { magnitude, direction, interpretation };
}

/**
 * Compose multiple persona vectors as a weighted average.
 * source: mcp_server/core/persona_vector.py compose_personas
 */
export function composePersonas(vectors: PersonaVector[], weights: number[]): PersonaVector {
  if (vectors.length === 0) {
    const zero: Partial<PersonaVector> = {};
    for (const dim of PERSONA_NUMERIC_DIMENSIONS) zero[dim] = 0;
    return zero as PersonaVector;
  }

  const totalWeight = weights.reduce((s, w) => s + w, 0) || 1;
  let result = zeros(PERSONA_NUMERIC_DIMENSIONS.length);

  for (let i = 0; i < vectors.length; i++) {
    const arr = personaToArray(vectors[i] as PersonaVector);
    const w = (weights[i] ?? 0) / totalWeight;
    result = add(result, scale(arr, w));
  }

  const pv: Partial<PersonaVector> = {};
  for (let i = 0; i < PERSONA_NUMERIC_DIMENSIONS.length; i++) {
    const dim = PERSONA_NUMERIC_DIMENSIONS[i] as PersonaNumericDim;
    pv[dim] = clamp(Math.round((result[i] ?? 0) * 100) / 100);
  }
  return pv as PersonaVector;
}

// ── Session shape updates ─────────────────────────────────────────────────────

/**
 * Update session shape running averages in-place.
 * source: mcp_server/core/profile_builder.py _update_session_shape
 */
function updateSessionShape(
  ss: SessionShape,
  duration: number,
  turnCount: number,
  newCount: number,
): void {
  ss.avgDuration = ss.avgDuration + (duration - ss.avgDuration) / newCount;
  ss.avgTurns = ss.avgTurns + (turnCount - ss.avgTurns) / newCount;

  const isBurst = duration < BURST_THRESHOLD_MS ? 1 : 0;
  ss.burstRatio = ss.burstRatio + (isBurst - ss.burstRatio) / newCount;

  const isExploration = turnCount > EXPLORATION_THRESHOLD_TURNS ? 1 : 0;
  ss.explorationRatio = ss.explorationRatio + (isExploration - ss.explorationRatio) / newCount;

  if (ss.burstRatio > 0.6) ss.dominantMode = "burst";
  else if (ss.explorationRatio > 0.6) ss.dominantMode = "exploration";
  else ss.dominantMode = "mixed";
}

/**
 * Update tool preference ratios and averages in-place.
 * source: mcp_server/core/profile_builder.py _update_tool_preferences
 */
function updateToolPreferences(
  tp: ToolPreferences,
  toolsUsed: string[],
  oldCount: number,
  newCount: number,
): void {
  const toolSet = new Set(toolsUsed);
  for (const tool of toolSet) {
    const toolCountInSession = toolsUsed.filter((t) => t === tool).length;
    if (tool in tp) {
      const oldSessionsUsing = Math.round((tp[tool]?.ratio ?? 0) * oldCount);
      tp[tool] = {
        ratio: (oldSessionsUsing + 1) / newCount,
        avgPerSession:
          (tp[tool]?.avgPerSession ?? 0) +
          (toolCountInSession - (tp[tool]?.avgPerSession ?? 0)) / (oldSessionsUsing + 1),
      };
    } else {
      tp[tool] = { ratio: 1 / newCount, avgPerSession: toolCountInSession };
    }
  }

  for (const tool of Object.keys(tp)) {
    if (!toolSet.has(tool)) {
      const oldSessionsUsing = Math.round((tp[tool]?.ratio ?? 0) * oldCount);
      if (tp[tool]) tp[tool].ratio = oldSessionsUsing / newCount;
    }
  }
}

/**
 * Build a cognitive style observation from session signals.
 * source: mcp_server/core/profile_builder.py _build_style_observation
 */
function buildStyleObservation(
  duration: number | undefined,
  toolsUsed: string[],
): Partial<CognitiveStyle> {
  const observation: Partial<CognitiveStyle> = {};

  if (duration !== undefined) {
    if (duration < BURST_THRESHOLD_MS) observation.activeReflective = 0.5;
    else if (duration > 1_800_000) observation.activeReflective = -0.5;
    else observation.activeReflective = 0;
  }

  if (toolsUsed.length > 0) {
    const editCount = toolsUsed.filter((t) => t === "Edit" || t === "Write").length;
    const readCount = toolsUsed.filter((t) => t === "Read" || t === "Grep").length;
    const total = toolsUsed.length;

    if (editCount / total > 0.4) {
      observation.activeReflective = clamp((observation.activeReflective ?? 0) + 0.3);
    }
    if (readCount / total > 0.4) {
      observation.activeReflective = clamp((observation.activeReflective ?? 0) - 0.3);
    }
  }

  if (observation.activeReflective !== undefined) {
    observation.activeReflective = clamp(observation.activeReflective);
  }

  return observation;
}

// ── Persona vector EMA update ─────────────────────────────────────────────────

/**
 * EMA-update the persona vector on the domain profile in-place.
 * source: mcp_server/core/profile_builder.py _update_persona_vector
 */
function updatePersonaVector(dp: DomainProfile): void {
  const pv = dp.personaVector;
  if (!pv) return;
  const newPersona = buildPersonaVector(dp);
  for (const dim of PERSONA_NUMERIC_DIMENSIONS) {
    const old = pv[dim];
    const next = newPersona[dim];
    if (typeof old === "number" && typeof next === "number") {
      (pv as unknown as Record<string, number>)[dim] = clamp(EMA_ALPHA * next + (1 - EMA_ALPHA) * old);
    }
  }
}

// ── Main export: incremental session update ───────────────────────────────────

export interface SessionUpdateData {
  duration?: number;
  toolsUsed?: string[];
  turnCount?: number;
}

/**
 * Incrementally update a domain profile with a single new session.
 *
 * This is the primary Level-1 mutation function. It does NOT decide which
 * domain to update — that routing is a Level-2 concern for the methodology
 * engine. Bateson constraint: do not call this function without first
 * consulting the methodology engine for domain routing.
 *
 * source: mcp_server/core/profile_builder.py apply_session_update
 */
export function applySessionUpdate(
  domainProfile: DomainProfile,
  sessionData: SessionUpdateData,
): DomainProfile {
  const dp = domainProfile;
  const { duration, toolsUsed = [], turnCount = 0 } = sessionData;

  const oldCount = dp.sessionCount ?? 0;
  const newCount = oldCount + 1;

  if (dp.sessionShape && duration !== undefined) {
    updateSessionShape(dp.sessionShape, duration, turnCount, newCount);
  }

  if (toolsUsed.length > 0 && dp.toolPreferences !== undefined) {
    updateToolPreferences(dp.toolPreferences, toolsUsed, oldCount, newCount);
  }

  if (dp.metacognitive) {
    const observation = buildStyleObservation(duration, toolsUsed);
    dp.metacognitive = updateStyleEma(dp.metacognitive, observation, EMA_ALPHA);
  }

  updatePersonaVector(dp);

  dp.sessionCount = newCount;
  dp.lastUpdated = new Date().toISOString().replace("+00:00", "Z");
  const dataQuality = Math.min(newCount / 10, 1);
  dp.confidence = Math.round(Math.min(newCount / 50, 1) * dataQuality * 100) / 100;

  return dp;
}
