/**
 * Unit tests for infrastructure/pipeline-graph-ttl.ts
 *
 * Invariants:
 *   - graphIsStale returns true for null / empty path
 *   - graphIsStale returns true for missing file
 *   - graphIsStale returns false for freshly written file (age ≈ 0 < 24h TTL)
 *   - graphTtlHours respects CORTEX_PIPELINE_GRAPH_TTL_HOURS env var
 *
 * source: Cortex mcp_server/infrastructure/pipeline_graph_ttl.py
 */

import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  graphTtlHours,
  graphIsStale,
} from "../../src/infrastructure/pipeline-graph-ttl.js";

afterEach(() => {
  delete process.env["CORTEX_PIPELINE_GRAPH_TTL_HOURS"];
});

describe("graphTtlHours", () => {
  it("defaults to 24", () => {
    // source: Cortex mcp_server/infrastructure/pipeline_graph_ttl.py — _DEFAULT_TTL_HOURS = 24.0
    expect(graphTtlHours()).toBe(24.0);
  });

  it("reads from env var", () => {
    process.env["CORTEX_PIPELINE_GRAPH_TTL_HOURS"] = "48";
    expect(graphTtlHours()).toBe(48.0);
  });

  it("clamps negative to 0", () => {
    process.env["CORTEX_PIPELINE_GRAPH_TTL_HOURS"] = "-5";
    expect(graphTtlHours()).toBe(0.0);
  });

  it("falls back to default for invalid value", () => {
    process.env["CORTEX_PIPELINE_GRAPH_TTL_HOURS"] = "not-a-number";
    expect(graphTtlHours()).toBe(24.0);
  });
});

describe("graphIsStale", () => {
  it("returns true for null", () => {
    expect(graphIsStale(null)).toBe(true);
  });

  it("returns true for empty string", () => {
    expect(graphIsStale("")).toBe(true);
  });

  it("returns true for missing file", () => {
    expect(graphIsStale("/no/such/graph.ladybug")).toBe(true);
  });

  it("returns false for a freshly written file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ttl-test-"));
    const p = path.join(dir, "graph.ladybug");
    fs.writeFileSync(p, "data");
    try {
      // Age ≈ 0 seconds — well below default 24h TTL
      expect(graphIsStale(p)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true });
    }
  });
});
