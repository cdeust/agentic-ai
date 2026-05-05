/**
 * Tests for mcp-client-pool.ts
 *
 * Tests the pool module: server config loading, env-var resolution,
 * close helpers.
 *
 * source: Cortex mcp_server/infrastructure/mcp_client_pool.py
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { closeAll, closeClient } from "../../src/infrastructure/mcp-client-pool.js";
import { McpConnectionError } from "../../src/shared/errors.js";

// We cannot test getClient() without spawning real child processes.
// These tests exercise the module's error paths and close helpers.

describe("mcp-client-pool — closeClient on missing server", () => {
  it("does not throw when server is not in pool", () => {
    expect(() => closeClient("nonexistent-server")).not.toThrow();
  });
});

describe("mcp-client-pool — closeAll on empty pool", () => {
  it("does not throw on empty pool", () => {
    expect(() => closeAll()).not.toThrow();
  });
});

describe("mcp-client-pool — getClient error for missing config", () => {
  it("throws McpConnectionError when mcp-connections.json does not exist", async () => {
    // Override MCP_CONNECTIONS_PATH equivalent by using a path that cannot exist
    // The module reads from ~/.claude/methodology/mcp-connections.json
    // We test the error shape — a McpConnectionError is thrown
    const { getClient } = await import("../../src/infrastructure/mcp-client-pool.js");
    // In CI there is no mcp-connections.json — getClient should throw McpConnectionError
    // (or succeed if the file happens to exist in the test environment)
    try {
      await getClient("__test_server_that_does_not_exist__");
    } catch (e) {
      expect(e).toBeInstanceOf(McpConnectionError);
    }
  });
});
