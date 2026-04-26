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

import { computeStageAdjustedDecay } from "../cascade-stages.js";

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

const NEXT_STAGE: Record<string, string> = {
  labile: "early_ltp",
  early_ltp: "late_ltp",
  late_ltp: "consolidated",
  reconsolidating: "consolidated",
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
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeRealHours(mem: Record<string, unknown>, now: Date): number {
  const stageEntered = mem["stage_entered_at"];
  if (stageEntered) {
    const dt = typeof stageEntered === "string" ? new Date(stageEntered) : stageEntered as Date;
    if (!isNaN(dt.getTime())) {
      return Math.max(0.0, (now.getTime() - dt.getTime()) / 3_600_000);
    }
  }
  const created = mem["created_at"];
  if (created) {
    const dt = typeof created === "string" ? new Date(created) : created as Date;
    if (!isNaN(dt.getTime())) {
      return Math.max(0.0, (now.getTime() - dt.getTime()) / 3_600_000);
    }
  }
  return (mem["hours_in_stage"] as number | undefined) ?? 0.0;
}

function isReadyToAdvance(stageName: string, hoursInStage: number): boolean {
  const minDwell = MIN_DWELL[stageName] ?? 1.0;
  return hoursInStage >= minDwell;
}

type HeartbeatStatus = "written" | "skipped" | "transition";

async function tryAdvance(
  store: CascadeStore,
  mem: Record<string, unknown>,
  stageName: string,
  now: Date,
): Promise<[Record<string, unknown> | null, HeartbeatStatus]> {
  const hours = computeRealHours(mem, now);
  const ready = isReadyToAdvance(stageName, hours);
  const nextStage = NEXT_STAGE[stageName] ?? stageName;

  if (ready && nextStage !== stageName) {
    const dwell = MIN_DWELL[stageName] ?? 1.0;
    const remainingHours = Math.max(0.0, hours - dwell);

    await store.updateMemoryConsolidation(
      mem["id"] as number,
      nextStage,
      Math.round(remainingHours * 100) / 100,
      (mem["replay_count"] as number | undefined) ?? 0,
      (mem["hippocampal_dependency"] as number | undefined) ?? 1.0,
    );

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

// suppress unused import warning
void computeStageAdjustedDecay;

// ── Public API ────────────────────────────────────────────────────────────────

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

/**
 * Advance memory consolidation stages based on real elapsed time.
 *
 * Skips no-op heartbeat UPDATEs (|Δhours| < HEARTBEAT_SKIP_HOURS),
 * batches stage_transitions INSERTs into one statement, and caps the
 * response payload at transitions_preview (first N) + total count.
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
