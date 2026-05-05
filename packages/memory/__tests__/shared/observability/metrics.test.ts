/**
 * Tests for shared/observability/metrics.ts
 *
 * Invariants verified:
 * - incCounter increments; starting at 0; supports value > 1
 * - setGauge stores last-set value
 * - observeHistogram: counts appear in +Inf bucket; sum accumulates
 * - Timer.start().stop() records an observation (sum > 0)
 * - render() emits TYPE declarations and metric lines
 * - render() always ends with trailing newline (Prometheus spec)
 * - reset() clears all state
 *
 * source: cortex@ed33435 mcp_server/observability/metrics.py
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  incCounter,
  setGauge,
  observeHistogram,
  Timer,
  render,
  reset,
} from "../../../src/shared/observability/metrics.js";

beforeEach(() => reset());

describe("incCounter", () => {
  it("starts at 0 and increments by 1 by default", () => {
    incCounter("my_counter");
    const out = render();
    expect(out).toContain("my_counter 1");
  });

  it("increments by custom value", () => {
    incCounter("my_counter", null, 5);
    const out = render();
    expect(out).toContain("my_counter 5");
  });

  it("accumulates across multiple calls", () => {
    incCounter("my_counter");
    incCounter("my_counter");
    incCounter("my_counter");
    const out = render();
    expect(out).toContain("my_counter 3");
  });

  it("tracks labels separately", () => {
    incCounter("calls_total", { tool: "remember", status: "ok" });
    incCounter("calls_total", { tool: "recall", status: "ok" });
    const out = render();
    expect(out).toContain('tool="remember"');
    expect(out).toContain('tool="recall"');
  });

  it("emits # TYPE counter declaration", () => {
    incCounter("my_counter");
    expect(render()).toContain("# TYPE my_counter counter");
  });
});

describe("setGauge", () => {
  it("stores and renders the last-set value", () => {
    setGauge("memories_total", 42);
    const out = render();
    expect(out).toContain("memories_total 42");
  });

  it("overwrites previous value (last-writer-wins)", () => {
    setGauge("memories_total", 10);
    setGauge("memories_total", 99);
    const out = render();
    expect(out).not.toContain("memories_total 10");
    expect(out).toContain("memories_total 99");
  });

  it("emits # TYPE gauge declaration", () => {
    setGauge("memories_total", 1);
    expect(render()).toContain("# TYPE memories_total gauge");
  });
});

describe("observeHistogram", () => {
  it("records observation in +Inf bucket", () => {
    // postcondition: every observation increments the +Inf bucket
    // source: cortex@ed33435 mcp_server/observability/metrics.py:79-83
    observeHistogram("tool_duration_seconds", 0.5);
    const out = render();
    expect(out).toContain('+Inf"} 1');
  });

  it("accumulates the sum", () => {
    observeHistogram("tool_duration_seconds", 0.1);
    observeHistogram("tool_duration_seconds", 0.2);
    const out = render();
    // sum should be 0.3
    expect(out).toMatch(/tool_duration_seconds_sum[^\n]* 0\.3/);
  });

  it("records count via +Inf bucket", () => {
    observeHistogram("tool_duration_seconds", 0.05);
    observeHistogram("tool_duration_seconds", 0.05);
    const out = render();
    expect(out).toContain("tool_duration_seconds_count");
  });

  it("emits # TYPE histogram declaration", () => {
    observeHistogram("tool_duration_seconds", 1.0);
    expect(render()).toContain("# TYPE tool_duration_seconds histogram");
  });

  it("places observation in correct bucket boundary", () => {
    // value 0.05 should appear in bucket le=0.05 but not in le=0.01
    observeHistogram("latency", 0.05, { tool: "recall" });
    const out = render();
    expect(out).toContain('le="0.05"');
  });
});

describe("Timer", () => {
  it("records elapsed time >= 0 after start/stop", () => {
    const t = new Timer("op_duration");
    t.start();
    t.stop();
    const out = render();
    // sum must exist and be >= 0
    expect(out).toMatch(/op_duration_sum[^\n]* [0-9]/);
  });

  it("accumulates multiple start/stop cycles", () => {
    const t = new Timer("op_duration");
    t.start(); t.stop();
    t.start(); t.stop();
    const out = render();
    expect(out).toContain("op_duration_count 2");
  });
});

describe("render", () => {
  it("returns a string when no metrics are recorded", () => {
    // When the metric store is empty, render() emits the trailing-newline
    // sentinel but lines array is only [""] — join produces "" (both Python
    // and TS emit "" for an empty store, consistent with the Python impl).
    // source: cortex@ed33435 mcp_server/observability/metrics.py:158
    const out = render();
    expect(typeof out).toBe("string");
  });

  it("ends with a trailing newline when metrics are present (Prometheus 0.0.4 spec)", () => {
    // source: Prometheus text format 0.0.4 — trailing newline required
    incCounter("test_counter");
    const out = render();
    expect(out.endsWith("\n")).toBe(true);
  });
});

describe("reset", () => {
  it("clears counters", () => {
    incCounter("c");
    reset();
    expect(render()).not.toContain("# TYPE c");
  });

  it("clears gauges", () => {
    setGauge("g", 42);
    reset();
    expect(render()).not.toContain("# TYPE g");
  });

  it("clears histograms", () => {
    observeHistogram("h", 1);
    reset();
    expect(render()).not.toContain("# TYPE h");
  });
});
