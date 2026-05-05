/**
 * Tests for replay-types.ts — data types and factory functions.
 *
 * Invariant: factory functions produce correct defaults.
 * Happy path: makeReplayEvent, makeReplaySequence, makeReplayResult.
 * Error path: empty/missing fields produce sensible defaults.
 */

import { describe, it, expect } from "vitest";
import {
  ReplayDirection,
  makeReplayEvent,
  makeReplaySequence,
  makeReplayResult,
} from "../../src/consolidation/replay-types.js";

describe("makeReplayEvent", () => {
  it("creates event with required fields", () => {
    const ev = makeReplayEvent(42, "hello world");
    expect(ev.memoryId).toBe(42);
    expect(ev.content).toBe("hello world");
  });

  it("uses default values when opts omitted", () => {
    const ev = makeReplayEvent(1, "content");
    expect(ev.heat).toBe(0.0);
    expect(ev.createdAt).toBe("");
    expect(ev.entities).toEqual([]);
    expect(ev.causalEdges).toEqual([]);
  });

  it("uses provided opts", () => {
    const ev = makeReplayEvent(1, "content", {
      heat: 0.7,
      createdAt: "2024-01-01T00:00:00Z",
      entities: ["A", "B"],
    });
    expect(ev.heat).toBe(0.7);
    expect(ev.createdAt).toBe("2024-01-01T00:00:00Z");
    expect(ev.entities).toEqual(["A", "B"]);
  });
});

describe("makeReplaySequence", () => {
  it("creates sequence with default direction FORWARD", () => {
    const seq = makeReplaySequence();
    expect(seq.direction).toBe(ReplayDirection.FORWARD);
    expect(seq.events).toEqual([]);
    expect(seq.priorityScore).toBe(0.0);
  });

  it("overrides with provided opts", () => {
    const ev = makeReplayEvent(1, "test");
    const seq = makeReplaySequence({
      events: [ev],
      direction: ReplayDirection.REVERSE,
      priorityScore: 0.8,
    });
    expect(seq.events).toHaveLength(1);
    expect(seq.direction).toBe(ReplayDirection.REVERSE);
    expect(seq.priorityScore).toBe(0.8);
  });
});

describe("makeReplayResult", () => {
  it("creates result with zero counts by default", () => {
    const result = makeReplayResult();
    expect(result.sequencesGenerated).toBe(0);
    expect(result.memoriesReplayed).toBe(0);
    expect(result.stdpUpdates).toEqual([]);
    expect(result.forwardCount).toBe(0);
    expect(result.reverseCount).toBe(0);
  });
});

describe("ReplayDirection enum", () => {
  it("FORWARD and REVERSE are distinct", () => {
    expect(ReplayDirection.FORWARD).not.toBe(ReplayDirection.REVERSE);
  });

  it("FORWARD is 'forward'", () => {
    expect(ReplayDirection.FORWARD).toBe("forward");
  });

  it("REVERSE is 'reverse'", () => {
    expect(ReplayDirection.REVERSE).toBe("reverse");
  });
});
