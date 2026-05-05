/**
 * Profile building facade — backward-compatible re-exports + incremental update.
 *
 * Full profile assembly is in profile-assembler.ts.
 * This module provides applySessionUpdate for incremental EMA updates.
 *
 * Port of: cortex@ed33435 mcp_server/core/profile_builder.py
 */

import { buildPersonaVector } from "./persona-vector.js";
import { updateStyleEma } from "./style-classifier-ema.js";

// ── Constants ─────────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/profile_builder.py:19-21

const BURST_THRESHOLD_MS = 600_000;      // source: cortex@ed33435 mcp_server/core/profile_builder.py:19
const EXPLORATION_THRESHOLD_TURNS = 20; // source: cortex@ed33435 mcp_server/core/profile_builder.py:20
const EMA_ALPHA = 0.1;                   // source: cortex@ed33435 mcp_server/core/profile_builder.py:21

// ── Session shape update ──────────────────────────────────────────────────

/**
 * Update session shape running averages in place.
 * source: cortex@ed33435 mcp_server/core/profile_builder.py:24-47
 */
function updateSessionShape(
  ss: Record<string, unknown>,
  duration: number,
  turnCount: number,
  newCount: number,
): void {
  const avgDur = (ss["avgDuration"] as number | undefined) ?? 0;
  const avgTurns = (ss["avgTurns"] as number | undefined) ?? 0;
  const burstRatio = (ss["burstRatio"] as number | undefined) ?? 0;
  const explorationRatio = (ss["explorationRatio"] as number | undefined) ?? 0;

  ss["avgDuration"] = avgDur + (duration - avgDur) / newCount;
  ss["avgTurns"] = avgTurns + (turnCount - avgTurns) / newCount;

  const isBurst = duration < BURST_THRESHOLD_MS ? 1 : 0;
  ss["burstRatio"] = burstRatio + (isBurst - burstRatio) / newCount;

  const isExploration = turnCount > EXPLORATION_THRESHOLD_TURNS ? 1 : 0;
  ss["explorationRatio"] = explorationRatio + (isExploration - explorationRatio) / newCount;

  const newBurst = ss["burstRatio"] as number;
  const newExploration = ss["explorationRatio"] as number;
  if (newBurst > 0.6) ss["dominantMode"] = "burst";
  else if (newExploration > 0.6) ss["dominantMode"] = "exploration";
  else ss["dominantMode"] = "mixed";
}

// ── Tool preferences update ───────────────────────────────────────────────

/**
 * Update tool preference ratios and averages in place.
 * source: cortex@ed33435 mcp_server/core/profile_builder.py:50-73
 */
function updateToolPreferences(
  tp: Record<string, Record<string, number>>,
  toolsUsed: string[],
  oldCount: number,
  newCount: number,
): void {
  const toolSet = new Set(toolsUsed);

  for (const tool of toolSet) {
    const toolCountInSession = toolsUsed.filter((t) => t === tool).length;
    if (tool in tp) {
      const oldSessionsUsing = Math.round((tp[tool]!["ratio"] ?? 0) * oldCount);
      tp[tool]!["ratio"] = (oldSessionsUsing + 1) / newCount;
      tp[tool]!["avgPerSession"] = (tp[tool]!["avgPerSession"] ?? 0)
        + (toolCountInSession - (tp[tool]!["avgPerSession"] ?? 0)) / (oldSessionsUsing + 1);
    } else {
      tp[tool] = { ratio: 1 / newCount, avgPerSession: toolCountInSession };
    }
  }

  for (const tool of Object.keys(tp)) {
    if (!toolSet.has(tool)) {
      const oldSessionsUsing = Math.round((tp[tool]!["ratio"] ?? 0) * oldCount);
      tp[tool]!["ratio"] = oldSessionsUsing / newCount;
    }
  }
}

// ── Style observation builder ─────────────────────────────────────────────

/**
 * Build a cognitive style observation from session signals.
 * source: cortex@ed33435 mcp_server/core/profile_builder.py:75-108
 */
function buildStyleObservation(
  duration: number | null | undefined,
  toolsUsed: string[],
): Record<string, number> {
  const observation: Record<string, number> = {};

  if (duration !== null && duration !== undefined) {
    if (duration < BURST_THRESHOLD_MS) {
      observation["activeReflective"] = 0.5;
    } else if (duration > 1_800_000) {
      observation["activeReflective"] = -0.5;
    } else {
      observation["activeReflective"] = 0.0;
    }
  }

  if (toolsUsed.length > 0) {
    const editCount = toolsUsed.filter((t) => t === "Edit" || t === "Write").length;
    const readCount = toolsUsed.filter((t) => t === "Read" || t === "Grep").length;
    const total = toolsUsed.length;
    if (editCount / total > 0.4) {
      observation["activeReflective"] = Math.max(-1, Math.min(1,
        (observation["activeReflective"] ?? 0) + 0.3));
    }
    if (readCount / total > 0.4) {
      observation["activeReflective"] = Math.max(-1, Math.min(1,
        (observation["activeReflective"] ?? 0) - 0.3));
    }
  }

  if ("activeReflective" in observation) {
    observation["activeReflective"] = Math.max(-1, Math.min(1, observation["activeReflective"]!));
  }

  return observation;
}

// ── Persona vector EMA update ─────────────────────────────────────────────

function updatePersonaVector(dp: Record<string, unknown>): void {
  const pv = dp["personaVector"] as Record<string, number> | undefined;
  if (!pv) return;
  const newPersona = buildPersonaVector(dp);
  for (const dim of Object.keys(pv)) {
    const oldVal = pv[dim];
    const newVal = (newPersona as Record<string, number>)[dim];
    if (typeof oldVal === "number" && typeof newVal === "number") {
      pv[dim] = Math.max(-1, Math.min(1, EMA_ALPHA * newVal + (1 - EMA_ALPHA) * oldVal));
    }
  }
}

function updateCountsAndMetadata(dp: Record<string, unknown>, newCount: number): void {
  dp["sessionCount"] = newCount;
  dp["lastUpdated"] = new Date().toISOString().replace("+00:00", "Z");
  const dataQuality = Math.min(newCount / 10, 1.0);
  dp["confidence"] = Math.round(Math.min(newCount / 50, 1.0) * dataQuality * 100) / 100;
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Incrementally update a domain profile with a single new session.
 *
 * precondition:  domainProfile and sessionData are record objects.
 * postcondition: returned profile has sessionCount incremented by 1;
 *   sessionShape, toolPreferences, metacognitive, and personaVector
 *   updated via incremental EMA.
 *
 * source: cortex@ed33435 mcp_server/core/profile_builder.py:134-164
 *   EMA_ALPHA = 0.1 (engineering choice — slow adaptation)
 */
export function applySessionUpdate(opts: {
  domainProfile: Record<string, unknown>;
  sessionData: Record<string, unknown>;
}): Record<string, unknown> {
  const { domainProfile: dp, sessionData } = opts;
  const duration = sessionData["duration"] as number | null | undefined;
  const toolsUsed = (sessionData["tools_used"] as string[] | undefined) ?? [];
  const turnCount = (sessionData["turn_count"] as number | undefined) ?? 0;

  const oldCount = (dp["sessionCount"] as number | undefined) ?? 0;
  const newCount = oldCount + 1;

  const ss = dp["sessionShape"] as Record<string, unknown> | undefined;
  if (ss && duration !== null && duration !== undefined) {
    updateSessionShape(ss, duration, turnCount, newCount);
  }

  const tp = dp["toolPreferences"] as Record<string, Record<string, number>> | undefined;
  if (toolsUsed.length > 0 && tp !== undefined) {
    updateToolPreferences(tp, toolsUsed, oldCount, newCount);
  }

  const mc = dp["metacognitive"] as Record<string, unknown> | undefined;
  if (mc) {
    const observation = buildStyleObservation(duration, toolsUsed);
    dp["metacognitive"] = updateStyleEma(mc, observation, EMA_ALPHA);
  }

  updatePersonaVector(dp);
  updateCountsAndMetadata(dp, newCount);

  return dp;
}
