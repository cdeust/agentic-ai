/**
 * Unit tests for latency-class.ts
 * source: cortex@ed33435 mcp_server/handlers/latency_class.py
 */

import { describe, it, expect } from "vitest";
import { classify, allRegisteredTools, DEFAULT_SEMAPHORE } from "../../src/shared/latency-class.js";

describe("classify — explicit registry", () => {
  it("recall is interactive", () => {
    expect(classify("recall")).toBe("interactive");
  });

  it("consolidate is batch", () => {
    expect(classify("consolidate")).toBe("batch");
  });

  it("import_sessions is batch", () => {
    expect(classify("import_sessions")).toBe("batch");
  });

  it("wiki_read is interactive", () => {
    expect(classify("wiki_read")).toBe("interactive");
  });
});

describe("classify — heuristic fallback", () => {
  it("unknown_ingest_tool is batch via heuristic", () => {
    expect(classify("unknown_ingest_tool")).toBe("batch");
  });

  it("custom_recall_v2 is interactive via heuristic", () => {
    expect(classify("custom_recall_v2")).toBe("interactive");
  });

  it("pipeline_runner is batch via heuristic", () => {
    expect(classify("pipeline_runner")).toBe("batch");
  });
});

describe("allRegisteredTools", () => {
  it("returns sorted list with known tools", () => {
    const tools = allRegisteredTools();
    expect(tools).toContain("recall");
    expect(tools).toContain("consolidate");
    // sorted
    expect(tools).toEqual([...tools].sort());
  });
});

describe("DEFAULT_SEMAPHORE", () => {
  it("interactive=4, batch=1", () => {
    // source: cortex@ed33435 mcp_server/handlers/latency_class.py:85
    expect(DEFAULT_SEMAPHORE.interactive).toBe(4);
    expect(DEFAULT_SEMAPHORE.batch).toBe(1);
  });
});
