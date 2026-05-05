/**
 * Unit tests for sensory-buffer.ts
 * source: cortex@ed33435 mcp_server/core/sensory_buffer.py
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  SensoryBuffer,
  getGlobalBuffer,
  resetGlobalBuffer,
} from "../../src/consolidation/sensory-buffer.js";
import type { ThermodynamicsCompute } from "../../src/consolidation/sensory-buffer.js";

const mockThermo: ThermodynamicsCompute = {
  computeImportance: (_content: string, _tags: string[]) => 0.5,
  computeValence: (_content: string) => 0.1,
};

const urgentThermo: ThermodynamicsCompute = {
  computeImportance: (_content: string, _tags: string[]) => 0.9, // >= 0.7 threshold
  computeValence: (_content: string) => 0.0,
};

// ── Push ──────────────────────────────────────────────────────────────────

describe("SensoryBuffer.push", () => {
  it("buffers non-urgent items", () => {
    const buf = new SensoryBuffer(10, 0.7);
    const result = buf.push("hello world", {}, mockThermo);
    expect(result.buffered).toBe(true);
    expect(result.is_urgent).toBe(false);
    expect(buf.size).toBe(1);
  });

  it("marks urgent items and does not buffer them", () => {
    const buf = new SensoryBuffer(10, 0.7);
    const result = buf.push("critical alert", {}, urgentThermo);
    expect(result.buffered).toBe(false);
    expect(result.is_urgent).toBe(true);
    expect(result.item).not.toBeNull();
    expect(buf.size).toBe(0);
  });

  it("displaces oldest item when buffer is full", () => {
    const buf = new SensoryBuffer(2, 1.0); // threshold=1.0 so nothing is urgent
    buf.push("first", {}, mockThermo);
    buf.push("second", {}, mockThermo);
    buf.push("third", {}, mockThermo); // evicts "first"
    expect(buf.size).toBe(2);
    const displaced = buf.drainDisplaced();
    expect(displaced.length).toBe(1);
    expect(displaced[0].content).toBe("first");
  });
});

// ── Peek ──────────────────────────────────────────────────────────────────

describe("SensoryBuffer.peek", () => {
  it("returns last n items without removing them", () => {
    const buf = new SensoryBuffer(10, 1.0);
    buf.push("a", {}, mockThermo);
    buf.push("b", {}, mockThermo);
    buf.push("c", {}, mockThermo);
    const peeked = buf.peek(2);
    expect(peeked.length).toBe(2);
    expect(buf.size).toBe(3); // unchanged
  });
});

// ── Drain ─────────────────────────────────────────────────────────────────

describe("SensoryBuffer.drain", () => {
  it("returns items meeting min_importance and removes them from buffer", () => {
    const buf = new SensoryBuffer(10, 1.0);
    // importance=0.5 for all via mockThermo
    buf.push("a", {}, mockThermo);
    buf.push("b", {}, mockThermo);
    const drained = buf.drain(0.0);
    expect(drained.length).toBe(2);
    expect(buf.size).toBe(0);
  });

  it("drain_all empties buffer sorted importance desc", () => {
    const buf = new SensoryBuffer(10, 1.0);
    const thermo1: ThermodynamicsCompute = {
      computeImportance: () => 0.3,
      computeValence: () => 0,
    };
    const thermo2: ThermodynamicsCompute = {
      computeImportance: () => 0.8,
      computeValence: () => 0,
    };
    buf.push("low", {}, thermo1);
    buf.push("high", {}, thermo2);
    const all = buf.drainAll();
    expect(all[0].importance).toBeGreaterThanOrEqual(all[1].importance);
    expect(buf.size).toBe(0);
  });
});

// ── Stats ─────────────────────────────────────────────────────────────────

describe("SensoryBuffer.stats", () => {
  it("returns correct size and fill_pct", () => {
    const buf = new SensoryBuffer(4, 1.0);
    buf.push("x", {}, mockThermo);
    buf.push("y", {}, mockThermo);
    const s = buf.stats();
    expect(s.size).toBe(2);
    expect(s.capacity).toBe(4);
    expect(s.fill_pct).toBe(50);
    expect(s.avg_importance).toBeCloseTo(0.5);
  });
});

// ── Global singleton ──────────────────────────────────────────────────────

describe("getGlobalBuffer / resetGlobalBuffer", () => {
  beforeEach(() => resetGlobalBuffer());

  it("returns the same instance on repeated calls", () => {
    const a = getGlobalBuffer();
    const b = getGlobalBuffer();
    expect(a).toBe(b);
  });

  it("reset creates a new instance", () => {
    const a = getGlobalBuffer();
    resetGlobalBuffer();
    const b = getGlobalBuffer();
    expect(a).not.toBe(b);
  });
});
