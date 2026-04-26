/**
 * Memory reconsolidation — memories become labile on retrieval and may be rewritten.
 *
 * Based on Nader et al. (Nature, 2000) and Osan-Tort-Amaral (PLoS ONE, 2011).
 *
 * Three outcomes based on mismatch between stored memory and current context:
 *   - mismatch < low_threshold: Passive retrieval, no change
 *   - low <= mismatch < high: RECONSOLIDATE — update memory with current context
 *   - mismatch >= high: EXTINCTION — archive old memory, create new one
 *
 * Emotional modulation:
 *   // source: Yonelinas & Ritchey (2015) — decay ratio b_neutral/b_emotional = 2.0
 *   // source: Lee (2009, Trends Neurosci) PE gate: PE = mismatch * (1 - stability * 0.5)
 *   // source: Milekic & Alberini (2002) age-dependent threshold: older memories resist
 *   // source: Nader K et al. (2000) Nature 406:722-726 — reconsolidation after retrieval
 *   // source: Osan-Tort-Amaral (PLoS ONE 2011) — low/high threshold values
 *
 * Reconsolidation regime — emotional multiplier (Yonelinas & Ritchey 2015):
 *   Decay ratio b_neutral/b_emotional = 2.0 → up to 1.8x at arousal=0.8
 *
 * Port of: mcp_server/core/reconsolidation.py
 * Pure business logic — no I/O.
 */

import * as nodePath from "node:path";

// ── Temporal Distance ─────────────────────────────────────────────────────────

function temporalDistance(memoryLastAccessed: string | null | undefined): number {
  if (!memoryLastAccessed) return 0.5;
  try {
    const last = new Date(memoryLastAccessed);
    if (isNaN(last.getTime())) return 0.5;
    const hours = (Date.now() - last.getTime()) / 3_600_000;
    return Math.min(hours / 168.0, 1.0); // normalize to 1 week
  } catch {
    return 0.5;
  }
}

// ── Tag Divergence ────────────────────────────────────────────────────────────

function tagDivergence(
  memoryTags: ReadonlySet<string>,
  contextTokens: ReadonlySet<string>,
): number {
  if (memoryTags.size > 0 && contextTokens.size > 0) {
    let intersection = 0;
    for (const t of memoryTags) {
      if (contextTokens.has(t)) intersection++;
    }
    const union = new Set([...memoryTags, ...contextTokens]).size;
    return 1.0 - (union > 0 ? intersection / union : 0.0);
  }
  if (memoryTags.size === 0 && contextTokens.size === 0) return 0.0;
  return 1.0;
}

// ── Mismatch Computation ──────────────────────────────────────────────────────

export interface MismatchInput {
  embeddingSimilarity: number | null;
  memoryDirectory: string;
  currentDirectory: string;
  memoryLastAccessed: string | null | undefined;
  memoryTags: ReadonlySet<string>;
  contextTokens: ReadonlySet<string>;
}

/**
 * Compute multi-signal mismatch between stored memory and retrieval context.
 *
 * Signals (weighted):
 *   1. Embedding distance (0.5): 1.0 - cosine_similarity
 *   2. Directory distance (0.2): 0.0/0.5/1.0
 *   3. Temporal distance (0.15): hours since last access, normalized to 1 week
 *   4. Tag divergence (0.15): 1.0 - jaccard_similarity
 */
export function computeMismatch(input: MismatchInput): number {
  const embDistance =
    input.embeddingSimilarity === null ? 0.5 : 1.0 - input.embeddingSimilarity;

  let dirDistance: number;
  if (input.memoryDirectory === input.currentDirectory) {
    dirDistance = 0.0;
  } else if (
    nodePath.dirname(input.memoryDirectory) === nodePath.dirname(input.currentDirectory)
  ) {
    dirDistance = 0.5;
  } else {
    dirDistance = 1.0;
  }

  const mismatch =
    0.5 * embDistance +
    0.2 * dirDistance +
    0.15 * temporalDistance(input.memoryLastAccessed) +
    0.15 * tagDivergence(input.memoryTags, input.contextTokens);

  return Math.max(0.0, Math.min(1.0, mismatch));
}

// ── Decision Types ────────────────────────────────────────────────────────────

export type ReconsolidationAction = "none" | "update" | "archive";

export interface ReconsolidationResult {
  action: ReconsolidationAction;
  predictionError: number;
  strengthDelta: number;
  emotionalMultiplier: number;
}

// ── Action Decision ───────────────────────────────────────────────────────────

export interface DecideActionOptions {
  lowThreshold?: number;
  highThreshold?: number;
}

/**
 * Determine reconsolidation action based on mismatch and memory state.
 *
 * // source: Osan-Tort-Amaral (PLoS ONE, 2011) — thresholds.
 * // source: Lee (Trends Neurosci, 2009) — PE gate.
 * // source: Milekic & Alberini (2002) — age-dependent threshold.
 * // source: Yonelinas & Ritchey (2015) — emotional multiplier.
 *   Decay ratio b_neutral/b_emotional = 2.0 → up to 1.8x at arousal=0.8.
 */
export function decideAction(
  mismatch: number,
  stability = 0.0,
  plasticity = 1.0,
  isProtected = false,
  emotionalArousal = 0.0,
  ageDays = 0.0,
  opts: DecideActionOptions = {},
): ReconsolidationResult {
  if (isProtected) {
    return { action: "none", predictionError: 0.0, strengthDelta: 0.0, emotionalMultiplier: 1.0 };
  }

  const { lowThreshold = 0.15, highThreshold = 0.65 } = opts;

  // Prediction error gate (Lee 2009): stable memories dampen PE
  const predictionError = mismatch * (1.0 - stability * 0.5);

  // Age-dependent threshold (Milekic & Alberini 2002):
  // Older memories require larger PE to destabilize
  const ageFactor = Math.min(ageDays / 30.0, 1.0) * 0.15;
  let effectiveLow = lowThreshold + ageFactor + stability * 0.2;
  let effectiveHigh = highThreshold + stability * 0.1;

  // Recently accessed (high plasticity) memories are MORE susceptible
  if (plasticity > 0.5) {
    effectiveLow -= 0.1;
    effectiveHigh -= 0.1;
  }

  if (predictionError < effectiveLow) {
    return { action: "none", predictionError, strengthDelta: 0.0, emotionalMultiplier: 1.0 };
  }
  if (predictionError >= effectiveHigh) {
    return {
      action: "archive",
      predictionError,
      strengthDelta: -0.2,
      emotionalMultiplier: 1.0,
    };
  }

  // Reconsolidation regime — emotional multiplier (Yonelinas & Ritchey 2015)
  // Decay ratio b_neutral/b_emotional = 2.0 → up to 1.8x at arousal=0.8
  const emotionalMultiplier = 1.0 + Math.min(emotionalArousal, 0.8);
  const strengthDelta = predictionError * 0.1 * emotionalMultiplier;

  return { action: "update", predictionError, strengthDelta, emotionalMultiplier };
}

// ── Content Merge ─────────────────────────────────────────────────────────────

/**
 * Merge new context into existing memory content.
 *
 * If merged exceeds maxLength, keeps first 500 + last 500 of old + full new.
 */
export function mergeContent(
  oldContent: string,
  newContext: string,
  maxLength = 2000,
): string {
  const merged = `${oldContent}\n--- Updated context ---\n${newContext}`;
  if (merged.length <= maxLength) return merged;

  const oldPrefix = oldContent.slice(0, 500);
  const oldSuffix = oldContent.length > 500 ? oldContent.slice(-500) : "";
  if (oldSuffix) {
    return `${oldPrefix}\n...\n${oldSuffix}\n--- Updated context ---\n${newContext}`;
  }
  return `${oldPrefix}\n--- Updated context ---\n${newContext}`;
}

// ── Plasticity / Stability ────────────────────────────────────────────────────

/**
 * Spike plasticity on access with exponential decay since last update.
 * Plasticity decays with half-life, then spikes on each access.
 */
export function computePlasticityDecay(
  currentPlasticity: number,
  hoursElapsed: number,
  halfLifeHours = 6.0,
  spike = 0.3,
): number {
  let p = currentPlasticity;
  if (hoursElapsed > 0 && halfLifeHours > 0) {
    p *= Math.pow(2, -hoursElapsed / halfLifeHours);
  }
  return Math.min(p + spike, 1.0);
}

/**
 * Update stability based on usefulness feedback.
 * Useful retrievals increase stability; frequent non-useful retrievals decrease it.
 */
export function updateStability(
  currentStability: number,
  wasUseful: boolean,
  accessCount: number,
  increment = 0.1,
): number {
  if (wasUseful) return Math.min(currentStability + increment, 1.0);
  if (accessCount > 5) return Math.max(currentStability - increment * 0.5, 0.0);
  return currentStability;
}
