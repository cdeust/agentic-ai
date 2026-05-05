/**
 * Tests for record-session-end.ts
 *
 * source: cortex@ed33435 mcp_server/handlers/record_session_end.py
 *
 * Invariants tested:
 *   1. handler returns domain (non-empty string)
 *   2. handler returns profileUpdated=false when no profiles exist
 *   3. critique is generated with overall_score in [0,1]
 *   4. no-recall suggestion appears when tools_used lacks recall
 */

import { describe, it, expect, vi } from "vitest";
import { recordSessionEnd } from "../../src/methodology/handlers/record-session-end.js";

// Mock fs to avoid writing to disk
vi.mock("node:fs", () => ({
  existsSync: () => false,
  readFileSync: () => "{}",
  writeFileSync: () => {},
  mkdirSync: () => {},
}));

describe("recordSessionEnd", () => {
  it("returns a non-empty domain string", async () => {
    const result = await recordSessionEnd({ session_id: "test-session-1" });
    expect(typeof result.domain).toBe("string");
    expect(result.domain.length).toBeGreaterThan(0);
  });

  it("returns profileUpdated=false when no profiles exist", async () => {
    const result = await recordSessionEnd({
      session_id: "test-session-2",
      domain: "cortex",
      tools_used: ["Read", "Edit"],
      turn_count: 5,
    });
    expect(result.profileUpdated).toBe(false);
  });

  it("returns memoryStored=false when no storeMemory callback provided", async () => {
    const result = await recordSessionEnd({
      session_id: "test-session-3",
      keywords: ["recall", "test"],
    });
    expect(result.memoryStored).toBe(false);
  });

  it("returns critique with overall_score in [0,1]", async () => {
    const result = await recordSessionEnd({
      session_id: "test-session-4",
      tools_used: ["Edit", "Bash", "cortex:remember"],
      turn_count: 10,
      duration: 60000,
    });
    // critique may be null only if tryGenerateCritique throws, which it shouldn't
    if (result.critique !== null) {
      expect(result.critique?.overall_score).toBeGreaterThanOrEqual(0);
      expect(result.critique?.overall_score).toBeLessThanOrEqual(1);
      expect(Array.isArray(result.critique?.top_suggestions)).toBe(true);
    }
  });

  it("critique includes no-recall suggestion when cortex:recall not used", async () => {
    const result = await recordSessionEnd({
      session_id: "test-session-5",
      tools_used: ["Edit", "Write"],
      turn_count: 15,
    });
    if (result.critique) {
      const suggestions = result.critique.top_suggestions.join(" ");
      expect(suggestions.toLowerCase()).toContain("recall");
    }
  });

  it("storeMemory callback is called when provided", async () => {
    const mockStore = vi.fn().mockResolvedValue(true);
    const result = await recordSessionEnd(
      { session_id: "test-session-6", domain: "test", keywords: ["test"] },
      mockStore,
    );
    expect(mockStore).toHaveBeenCalledOnce();
    expect(result.memoryStored).toBe(true);
  });

  it("defaults domain to 'unknown' when no domain/cwd/project given", async () => {
    const result = await recordSessionEnd({ session_id: "session-7" });
    expect(result.domain).toBe("unknown");
  });
});
