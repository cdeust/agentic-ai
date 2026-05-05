/**
 * Cascade advancement — unit tests.
 *
 * Invariants verified per Move 2:
 *   1. ready=false when hoursInStage < effective_min_dwell; nextStage = currentStage.
 *   2. Labile: advances with importance > 0.3 OR dopamineLevel >= 1.0
 *      (min_dwell = 0.0h — no mandatory wait).
 *   3. EarlyLTP: advances with replayCount >= 1 OR importance > 0.4
 *      (min_dwell = 1.0h).
 *   4. LateLTP: advances with replayCount >= 3 (or 1 with schemaMatch >= 0.5)
 *      (min_dwell = 6.0h).
 *   5. Reconsolidating: advances after effective_min_dwell.
 *   6. readinessScore in [0, 1] for all inputs.
 *   7. triggerReconsolidation: only fires for consolidated/late_ltp stages.
 *   8. Schema acceleration: effective min_dwell decreases with schema_match for late_ltp.
 *   9. Ablation: CASCADE disabled → always (false, currentStage, 0.0).
 *
 * source: cortex@ed33435 mcp_server/core/cascade_advancement.py
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  computeAdvancementReadiness,
  triggerReconsolidation,
  effectiveMinDwell,
  ConsolidationStage,
} from "../../src/consolidation/cascade-advancement.js";

// Clean ablation env before/after each test
beforeEach(() => {
  delete process.env["CORTEX_ABLATE_CONSOLIDATION_CASCADE"];
});
afterEach(() => {
  delete process.env["CORTEX_ABLATE_CONSOLIDATION_CASCADE"];
});

// ── effectiveMinDwell ─────────────────────────────────────────────────────

describe("effectiveMinDwell", () => {
  it("no acceleration at schemaMatch=0", () => {
    const base = effectiveMinDwell(ConsolidationStage.LATE_LTP, 0.0);
    expect(base).toBeGreaterThan(0);
  });

  it("accelerates late_ltp at schemaMatch=1.0 (~15x)", () => {
    const slow = effectiveMinDwell(ConsolidationStage.LATE_LTP, 0.0);
    const fast = effectiveMinDwell(ConsolidationStage.LATE_LTP, 1.0);
    // 15^(-1) ≈ 0.067 → ~15x faster
    expect(slow / fast).toBeGreaterThan(10);
  });

  it("labile stage has zero base dwell (no time required)", () => {
    // LABILE min_dwell_hours = 0.0 → effectiveMinDwell returns 0 regardless of schema_match
    // source: cortex@ed33435 mcp_server/core/cascade_stages.py LABILE min_dwell_hours=0
    const slow = effectiveMinDwell(ConsolidationStage.LABILE, 0.0);
    const fast = effectiveMinDwell(ConsolidationStage.LABILE, 1.0);
    expect(slow).toBe(0);
    expect(fast).toBe(0);
  });
});

// ── computeAdvancementReadiness — tuple (positional) form ─────────────────

describe("computeAdvancementReadiness (tuple form)", () => {
  it("returns false when ablation disabled", () => {
    process.env["CORTEX_ABLATE_CONSOLIDATION_CASCADE"] = "1";
    const [isReady] = computeAdvancementReadiness("labile", 100, 2.0, 5, 0, 0.9) as [boolean, string, number];
    expect(isReady).toBe(false);
  });

  it("labile advances with high dopamine", () => {
    const [isReady, nextStage] = computeAdvancementReadiness(
      ConsolidationStage.LABILE,
      0,
      2.0, // dopamine >= 1.0
      0,
      0,
      0.5,
    ) as [boolean, string, number];
    expect(isReady).toBe(true);
    expect(nextStage).toBe(ConsolidationStage.EARLY_LTP);
  });

  it("labile does not advance with low dopamine and low importance", () => {
    const [isReady] = computeAdvancementReadiness(
      ConsolidationStage.LABILE,
      0,
      0.0, // low dopamine
      0,
      0,
      0.1, // low importance
    ) as [boolean, string, number];
    expect(isReady).toBe(false);
  });

  it("early_ltp advances after replay", () => {
    const [isReady, next] = computeAdvancementReadiness(
      ConsolidationStage.EARLY_LTP,
      2,
      1.0,
      1, // replay_count >= 1
      0,
      0.5,
    ) as [boolean, string, number];
    expect(isReady).toBe(true);
    expect(next).toBe(ConsolidationStage.LATE_LTP);
  });

  it("returns false for unknown stage", () => {
    const [isReady, stage] = computeAdvancementReadiness("unknown_stage", 100) as [boolean, string, number];
    expect(isReady).toBe(false);
    expect(stage).toBe("unknown_stage");
  });
});

// ── computeAdvancementReadiness — opts-object form ────────────────────────

describe("computeAdvancementReadiness (opts form)", () => {
  it("hours < effective_min_dwell → not ready (early_ltp)", () => {
    const r = computeAdvancementReadiness("early_ltp", 0.5, { replayCount: 5, importance: 0.9 }) as { ready: boolean; nextStage: string; readinessScore: number };
    expect(r.ready).toBe(false);
    expect(r.nextStage).toBe("early_ltp");
    expect(r.readinessScore).toBeGreaterThanOrEqual(0);
    expect(r.readinessScore).toBeLessThan(1);
  });

  it("late_ltp: hours=3.0 < min_dwell=6.0 → not ready", () => {
    const r = computeAdvancementReadiness("late_ltp", 3.0, { replayCount: 10 }) as { ready: boolean; nextStage: string; readinessScore: number };
    expect(r.ready).toBe(false);
    expect(r.nextStage).toBe("late_ltp");
  });

  it("labile advances with importance > 0.3", () => {
    const r = computeAdvancementReadiness("labile", 0.5, { importance: 0.5, dopamineLevel: 0.0 }) as { ready: boolean; nextStage: string; readinessScore: number };
    expect(r.ready).toBe(true);
    expect(r.nextStage).toBe("early_ltp");
  });

  it("labile advances with dopamineLevel >= 1.0", () => {
    const r = computeAdvancementReadiness("labile", 0.1, { importance: 0.0, dopamineLevel: 1.0 }) as { ready: boolean; nextStage: string; readinessScore: number };
    expect(r.ready).toBe(true);
    expect(r.nextStage).toBe("early_ltp");
  });

  it("early_ltp advances with importance > 0.4 even with replayCount=0", () => {
    const r = computeAdvancementReadiness("early_ltp", 2.0, { replayCount: 0, importance: 0.5 }) as { ready: boolean; nextStage: string; readinessScore: number };
    expect(r.ready).toBe(true);
    expect(r.nextStage).toBe("late_ltp");
  });

  it("late_ltp needs 3 replays without schema match", () => {
    const r2 = computeAdvancementReadiness("late_ltp", 10.0, { replayCount: 2, schemaMatch: 0.0 }) as { ready: boolean; nextStage: string; readinessScore: number };
    expect(r2.ready).toBe(false);
    const r3 = computeAdvancementReadiness("late_ltp", 10.0, { replayCount: 3, schemaMatch: 0.0 }) as { ready: boolean; nextStage: string; readinessScore: number };
    expect(r3.ready).toBe(true);
    expect(r3.nextStage).toBe("consolidated");
  });

  it("late_ltp needs only 1 replay with schema >= 0.5", () => {
    const r = computeAdvancementReadiness("late_ltp", 10.0, { replayCount: 1, schemaMatch: 0.5 }) as { ready: boolean; nextStage: string; readinessScore: number };
    expect(r.ready).toBe(true);
    expect(r.nextStage).toBe("consolidated");
  });

  it("readinessScore always in [0, 1]", () => {
    const stages = ["labile", "early_ltp", "late_ltp", "reconsolidating"];
    const hoursList = [0, 1, 6, 24, 100];
    for (const stage of stages) {
      for (const hours of hoursList) {
        const r = computeAdvancementReadiness(stage, hours, {
          dopamineLevel: 1.0,
          replayCount: 5,
          importance: 0.8,
          schemaMatch: 0.5,
        }) as { readinessScore: number };
        expect(r.readinessScore).toBeGreaterThanOrEqual(0);
        expect(r.readinessScore).toBeLessThanOrEqual(1);
      }
    }
  });

  it("schema_match=1.0 reduces effective min_dwell → ready at 2h with 1 replay", () => {
    // With schema_match=1.0: min_dwell = 6 * 15^(-1.0) ≈ 0.4h → 2h > 0.4h
    const r = computeAdvancementReadiness("late_ltp", 2.0, {
      replayCount: 1,
      schemaMatch: 1.0,
    }) as { ready: boolean; nextStage: string };
    expect(r.ready).toBe(true);
    expect(r.nextStage).toBe("consolidated");
  });
});

// ── triggerReconsolidation ────────────────────────────────────────────────

describe("triggerReconsolidation", () => {
  it("triggers from consolidated with high mismatch", () => {
    const [trigger, newStage] = triggerReconsolidation(
      ConsolidationStage.CONSOLIDATED,
      0.9,
      0.1,
    );
    expect(trigger).toBe(true);
    expect(newStage).toBe(ConsolidationStage.RECONSOLIDATING);
  });

  it("does not trigger from labile", () => {
    const [trigger] = triggerReconsolidation(ConsolidationStage.LABILE, 0.9);
    expect(trigger).toBe(false);
  });

  it("does not trigger from early_ltp", () => {
    const [trigger] = triggerReconsolidation(ConsolidationStage.EARLY_LTP, 0.9);
    expect(trigger).toBe(false);
  });

  it("fires for late_ltp with sufficient mismatch", () => {
    const [trigger, newStage] = triggerReconsolidation(ConsolidationStage.LATE_LTP, 0.5, 0.0);
    expect(trigger).toBe(true);
    expect(newStage).toBe(ConsolidationStage.RECONSOLIDATING);
  });

  it("high stability requires higher mismatch to trigger", () => {
    // stability=0.9: threshold = 0.3 + 0.9 * 0.3 = 0.57
    const [triggerLow] = triggerReconsolidation(
      ConsolidationStage.CONSOLIDATED,
      0.4,
      0.9,
    );
    const [triggerHigh] = triggerReconsolidation(
      ConsolidationStage.CONSOLIDATED,
      0.6,
      0.9,
    );
    expect(triggerLow).toBe(false);
    expect(triggerHigh).toBe(true);
  });

  it("does not fire below threshold", () => {
    const [trigger] = triggerReconsolidation("consolidated", 0.1, 0.5);
    expect(trigger).toBe(false);
  });
});
