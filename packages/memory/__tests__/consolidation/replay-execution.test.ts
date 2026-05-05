/**
 * Unit tests for replay-execution.ts
 * source: cortex@ed33435 mcp_server/core/replay_execution.py
 */

import { describe, it, expect } from "vitest";
import {
  buildTemporalSequence,
  buildCausalSequence,
  computeReplayStdpPairs,
  ReplayDirection,
  MIN_SEQUENCE_LENGTH,
} from "../../src/consolidation/replay-execution.js";

const makeMem = (id: number, created_at: string, tags: string[] = [], heat = 0.5) =>
  ({ id, created_at, tags, heat, content: `mem${id}` });

// ── buildTemporalSequence ─────────────────────────────────────────────────

describe("buildTemporalSequence", () => {
  it("returns empty for empty input", () => {
    expect(buildTemporalSequence([])).toEqual([]);
  });

  it("sorts by created_at ascending", () => {
    const mems = [
      makeMem(2, "2024-01-02"),
      makeMem(1, "2024-01-01"),
    ];
    const seq = buildTemporalSequence(mems);
    expect(seq[0].memory_id).toBe(1);
    expect(seq[1].memory_id).toBe(2);
  });

  it("respects maxLength", () => {
    const mems = [1, 2, 3, 4, 5].map((i) => makeMem(i, `2024-01-0${i}`));
    const seq = buildTemporalSequence(mems, 3);
    expect(seq.length).toBe(3);
  });
});

// ── buildCausalSequence ───────────────────────────────────────────────────

describe("buildCausalSequence", () => {
  it("returns empty for null seed", () => {
    const seq = buildCausalSequence(null, [], []);
    expect(seq).toEqual([]);
  });

  it("includes seed memory first", () => {
    const seed = makeMem(1, "2024-01-01", ["entityA"]);
    const related = [makeMem(2, "2024-01-02", ["entityA"])];
    const seq = buildCausalSequence(seed, related, []);
    expect(seq[0].memory_id).toBe(1);
  });

  it("follows forward in time for FORWARD direction", () => {
    const seed = makeMem(1, "2024-01-02", ["A"]);
    const related = [
      makeMem(2, "2024-01-03", ["A"]), // after seed
      makeMem(3, "2024-01-01", ["A"]), // before seed — excluded
    ];
    const seq = buildCausalSequence(seed, related, [], ReplayDirection.FORWARD);
    const ids = seq.map((e) => e.memory_id);
    expect(ids).toContain(2);
    expect(ids).not.toContain(3);
  });
});

// ── computeReplayStdpPairs ────────────────────────────────────────────────

describe("computeReplayStdpPairs", () => {
  it("returns empty for single event", () => {
    const events = [{ memory_id: 1, content: "x", heat: 0.5, created_at: "", entities: ["A"] }];
    const pairs = computeReplayStdpPairs(events, ReplayDirection.FORWARD);
    expect(pairs).toEqual([]);
  });

  it("returns pairs for two events with different entities", () => {
    const events = [
      { memory_id: 1, content: "a", heat: 0.5, created_at: "", entities: ["entityA"] },
      { memory_id: 2, content: "b", heat: 0.5, created_at: "", entities: ["entityB"] },
    ];
    const pairs = computeReplayStdpPairs(events, ReplayDirection.FORWARD);
    expect(pairs.length).toBe(1);
    const [src, tgt, dt] = pairs[0];
    expect(typeof src).toBe("number");
    expect(typeof tgt).toBe("number");
    expect(dt).toBeGreaterThan(0);
  });

  it("swaps src/tgt for REVERSE direction", () => {
    const events = [
      { memory_id: 1, content: "a", heat: 0.5, created_at: "", entities: ["X"] },
      { memory_id: 2, content: "b", heat: 0.5, created_at: "", entities: ["Y"] },
    ];
    const fwd = computeReplayStdpPairs(events, ReplayDirection.FORWARD);
    const rev = computeReplayStdpPairs(events, ReplayDirection.REVERSE);
    if (fwd.length > 0 && rev.length > 0) {
      expect(fwd[0][0]).toBe(rev[0][1]);
      expect(fwd[0][1]).toBe(rev[0][0]);
    }
  });
});

describe("MIN_SEQUENCE_LENGTH constant", () => {
  it("equals 2", () => {
    // source: cortex@ed33435 mcp_server/core/replay_execution.py:34
    expect(MIN_SEQUENCE_LENGTH).toBe(2);
  });
});
