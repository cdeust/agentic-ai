/**
 * Unit tests for sensory-buffer.ts
 * source: cortex@ed33435 mcp_server/core/sensory_buffer.py
 *
 * Updated to match the PR #65 API (push with no injected thermo —
 * importance computed from content heuristics).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  SensoryBuffer,
  getGlobalBuffer,
  resetGlobalBuffer,
} from "../../src/consolidation/sensory-buffer.js";

// ── Push ──────────────────────────────────────────────────────────────────

describe("SensoryBuffer.push", () => {
  it("buffers non-urgent items (neutral content, importance < 0.7)", () => {
    const buf = new SensoryBuffer(10, 0.7);
    // "hello world" has no urgency keywords → importance = 0.5 (base)
    const result = buf.push("hello world", {});
    expect(result.buffered).toBe(true);
    expect(result.isUrgent).toBe(false);
    expect(buf.size).toBe(1);
  });

  it("marks urgent items and does not buffer them (critical keyword → importance >= 0.7)", () => {
    const buf = new SensoryBuffer(10, 0.7);
    // "critical error" → base 0.5 + 0.2 (error) + 0.2 (critical tag not needed, keyword match) = 0.7+
    const result = buf.push("critical error occurred", {});
    expect(result.buffered).toBe(false);
    expect(result.isUrgent).toBe(true);
    expect(result.item).not.toBeNull();
    expect(buf.size).toBe(0);
  });

  it("displaces oldest item when buffer is full", () => {
    // threshold=1.0 so nothing is ever urgent; all items get buffered
    const buf = new SensoryBuffer(2, 1.0);
    buf.push("first", {});
    buf.push("second", {});
    buf.push("third", {}); // evicts "first"
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
    buf.push("a", {});
    buf.push("b", {});
    buf.push("c", {});
    const peeked = buf.peek(2);
    expect(peeked.length).toBe(2);
    expect(buf.size).toBe(3); // unchanged
  });
});

// ── Drain ─────────────────────────────────────────────────────────────────

describe("SensoryBuffer.drain", () => {
  it("returns items meeting min_importance and removes them from buffer", () => {
    const buf = new SensoryBuffer(10, 1.0);
    buf.push("a", {});
    buf.push("b", {});
    const drained = buf.drain(0.0);
    expect(drained.length).toBe(2);
    expect(buf.size).toBe(0);
  });

  it("drainAll empties buffer sorted importance desc", () => {
    const buf = new SensoryBuffer(10, 1.0);
    // "resolved successfully" → higher importance keyword (fixed/resolved)
    buf.push("low priority note", {});
    buf.push("resolved issue — important fix completed", {});
    const all = buf.drainAll();
    expect(all[0].importance).toBeGreaterThanOrEqual(all[1].importance);
    expect(buf.size).toBe(0);
  });
});

// ── Stats ─────────────────────────────────────────────────────────────────

describe("SensoryBuffer.stats", () => {
  it("returns correct size and fill_pct", () => {
    const buf = new SensoryBuffer(4, 1.0);
    buf.push("x", {});
    buf.push("y", {});
    const s = buf.stats();
    expect(s.size).toBe(2);
    expect(s.capacity).toBe(4);
    expect(s.fill_pct).toBe(50);
    // avg_importance is the heuristic base (0.5) for neutral content
    expect(typeof s.avg_importance).toBe("number");
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
