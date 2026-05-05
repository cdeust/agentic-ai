/**
 * Replay sequence selection and priority scoring.
 *
 * Selects which replay sequences fire during an SWR burst based on a
 * priority score. Higher-priority sequences are replayed first.
 *
 * Priority formula: (avg_heat * 0.4 + sqrt(heat_variance) * 0.6) * DA_level.
 * This is a hand-tuned heuristic combining importance (heat) and surprise
 * (variance), amplified by dopamine level. No paper — engineering decision.
 * All constants (0.4/0.6 weights, threshold 0.3, max 5) are hand-tuned.
 *
 * Pure business logic — no I/O.
 *
 * Port of: cortex@ed33435 mcp_server/core/replay_selection.py
 */

import { type ReplayEvent, type ReplaySequence, ReplayDirection } from "./replay-types.js";

// ── Constants ─────────────────────────────────────────────────────────────
// source: cortex@ed33435 mcp_server/core/replay_selection.py:31-32
// All constants are hand-tuned engineering choices.

const PRIORITY_THRESHOLD = 0.3;    // source: cortex@ed33435 mcp_server/core/replay_selection.py:31
const MAX_SEQUENCES_PER_SWR = 5;   // source: cortex@ed33435 mcp_server/core/replay_selection.py:32

// ── Priority scoring ──────────────────────────────────────────────────────

/**
 * Compute priority score for a replay sequence.
 *
 * Formula: (avg_heat * 0.4 + sqrt(heat_variance) * 0.6) * DA_level.
 * Heuristic combining importance (heat) and surprise (variance),
 * amplified by dopamine. Weights are hand-tuned — no paper.
 *
 * precondition:  events.length >= 2; dopamineLevel >= 0.
 * postcondition: result ∈ [0, 1].
 *
 * source: cortex@ed33435 mcp_server/core/replay_selection.py:38-59
 *   0.4 / 0.6 weights — hand-tuned engineering choice (no paper)
 */
export function computeSequencePriority(
  events: ReplayEvent[],
  dopamineLevel = 1.0,
): number {
  if (events.length < 2) return 0.0;

  const heats = events.map((e) => e.heat);
  const avgHeat = heats.reduce((a, b) => a + b, 0) / heats.length;
  const variance = heats.reduce((s, h) => s + (h - avgHeat) ** 2, 0) / heats.length;
  // source: cortex@ed33435 mcp_server/core/replay_selection.py:57
  const rawPriority = (avgHeat * 0.4 + Math.sqrt(variance) * 0.6) * dopamineLevel;
  return Math.max(0.0, Math.min(1.0, rawPriority));
}

/** Backward compatibility alias. source: cortex@ed33435 mcp_server/core/replay_selection.py:63 */
export const computeSequenceRpe = computeSequencePriority;

// ── Sequence selection ────────────────────────────────────────────────────

/**
 * Take top candidates when none meet the priority threshold.
 * source: cortex@ed33435 mcp_server/core/replay_selection.py:87-93
 */
function fallbackSelection(
  candidates: ReplaySequence[],
  maxSequences: number,
): ReplaySequence[] {
  return [...candidates]
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, maxSequences);
}

/**
 * Select sequences ensuring both forward and reverse are represented.
 * source: cortex@ed33435 mcp_server/core/replay_selection.py:96-125
 */
function balancedSelection(
  viable: ReplaySequence[],
  maxSequences: number,
): ReplaySequence[] {
  const forward = viable
    .filter((s) => s.direction === ReplayDirection.FORWARD)
    .sort((a, b) => b.priorityScore - a.priorityScore);
  const reverse = viable
    .filter((s) => s.direction === ReplayDirection.REVERSE)
    .sort((a, b) => b.priorityScore - a.priorityScore);

  const selected: ReplaySequence[] = [];
  if (forward.length > 0) selected.push(forward[0]!);
  if (reverse.length > 0) selected.push(reverse[0]!);

  const allSorted = [...viable].sort((a, b) => b.priorityScore - a.priorityScore);
  for (const seq of allSorted) {
    if (selected.length >= maxSequences) break;
    if (!selected.includes(seq)) selected.push(seq);
  }

  return selected.slice(0, maxSequences);
}

/**
 * Select top replay sequences for an SWR burst.
 *
 * Filters by priority threshold, then ranks by priority score. Ensures
 * at least one forward and one reverse sequence if available.
 *
 * precondition:  candidateSequences is an array; maxSequences >= 1.
 * postcondition: returned array length <= maxSequences; every sequence
 *   has priorityScore >= priorityThreshold (or fallback if none qualify).
 *
 * source: cortex@ed33435 mcp_server/core/replay_selection.py:69-84
 *   PRIORITY_THRESHOLD = 0.3; MAX_SEQUENCES_PER_SWR = 5 (hand-tuned)
 */
export function selectReplaySequences(
  candidateSequences: ReplaySequence[],
  maxSequences = MAX_SEQUENCES_PER_SWR,
  priorityThreshold = PRIORITY_THRESHOLD,
): ReplaySequence[] {
  const viable = candidateSequences.filter((s) => s.priorityScore >= priorityThreshold);
  if (viable.length === 0) {
    return fallbackSelection(candidateSequences, maxSequences);
  }
  return balancedSelection(viable, maxSequences);
}

// Re-export constants for testing
export { PRIORITY_THRESHOLD, MAX_SEQUENCES_PER_SWR };
