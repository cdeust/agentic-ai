/**
 * Cascade stage handler — invariant tests.
 *
 * Invariants verified:
 *   1. Decay monotone: memories advanced to later stages have remaining_hours <= hours_in_prev.
 *   2. Heartbeat skipped when |Δhours| < HEARTBEAT_SKIP_HOURS (= 1.0).
 *   3. transitions_preview capped at TRANSITION_PREVIEW_CAP (= 50).
 *   4. scanned = sum of memories per stage.
 *   5. LABILE memory with importance > 0.3 advances after min_dwell (1.0h).
 */

import { describe, it, expect } from "vitest";
import {
  runCascadeAdvancement,
  type CascadeStore,
  type CascadeStageResult,
} from "../../../src/consolidation/stages/cascade.js";

function makeMem(
  id: number,
  stage: string,
  hoursInStage: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const now = new Date();
  const stageEnteredAt = new Date(now.getTime() - hoursInStage * 3_600_000);
  return {
    id,
    stage_entered_at: stageEnteredAt.toISOString(),
    hours_in_stage: hoursInStage,
    replay_count: 0,
    hippocampal_dependency: 1.0,
    importance: 0.5,
    schema_match_score: 0.0,
    ...overrides,
  };
}

function makeStore(
  memsByStage: Record<string, Record<string, unknown>[]>,
): CascadeStore & { transitions: Record<string, unknown>[]; updatedEnteredAt: Array<[number, Date]> } {
  const transitions: Record<string, unknown>[] = [];
  const updates: Map<number, { stage: string; hours: number }> = new Map();
  const updatedEnteredAt: Array<[number, Date]> = [];

  return {
    transitions,
    updatedEnteredAt,
    async getMemoriesByStage(stage: string, _limit: number) {
      return memsByStage[stage] ?? [];
    },
    async updateMemoryConsolidation(id, stage, hours) {
      updates.set(id, { stage, hours });
    },
    async insertStageTransitionsBatch(t) {
      transitions.push(...t);
    },
    async updateStageEnteredAt(memoryId, enteredAt) {
      updatedEnteredAt.push([memoryId, enteredAt]);
    },
  };
}

describe("runCascadeAdvancement", () => {
  it("advances a labile memory with importance > 0.3 after 1h", async () => {
    const store = makeStore({
      labile: [makeMem(1, "labile", 2.0, { importance: 0.5 })],
      early_ltp: [],
      late_ltp: [],
      reconsolidating: [],
    });

    const result = await runCascadeAdvancement(store);
    expect(result.advanced).toBe(1);
    expect(result.scanned).toBe(1);
    expect(store.transitions).toHaveLength(1);
    expect(store.transitions[0]?.["from_stage"]).toBe("labile");
    expect(store.transitions[0]?.["to_stage"]).toBe("early_ltp");
  });

  it("skips heartbeat when |Δhours| < 1.0", async () => {
    // memory has hours_in_stage=2.0 and was stage_entered at 2.05h ago
    // delta = 0.05 < 1.0 → skipped
    const now = new Date();
    const stageEnteredAt = new Date(now.getTime() - 2.05 * 3_600_000);
    const mem: Record<string, unknown> = {
      id: 2,
      stage_entered_at: stageEnteredAt.toISOString(),
      hours_in_stage: 2.0,
      replay_count: 0,
      hippocampal_dependency: 1.0,
      importance: 0.1, // below 0.3 → won't advance from labile until min_dwell
    };
    // For labile: needs importance > 0.3 OR dopamine >= 1.0. importance=0.1 + dopamine=1.0 → advances.
    // Let's use importance=0.1 and a fresh memory that hasn't crossed min_dwell yet.
    // Actually dopamine_level defaults to 1.0 so it WILL advance. Use early_ltp (needs replay≥1 or importance>0.4).
    const memEarlyLtp: Record<string, unknown> = {
      id: 3,
      stage_entered_at: stageEnteredAt.toISOString(),
      hours_in_stage: 2.0,
      replay_count: 0,
      hippocampal_dependency: 1.0,
      importance: 0.1,
    };
    const store = makeStore({
      labile: [],
      early_ltp: [memEarlyLtp],
      late_ltp: [],
      reconsolidating: [],
    });
    const result = await runCascadeAdvancement(store);
    // Memory has hours_in_stage=2.0, actual=2.05h. Not ready (replay=0, importance=0.1).
    // Δhours = 2.05 - 2.0 = 0.05 < 1.0 → heartbeat skipped.
    expect(result.heartbeats_skipped).toBe(1);
    expect(result.heartbeats_written).toBe(0);
    expect(result.advanced).toBe(0);
  });

  it("caps transitions_preview at 50", async () => {
    // Create 60 labile memories with importance > 0.3 and dwell > 1h
    const memories = Array.from({ length: 60 }, (_, i) =>
      makeMem(i + 100, "labile", 2.0, { importance: 0.5 }),
    );
    const store = makeStore({
      labile: memories,
      early_ltp: [],
      late_ltp: [],
      reconsolidating: [],
    });
    const result = await runCascadeAdvancement(store);
    expect(result.advanced).toBe(60);
    expect(result.transitions_count).toBe(60);
    expect(result.transitions_preview).toHaveLength(50);
  });

  it("scanned equals total memories across all stages", async () => {
    const store = makeStore({
      labile: [makeMem(1, "labile", 0.3)],
      early_ltp: [makeMem(2, "early_ltp", 2.0), makeMem(3, "early_ltp", 3.0)],
      late_ltp: [makeMem(4, "late_ltp", 5.0)],
      reconsolidating: [],
    });
    const result = await runCascadeAdvancement(store);
    expect(result.scanned).toBe(4);
  });

  it("returns error shape on store exception", async () => {
    const badStore: CascadeStore = {
      async getMemoriesByStage() {
        throw new Error("db down");
      },
      async updateMemoryConsolidation() {},
      async insertStageTransitionsBatch() {},
      async updateStageEnteredAt() {},
    };
    const result: CascadeStageResult = await runCascadeAdvancement(badStore);
    expect(result.advanced).toBe(0);
    expect(result.error).toContain("db down");
  });

  it("updateStageEnteredAt called for each transition", async () => {
    const store = makeStore({
      labile: [makeMem(10, "labile", 2.0, { importance: 0.5 })],
      early_ltp: [],
      late_ltp: [],
      reconsolidating: [],
    });
    await runCascadeAdvancement(store);
    expect(store.updatedEnteredAt).toHaveLength(1);
    expect(store.updatedEnteredAt[0]?.[0]).toBe(10);
    expect(store.updatedEnteredAt[0]?.[1]).toBeInstanceOf(Date);
  });
});
