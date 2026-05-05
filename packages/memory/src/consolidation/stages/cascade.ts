/**
 * Cascade stage: advance memory consolidation stages.
 *
 * Memories progress through: LABILE -> EARLY_LTP -> LATE_LTP -> CONSOLIDATED.
 * Uses real elapsed time from stage_entered_at to compute hours_in_stage.
 *
 * // source: issue #13 — cascade previously wrote a heartbeat UPDATE on
 *   EVERY scanned memory (~2000) even when nothing advanced. Below this
 *   delta, the hours_in_stage change is noise and the write is waste.
 * // source: issue #13 — the 503-transition payload darval reported is
 *   redundant with the stage_transitions table and inflates the MCP
 *   response. Surface a preview + count instead.
 *
 * Port of: mcp_server/handlers/consolidation/cascade.py
 */

import { computeAdvancementReadiness } from "../cascade-advancement.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const ADVANCEABLE_STAGES = ["labile", "early_ltp", "late_ltp", "reconsolidating"] as const;

// Source: issue #13 — see module docstring.
const HEARTBEAT_SKIP_HOURS = 1.0;
const TRANSITION_PREVIEW_CAP = 50;

const MIN_DWELL: Record<string, number> = {
  labile: 1.0,
  early_ltp: 6.0,
  late_ltp: 24.0,
  consolidated: Infinity,
  reconsolidating: 6.0,
};

// ── Store interface ───────────────────────────────────────────────────────────

export interface CascadeStore {
  getMemoriesByStage(stage: string, limit: number): Promise<Record<string, unknown>[]>;
  updateMemoryConsolidation(
    id: number,
    stage: string,
    hoursInStage: number,
    replayCount: number,
    hippocampalDependency: number,
  ): Promise<void>;
  insertStageTransitionsBatch(transitions: Record<string, unknown>[]): Promise<void>;
  updateStageEnteredAt(memoryId: number, enteredAt: Date): Promise<void>;
}

// ── Public result type ────────────────────────────────────────────────────────

export interface CascadeStageResult {
  advanced: number;
  scanned: number;
  heartbeats_written: number;
  heartbeats_skipped: number;
  transitions_count: number;
  transitions_preview: Record<string, unknown>[];
  error?: string;
  duration_ms?: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Compute real hours since the memory entered its current stage.
 *
 * Precondition: mem may carry stage_entered_at or created_at as ISO string or Date.
 * Postcondition: returns a non-negative float (hours).
 */
function computeRealHours(mem: Record<string, unknown>, now: Date): number {
  const stageEntered = mem["stage_entered_at"];
  if (stageEntered) {
    const dt =
      typeof stageEntered === "string" ? new Date(stageEntered) : (stageEntered as Date);
    if (!isNaN(dt.getTime())) {
      return Math.max(0.0, (now.getTime() - dt.getTime()) / 3_600_000);
    }
  }

  // Fallback: use created_at
  const created = mem["created_at"];
  if (created) {
    const dt = typeof created === "string" ? new Date(created) : (created as Date);
    if (!isNaN(dt.getTime())) {
      return Math.max(0.0, (now.getTime() - dt.getTime()) / 3_600_000);
    }
    // parse failed — fall through to stored value
  }

  return (mem["hours_in_stage"] as number | undefined) ?? 0.0;
}

type HeartbeatStatus = "written" | "skipped" | "transition";

/**
 * Check and advance a single memory.
 *
 * Precondition: mem belongs to stageName; now is current UTC time.
 * Postcondition: returns (transition_or_null, heartbeat_status).
 *   - If ready and nextStage differs: DB updated, transition returned.
 *   - If |Δhours| < HEARTBEAT_SKIP_HOURS: no write, "skipped".
 *   - Otherwise: heartbeat UPDATE written, null transition.
 */
async function tryAdvance(
  store: CascadeStore,
  mem: Record<string, unknown>,
  stageName: string,
  now: Date,
): Promise<[Record<string, unknown> | null, HeartbeatStatus]> {
  const hours = computeRealHours(mem, now);

  const { ready, nextStage } = computeAdvancementReadiness(stageName, hours, {
    dopamineLevel: 1.0,
    replayCount: (mem["replay_count"] as number | undefined) ?? 0,
    schemaMatch: (mem["schema_match_score"] as number | undefined) ?? 0.0,
    importance: (mem["importance"] as number | undefined) ?? 0.5,
  });

  if (ready && nextStage !== stageName) {
    // Compute stage_entered_at for the new stage:
    // For backfilled memories with real timestamps, account for the time
    // they would have spent in the previous stage (min_dwell hours).
    const dwell = MIN_DWELL[stageName] ?? 1.0;
    const remainingHours = Math.max(0.0, hours - dwell);
    const newEntered = new Date(now.getTime() - remainingHours * 3_600_000);

    await store.updateMemoryConsolidation(
      mem["id"] as number,
      nextStage,
      Math.round(remainingHours * 100) / 100,
      (mem["replay_count"] as number | undefined) ?? 0,
      (mem["hippocampal_dependency"] as number | undefined) ?? 1.0,
    );
    await updateStageEntered(store, mem["id"] as number, newEntered);

    return [
      {
        memory_id: mem["id"],
        from_stage: stageName,
        to_stage: nextStage,
        hours_in_prev: Math.round(hours * 100) / 100,
      },
      "transition",
    ];
  }

  // Not advancing: only write a heartbeat if the hours delta is
  // large enough to be informative. Below HEARTBEAT_SKIP_HOURS the
  // change is noise and wasted fsync amplification
  // (issue #13, Feinstein audit of darval's 66K-store run).
  const prevHours = (mem["hours_in_stage"] as number | undefined) ?? 0.0;
  if (Math.abs(hours - prevHours) < HEARTBEAT_SKIP_HOURS) {
    return [null, "skipped"];
  }

  await store.updateMemoryConsolidation(
    mem["id"] as number,
    stageName,
    Math.round(hours * 100) / 100,
    (mem["replay_count"] as number | undefined) ?? 0,
    (mem["hippocampal_dependency"] as number | undefined) ?? 1.0,
  );
  return [null, "written"];
}

/**
 * Set stage_entered_at to the given time after a transition.
 *
 * Phase 5: batch pool (consolidation stage advancement).
 * Errors are silently swallowed — this is a best-effort timestamp update.
 */
async function updateStageEntered(
  store: CascadeStore,
  memoryId: number,
  enteredAt: Date,
): Promise<void> {
  try {
    await store.updateStageEnteredAt(memoryId, enteredAt);
  } catch {
    // non-fatal: timestamp is informational
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Advance memory consolidation stages based on real elapsed time.
 *
 * Skips no-op heartbeat UPDATEs (|Δhours| < HEARTBEAT_SKIP_HOURS),
 * batches stage_transitions INSERTs into one statement, and caps the
 * response payload at transitions_preview (first N) + total count.
 *
 * Precondition: store is a valid CascadeStore.
 * Postcondition: returned object contains advanced, scanned, heartbeat counts;
 *   transitions_preview is capped at TRANSITION_PREVIEW_CAP items.
 */
export async function runCascadeAdvancement(store: CascadeStore): Promise<CascadeStageResult> {
  try {
    const transitions: Record<string, unknown>[] = [];
    let heartbeatsWritten = 0;
    let heartbeatsSkipped = 0;
    let scanned = 0;
    const now = new Date();

    for (const stageName of ADVANCEABLE_STAGES) {
      const memories = await store.getMemoriesByStage(stageName, 500);
      scanned += memories.length;

      for (const mem of memories) {
        const [result, heartbeat] = await tryAdvance(store, mem, stageName, now);
        if (result) transitions.push(result);
        if (heartbeat === "written") heartbeatsWritten++;
        else if (heartbeat === "skipped") heartbeatsSkipped++;
      }
    }

    await store.insertStageTransitionsBatch(transitions);

    return {
      advanced: transitions.length,
      scanned,
      heartbeats_written: heartbeatsWritten,
      heartbeats_skipped: heartbeatsSkipped,
      transitions_count: transitions.length,
      transitions_preview: transitions.slice(0, TRANSITION_PREVIEW_CAP),
    };
  } catch (exc) {
    return {
      advanced: 0,
      scanned: 0,
      heartbeats_written: 0,
      heartbeats_skipped: 0,
      transitions_count: 0,
      transitions_preview: [],
      error: `${(exc as Error).name}: ${(exc as Error).message}`,
    };
  }
}
