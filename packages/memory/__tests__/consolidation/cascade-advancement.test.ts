/**
 * Cascade advancement — unit tests.
 *
 * Invariants verified per Move 2:
 *   1. ready=false when hoursInStage < effective_min_dwell; nextStage = currentStage.
 *   2. Labile: advances with importance > 0.3 OR dopamineLevel >= 1.0
 *      (min_dwell = 0.0h from cascade_stages.ts — no mandatory wait).
 *   3. EarlyLTP: advances with replayCount >= 1 OR importance > 0.4
 *      (min_dwell = 1.0h from cascade_stages.ts).
 *   4. LateLTP: advances with replayCount >= 3 (or 1 with schemaMatch >= 0.5)
 *      (min_dwell = 6.0h from cascade_stages.ts).
 *   5. Reconsolidating: advances after effective_min_dwell
 *      (min_dwell = 0.0h from cascade_stages.ts — check is purely time-based against effective dwell).
 *   6. readinessScore in [0, 1] for all inputs.
 *   7. triggerReconsolidation: only fires for consolidated/late_ltp stages.
 *   8. Schema acceleration: effective min_dwell decreases with schema_match for late_ltp.
 *
 * Note: minDwellHours from cascade_stages.ts:
 *   labile=0.0, early_ltp=1.0, late_ltp=6.0, consolidated=24.0, reconsolidating=0.0
 * These values differ from the handler's _MIN_DWELL constants (which are used for
 * computing remaining_hours during transition, not advancement gating).
 */

import { describe, it, expect } from "vitest";
import {
  computeAdvancementReadiness,
  triggerReconsolidation,
} from "../../src/consolidation/cascade-advancement.js";

describe("computeAdvancementReadiness", () => {
  describe("precondition: hours < effective_min_dwell → ready=false", () => {
    it("early_ltp: hours=0.5 < min_dwell=1.0 → not ready (regardless of conditions)", () => {
      const r = computeAdvancementReadiness("early_ltp", 0.5, { replayCount: 5, importance: 0.9 });
      expect(r.ready).toBe(false);
      expect(r.nextStage).toBe("early_ltp");
      expect(r.readinessScore).toBeGreaterThanOrEqual(0);
      expect(r.readinessScore).toBeLessThan(1);
    });

    it("late_ltp: hours=3.0 < min_dwell=6.0 → not ready", () => {
      const r = computeAdvancementReadiness("late_ltp", 3.0, { replayCount: 10 });
      expect(r.ready).toBe(false);
      expect(r.nextStage).toBe("late_ltp");
    });

    it("consolidated: hours=10.0 < min_dwell=24.0 → not ready", () => {
      const r = computeAdvancementReadiness("consolidated", 10.0, {});
      expect(r.ready).toBe(false);
    });
  });

  describe("labile advancement (min_dwell=0.0h — no mandatory wait)", () => {
    it("advances with importance > 0.3 at any hours", () => {
      const r = computeAdvancementReadiness("labile", 0.5, { importance: 0.5, dopamineLevel: 0.0 });
      expect(r.ready).toBe(true);
      expect(r.nextStage).toBe("early_ltp");
    });

    it("advances with dopamineLevel >= 1.0 at any hours", () => {
      const r = computeAdvancementReadiness("labile", 0.1, { importance: 0.0, dopamineLevel: 1.0 });
      expect(r.ready).toBe(true);
      expect(r.nextStage).toBe("early_ltp");
    });

    it("does not advance with importance <= 0.3 and dopamine < 1.0", () => {
      const r = computeAdvancementReadiness("labile", 2.0, { importance: 0.1, dopamineLevel: 0.5 });
      expect(r.ready).toBe(false);
      expect(r.nextStage).toBe("labile");
    });
  });

  describe("early_ltp advancement (min_dwell=1.0h)", () => {
    it("advances with replayCount >= 1 after min_dwell", () => {
      const r = computeAdvancementReadiness("early_ltp", 2.0, { replayCount: 1, importance: 0.0 });
      expect(r.ready).toBe(true);
      expect(r.nextStage).toBe("late_ltp");
    });

    it("advances with importance > 0.4 even with replayCount=0", () => {
      const r = computeAdvancementReadiness("early_ltp", 2.0, { replayCount: 0, importance: 0.5 });
      expect(r.ready).toBe(true);
      expect(r.nextStage).toBe("late_ltp");
    });

    it("does not advance with replayCount=0 and importance=0.3 after min_dwell", () => {
      const r = computeAdvancementReadiness("early_ltp", 2.0, { replayCount: 0, importance: 0.3 });
      expect(r.ready).toBe(false);
    });
  });

  describe("late_ltp advancement (min_dwell=6.0h)", () => {
    it("needs 3 replays without schema match", () => {
      const r2 = computeAdvancementReadiness("late_ltp", 10.0, { replayCount: 2, schemaMatch: 0.0 });
      expect(r2.ready).toBe(false);
      const r3 = computeAdvancementReadiness("late_ltp", 10.0, { replayCount: 3, schemaMatch: 0.0 });
      expect(r3.ready).toBe(true);
      expect(r3.nextStage).toBe("consolidated");
    });

    it("needs only 1 replay with schema >= 0.5", () => {
      const r = computeAdvancementReadiness("late_ltp", 10.0, { replayCount: 1, schemaMatch: 0.5 });
      expect(r.ready).toBe(true);
      expect(r.nextStage).toBe("consolidated");
    });
  });

  describe("reconsolidating advancement (min_dwell=0.0h × schema factor)", () => {
    it("advances at any hours with default schemaMatch (effective_min_dwell ≈ 0)", () => {
      // min_dwell = 0.0 * (1 - 0 * 0.2) = 0.0 → always past min_dwell
      const r = computeAdvancementReadiness("reconsolidating", 0.0, {});
      // At 0.0h, hours >= 0.0 so the check passes and stage check runs.
      // _checkReconsolidatingAdvancement: if hours >= effectiveMinDwell (0.0) → advances
      expect(r.ready).toBe(true);
      expect(r.nextStage).toBe("early_ltp");
    });

    it("advances at 3h (min_dwell=0.0h, so any hours >= 0.0 advances)", () => {
      const r = computeAdvancementReadiness("reconsolidating", 3.0, {});
      expect(r.ready).toBe(true);
      expect(r.nextStage).toBe("early_ltp");
    });
  });

  describe("readinessScore invariant", () => {
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
          });
          expect(r.readinessScore).toBeGreaterThanOrEqual(0);
          expect(r.readinessScore).toBeLessThanOrEqual(1);
        }
      }
    });
  });

  describe("schema acceleration for late_ltp", () => {
    it("schema_match=1.0 reduces effective min_dwell (≈ 1.6h) → ready at 2h with 1 replay", () => {
      // With schema_match=1.0: min_dwell = 6 * 15^(-1.0) ≈ 0.4h
      // Memory at 2h should be ready with replayThreshold = 1
      const r = computeAdvancementReadiness("late_ltp", 2.0, {
        replayCount: 1,
        schemaMatch: 1.0,
      });
      expect(r.ready).toBe(true);
      expect(r.nextStage).toBe("consolidated");
    });

    it("schema_match=0.0: not ready at 3h with 1 replay (need 6h + 3 replays)", () => {
      const r = computeAdvancementReadiness("late_ltp", 3.0, {
        replayCount: 1,
        schemaMatch: 0.0,
      });
      // 3h < 6h min_dwell → not ready regardless
      expect(r.ready).toBe(false);
    });
  });
});

describe("triggerReconsolidation", () => {
  it("fires for consolidated stage with high mismatch", () => {
    const r = triggerReconsolidation("consolidated", 0.8, 0.0);
    expect(r.triggered).toBe(true);
    expect(r.newStage).toBe("reconsolidating");
  });

  it("does not fire for labile stage", () => {
    const r = triggerReconsolidation("labile", 0.9, 0.0);
    expect(r.triggered).toBe(false);
    expect(r.newStage).toBe("labile");
  });

  it("does not fire for early_ltp stage", () => {
    const r = triggerReconsolidation("early_ltp", 0.9, 0.0);
    expect(r.triggered).toBe(false);
  });

  it("does not fire below threshold", () => {
    const r = triggerReconsolidation("consolidated", 0.1, 0.5);
    expect(r.triggered).toBe(false);
  });

  it("fires for late_ltp with sufficient mismatch", () => {
    const r = triggerReconsolidation("late_ltp", 0.5, 0.0);
    expect(r.triggered).toBe(true);
    expect(r.newStage).toBe("reconsolidating");
  });

  it("higher stability requires higher mismatch to trigger", () => {
    // stability=0.5: threshold = 0.3 + 0.5 * 0.2 = 0.4
    const rBelow = triggerReconsolidation("consolidated", 0.35, 0.5);
    expect(rBelow.triggered).toBe(false);
    const rAbove = triggerReconsolidation("consolidated", 0.45, 0.5);
    expect(rAbove.triggered).toBe(true);
  });
});
