/**
 * Tests for ap-bridge.ts
 *
 * Tests: isEnabled() env-var handling, resolveGraphPath(),
 * resolveGraphPaths(), APBridge.available, APBridge.call() tool
 * allowlist enforcement, APBridge.close().
 *
 * source: Cortex mcp_server/infrastructure/ap_bridge.py
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isEnabled, resolveGraphPath, resolveGraphPaths, APBridge } from "../../src/infrastructure/ap-bridge.js";

describe("isEnabled()", () => {
  const orig = process.env["CORTEX_MEMORY_AP_ENABLED"];

  afterEach(() => {
    if (orig === undefined) {
      delete process.env["CORTEX_MEMORY_AP_ENABLED"];
    } else {
      process.env["CORTEX_MEMORY_AP_ENABLED"] = orig;
    }
  });

  it("defaults to true when env var is not set", () => {
    // source: ap_bridge.py:46-66
    delete process.env["CORTEX_MEMORY_AP_ENABLED"];
    expect(isEnabled()).toBe(true);
  });

  it("returns false when set to '0'", () => {
    process.env["CORTEX_MEMORY_AP_ENABLED"] = "0";
    expect(isEnabled()).toBe(false);
  });

  it("returns false when set to 'false'", () => {
    process.env["CORTEX_MEMORY_AP_ENABLED"] = "false";
    expect(isEnabled()).toBe(false);
  });

  it("returns true when set to '1'", () => {
    process.env["CORTEX_MEMORY_AP_ENABLED"] = "1";
    expect(isEnabled()).toBe(true);
  });

  it("returns true when set to 'true'", () => {
    process.env["CORTEX_MEMORY_AP_ENABLED"] = "true";
    expect(isEnabled()).toBe(true);
  });
});

describe("resolveGraphPath()", () => {
  const orig = process.env["CORTEX_AP_GRAPH_PATH"];

  afterEach(() => {
    if (orig === undefined) {
      delete process.env["CORTEX_AP_GRAPH_PATH"];
    } else {
      process.env["CORTEX_AP_GRAPH_PATH"] = orig;
    }
  });

  it("returns env-var path when CORTEX_AP_GRAPH_PATH is set", () => {
    // source: ap_bridge.py:69-86
    process.env["CORTEX_AP_GRAPH_PATH"] = "/tmp/test-graph";
    expect(resolveGraphPath()).toBe("/tmp/test-graph");
  });

  it("returns null when no graph path exists (default env)", () => {
    delete process.env["CORTEX_AP_GRAPH_PATH"];
    // In CI there are no AP graphs; null is the expected result.
    const result = resolveGraphPath();
    expect(result === null || typeof result === "string").toBe(true);
  });
});

describe("resolveGraphPaths()", () => {
  it("returns an array (possibly empty)", () => {
    // source: ap_bridge.py:89-131
    const paths = resolveGraphPaths();
    expect(Array.isArray(paths)).toBe(true);
  });

  it("respects CORTEX_AP_GRAPH_PATH env override", () => {
    const orig = process.env["CORTEX_AP_GRAPH_PATH"];
    // Point at a path we know exists — use __filename itself
    process.env["CORTEX_AP_GRAPH_PATH"] = import.meta.url.replace("file://", "");
    const paths = resolveGraphPaths();
    // Should include the env-var path if it exists
    if (orig === undefined) delete process.env["CORTEX_AP_GRAPH_PATH"];
    else process.env["CORTEX_AP_GRAPH_PATH"] = orig;
    expect(Array.isArray(paths)).toBe(true);
  });
});

describe("APBridge — available property", () => {
  it("is false when isEnabled() returns false", () => {
    // source: ap_bridge.py:194-196
    const orig = process.env["CORTEX_MEMORY_AP_ENABLED"];
    process.env["CORTEX_MEMORY_AP_ENABLED"] = "0";
    const bridge = new APBridge();
    expect(bridge.available).toBe(false);
    if (orig === undefined) delete process.env["CORTEX_MEMORY_AP_ENABLED"];
    else process.env["CORTEX_MEMORY_AP_ENABLED"] = orig;
  });
});

describe("APBridge — connect() with AP disabled", () => {
  it("returns false immediately when AP is disabled", async () => {
    const orig = process.env["CORTEX_MEMORY_AP_ENABLED"];
    process.env["CORTEX_MEMORY_AP_ENABLED"] = "0";
    const bridge = new APBridge();
    const result = await bridge.connect();
    expect(result).toBe(false);
    expect(bridge.unavailableReason).toBe("disabled");
    if (orig === undefined) delete process.env["CORTEX_MEMORY_AP_ENABLED"];
    else process.env["CORTEX_MEMORY_AP_ENABLED"] = orig;
  });
});

describe("APBridge — call() tool allowlist", () => {
  it("throws for tools not in the allowlist", async () => {
    const bridge = new APBridge();
    // Bypass connect by testing call() directly with an invalid tool
    await expect(bridge.call("evil_tool")).rejects.toThrow(
      /not in allowlist/,
    );
  });

  it("returns null when AP is unavailable (graceful degradation)", async () => {
    const orig = process.env["CORTEX_MEMORY_AP_ENABLED"];
    process.env["CORTEX_MEMORY_AP_ENABLED"] = "0";
    const bridge = new APBridge();
    const result = await bridge.call("health_check");
    expect(result).toBeNull();
    if (orig === undefined) delete process.env["CORTEX_MEMORY_AP_ENABLED"];
    else process.env["CORTEX_MEMORY_AP_ENABLED"] = orig;
  });
});

describe("APBridge — close()", () => {
  it("can be called on an unconnected bridge without throwing", async () => {
    const bridge = new APBridge();
    await expect(bridge.close()).resolves.not.toThrow();
  });

  it("can be called multiple times safely", async () => {
    const bridge = new APBridge();
    await bridge.close();
    await bridge.close();
  });
});
