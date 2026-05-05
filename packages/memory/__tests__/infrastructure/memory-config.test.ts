/**
 * Unit tests for infrastructure/memory-config.ts
 *
 * Invariants:
 *   - getMemorySettings() returns the same object on every call (singleton)
 *   - All defaults match the Python source constants exactly
 *   - CORTEX_MEMORY_ env prefix overrides defaults
 *
 * source: Cortex mcp_server/infrastructure/memory_config.py:MemorySettings
 */

import { describe, it, expect, afterEach } from "vitest";

import {
  getMemorySettings,
  _resetMemorySettings,
} from "../../src/infrastructure/memory-config.js";

afterEach(() => {
  _resetMemorySettings();
});

describe("getMemorySettings — singleton", () => {
  it("returns the same reference on repeated calls", () => {
    const a = getMemorySettings();
    const b = getMemorySettings();
    expect(a).toBe(b);
  });
});

describe("getMemorySettings — defaults", () => {
  it("DECAY_FACTOR defaults to 0.95", () => {
    // source: Cortex mcp_server/infrastructure/memory_config.py — DECAY_FACTOR = 0.95
    expect(getMemorySettings().DECAY_FACTOR).toBe(0.95);
  });

  it("COLD_THRESHOLD defaults to 0.05", () => {
    // source: Cortex mcp_server/infrastructure/memory_config.py — COLD_THRESHOLD = 0.05
    expect(getMemorySettings().COLD_THRESHOLD).toBe(0.05);
  });

  it("HOT_THRESHOLD defaults to 0.7", () => {
    // source: Cortex mcp_server/infrastructure/memory_config.py — HOT_THRESHOLD = 0.7
    expect(getMemorySettings().HOT_THRESHOLD).toBe(0.7);
  });

  it("EMBEDDING_DIM defaults to 384", () => {
    // source: Cortex mcp_server/infrastructure/memory_config.py — EMBEDDING_DIM = 384
    expect(getMemorySettings().EMBEDDING_DIM).toBe(384);
  });

  it("EMBEDDING_DEVICE defaults to cpu", () => {
    // source: Cortex mcp_server/infrastructure/memory_config.py — EMBEDDING_DEVICE = "cpu"
    expect(getMemorySettings().EMBEDDING_DEVICE).toBe("cpu");
  });

  it("WRRF_K defaults to 60", () => {
    // source: Cortex mcp_server/infrastructure/memory_config.py — WRRF_K = 60
    expect(getMemorySettings().WRRF_K).toBe(60);
  });

  it("POOL_INTERACTIVE_MAX defaults to 8", () => {
    // source: Cortex mcp_server/infrastructure/memory_config.py — POOL_INTERACTIVE_MAX = 8
    expect(getMemorySettings().POOL_INTERACTIVE_MAX).toBe(8);
  });

  it("POOL_BATCH_TIMEOUT_S defaults to 1800.0", () => {
    // source: Cortex mcp_server/infrastructure/memory_config.py — POOL_BATCH_TIMEOUT_S = 1800.0
    expect(getMemorySettings().POOL_BATCH_TIMEOUT_S).toBe(1800.0);
  });

  it("AP_ENABLED defaults to true", () => {
    // source: Cortex mcp_server/infrastructure/memory_config.py — AP_ENABLED = True
    expect(getMemorySettings().AP_ENABLED).toBe(true);
  });

  it("COMPRESSION_GIST_AGE_HOURS defaults to 168 (7 days)", () => {
    // source: Cortex mcp_server/infrastructure/memory_config.py — COMPRESSION_GIST_AGE_HOURS = 168.0
    expect(getMemorySettings().COMPRESSION_GIST_AGE_HOURS).toBe(168.0);
  });

  it("COMPRESSION_TAG_AGE_HOURS defaults to 720 (30 days)", () => {
    // source: Cortex mcp_server/infrastructure/memory_config.py — COMPRESSION_TAG_AGE_HOURS = 720.0
    expect(getMemorySettings().COMPRESSION_TAG_AGE_HOURS).toBe(720.0);
  });
});

describe("getMemorySettings — env override", () => {
  it("CORTEX_MEMORY_EMBEDDING_DIM overrides EMBEDDING_DIM", () => {
    process.env["CORTEX_MEMORY_EMBEDDING_DIM"] = "768";
    try {
      expect(getMemorySettings().EMBEDDING_DIM).toBe(768);
    } finally {
      delete process.env["CORTEX_MEMORY_EMBEDDING_DIM"];
    }
  });

  it("CORTEX_MEMORY_AP_ENABLED=false disables AP", () => {
    process.env["CORTEX_MEMORY_AP_ENABLED"] = "false";
    try {
      expect(getMemorySettings().AP_ENABLED).toBe(false);
    } finally {
      delete process.env["CORTEX_MEMORY_AP_ENABLED"];
    }
  });
});
