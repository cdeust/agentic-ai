/**
 * Unit tests for stage-detector.ts.
 *
 * Invariants:
 *   - allStages returns stable ordering (same order across calls)
 *   - ExplicitStageDetector: fallback when field absent
 *   - TemporalStageDetector: gaps > threshold start a new stage
 *   - CompositeStageDetector: falls through to temporal when explicit missing
 *   - Node ID uniqueness in allStages output (no duplicates)
 */

import { describe, expect, it } from "vitest";
import {
  CompositeStageDetector,
  ExplicitStageDetector,
  TemporalStageDetector,
} from "../../../src/recall/context-assembly/stage-detector.js";

describe("ExplicitStageDetector", () => {
  const det = new ExplicitStageDetector("plan_id", "default");

  it("returns the field value when present", () => {
    expect(det.stageOf({ plan_id: "p1" })).toBe("p1");
  });

  it("returns fallback when field absent", () => {
    expect(det.stageOf({})).toBe("default");
    expect(det.stageOf({ plan_id: "" })).toBe("default");
  });

  it("allStages returns unique stages in seen order", () => {
    const corpus = [
      { plan_id: "s1" },
      { plan_id: "s2" },
      { plan_id: "s1" },
    ];
    const stages = det.allStages(corpus);
    expect(stages).toEqual(["s1", "s2"]);
  });

  it("allStages output has no duplicates (node ID uniqueness)", () => {
    const corpus = Array.from({ length: 5 }, (_, i) => ({ plan_id: `s${i % 3}` }));
    const stages = det.allStages(corpus);
    expect(stages.length).toBe(new Set(stages).size);
  });
});

describe("TemporalStageDetector", () => {
  const det = new TemporalStageDetector(4.0, "created_at");

  it("stageOf falls back to day bucket for ISO timestamps", () => {
    const stage = det.stageOf({ created_at: "2024-03-15T10:00:00Z" });
    expect(stage).toBe("day-2024-03-15");
  });

  it("stageOf returns 'default' for missing timestamp", () => {
    expect(det.stageOf({})).toBe("default");
  });

  it("allStages assigns the same stage to memories within the gap", () => {
    const det2 = new TemporalStageDetector(4.0, "created_at");
    const corpus = [
      { memory_id: 1, created_at: "2024-03-15T08:00:00Z" },
      { memory_id: 2, created_at: "2024-03-15T09:00:00Z" }, // 1h gap < 4h
      { memory_id: 3, created_at: "2024-03-15T14:00:00Z" }, // 5h gap > 4h → new stage
    ];
    const stages = det2.allStages(corpus);
    // Should produce 2 stages
    expect(stages).toHaveLength(2);
    // Uniqueness invariant
    expect(stages.length).toBe(new Set(stages).size);
  });

  it("stageOf uses cache after allStages pre-computation", () => {
    const det3 = new TemporalStageDetector(4.0, "created_at");
    const corpus = [
      { memory_id: "m1", created_at: "2024-01-01T00:00:00Z" },
      { memory_id: "m2", created_at: "2024-01-01T01:00:00Z" },
    ];
    det3.allStages(corpus);
    expect(det3.stageOf({ memory_id: "m1", created_at: "2024-01-01T00:00:00Z" })).toBe("stage-1");
    expect(det3.stageOf({ memory_id: "m2", created_at: "2024-01-01T01:00:00Z" })).toBe("stage-1");
  });
});

describe("CompositeStageDetector", () => {
  it("throws when constructed with no detectors", () => {
    expect(() => new CompositeStageDetector([])).toThrow();
  });

  it("prefers explicit stage over temporal", () => {
    const explicit = new ExplicitStageDetector("plan_id");
    const temporal = new TemporalStageDetector(4.0, "created_at");
    const comp = new CompositeStageDetector([explicit, temporal]);

    expect(comp.stageOf({ plan_id: "custom-stage" })).toBe("custom-stage");
  });

  it("returns first detector fallback when no detector wins", () => {
    // Python semantics: day-* stages are excluded from the winner list too,
    // so explicit "default" AND temporal "day-..." both fail the filter.
    // Last resort: first detector's output.
    const explicit = new ExplicitStageDetector("plan_id", "default");
    const temporal = new TemporalStageDetector(4.0, "created_at");
    const comp = new CompositeStageDetector([explicit, temporal], "default");

    // No plan_id → explicit returns "default"; temporal returns "day-..."
    // Neither pass the filter (fallback / day-* excluded). Last resort = explicit(memory) = "default".
    const stage = comp.stageOf({ created_at: "2024-03-15T10:00:00Z" });
    expect(stage).toBe("default");
  });

  it("returns explicit stage when one of the detectors has a non-fallback stage", () => {
    const explicit = new ExplicitStageDetector("plan_id", "default");
    const temporal = new TemporalStageDetector(4.0, "created_at");
    const comp = new CompositeStageDetector([explicit, temporal], "default");

    const stage = comp.stageOf({ plan_id: "my-real-stage", created_at: "2024-03-15T10:00:00Z" });
    expect(stage).toBe("my-real-stage");
  });

  it("allStages union has no duplicates", () => {
    const d1 = new ExplicitStageDetector("a");
    const d2 = new ExplicitStageDetector("b");
    const comp = new CompositeStageDetector([d1, d2]);
    const corpus = [
      { a: "s1", b: "s1" },
      { a: "s2", b: "s3" },
    ];
    const stages = comp.allStages(corpus);
    expect(stages.length).toBe(new Set(stages).size);
  });
});
