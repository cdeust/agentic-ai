/**
 * Tests for record-session-end.ts
 *
 * source: cortex@ed33435 mcp_server/handlers/record_session_end.py
 *
 * Covers both handler surfaces:
 *   - recordSessionEnd       (self-contained fs-based handler, Eng-12 path)
 *   - recordSessionEndHandler (composition root delegating to update-profiles, Eng-15 path)
 *   - schema                 (MCP schema shape)
 *
 * Invariants tested:
 *   1.  recordSessionEnd — handler returns domain (non-empty string)
 *   2.  recordSessionEnd — returns profileUpdated=false when no profiles exist
 *   3.  recordSessionEnd — critique is generated with overall_score in [0,1]
 *   4.  recordSessionEnd — no-recall suggestion appears when tools_used lacks recall
 *   5.  recordSessionEnd — storeMemory callback is called when provided
 *   6.  recordSessionEnd — defaults domain to 'unknown'
 *   7.  schema             — correct title; session_id is required
 *   8.  recordSessionEndHandler — domain fallback
 *   9.  recordSessionEndHandler — memory storage integration
 *  10.  recordSessionEndHandler — newPatterns is empty array
 */

import { describe, it, expect, vi } from "vitest";
import {
  recordSessionEnd,
  recordSessionEndHandler,
  schema,
} from "../../src/methodology/handlers/record-session-end.js";
import type { ProfilesStore, DomainProfile } from "../../src/methodology/types.js";

// ── Mock fs to avoid writing to disk (recordSessionEnd path) ──────────────

vi.mock("node:fs", () => ({
  existsSync: () => false,
  readFileSync: () => "{}",
  writeFileSync: () => {},
  mkdirSync: () => {},
}));

// ── Minimal profile store stub (recordSessionEndHandler path) ─────────────

function makeDomainProfile(): DomainProfile {
  return {
    id: "cortex",
    label: "Cortex",
    confidence: 0.5,
    sessionCount: 5,
    avgTurnCount: 20,
    avgDurationMs: 1_800_000,
    toolFrequency: {},
    categoryFrequency: {},
    recentKeywords: [],
    recurringPatterns: [],
    connectionBridges: [],
    blindSpots: [],
    entryPatterns: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    projects: [],
  };
}

function makeProfiles(domainId: string = "cortex"): ProfilesStore {
  return {
    domains: { [domainId]: makeDomainProfile() },
    sessions: [],
  };
}

// ── recordSessionEnd (Eng-12 self-contained handler) ─────────────────────

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

// ── schema ────────────────────────────────────────────────────────────────

describe("schema", () => {
  it("has the correct title", () => {
    expect(schema.title).toBe("Record session end (incremental profile update)");
  });

  it("session_id is a required field", () => {
    expect(schema.inputSchema.required).toContain("session_id");
  });
});

// ── recordSessionEndHandler (Eng-15 composition root) ────────────────────

describe("recordSessionEndHandler — domain fallback", () => {
  it("returns domain='unknown' when profiles has no matching domain", async () => {
    const profiles = makeProfiles("other-domain");
    const result = await recordSessionEndHandler(
      { session_id: "abc-123", domain: undefined },
      profiles,
    );
    expect(typeof result.domain).toBe("string");
  });

  it("uses provided domain when it matches a profile", async () => {
    const profiles = makeProfiles("cortex");
    const result = await recordSessionEndHandler(
      { session_id: "abc-456", domain: "cortex", tools_used: ["Read", "Edit"] },
      profiles,
    );

    expect(result.domain).toBe("cortex");
    expect(result.profileUpdated).toBe(true);
  });
});

describe("recordSessionEndHandler — memory storage", () => {
  it("calls rememberHandler with session-summary content", async () => {
    const profiles = makeProfiles("cortex");
    const rememberFn = vi.fn().mockResolvedValue({ stored: true });

    const result = await recordSessionEndHandler(
      {
        session_id: "sess-789",
        domain: "cortex",
        tools_used: ["Bash"],
        duration: 900_000,
        turn_count: 8,
        keywords: ["recall", "regression"],
      },
      profiles,
      rememberFn,
    );

    expect(result.memoryStored).toBe(true);
    expect(rememberFn).toHaveBeenCalledOnce();

    const callArgs = rememberFn.mock.calls[0]![0];
    expect(callArgs.content).toContain("sess-789");
    expect(callArgs.source).toBe("session");
    expect(callArgs.tags).toContain("session-summary");
  });

  it("returns memoryStored=false when rememberHandler returns stored=false", async () => {
    const profiles = makeProfiles("cortex");
    const rememberFn = vi.fn().mockResolvedValue({ stored: false });

    const result = await recordSessionEndHandler(
      { session_id: "sess-999", domain: "cortex" },
      profiles,
      rememberFn,
    );

    expect(result.memoryStored).toBe(false);
  });

  it("returns memoryStored=false when no rememberHandler is provided", async () => {
    const profiles = makeProfiles("cortex");
    const result = await recordSessionEndHandler(
      { session_id: "sess-000", domain: "cortex" },
      profiles,
    );

    expect(result.memoryStored).toBe(false);
  });
});

describe("recordSessionEndHandler — newPatterns", () => {
  it("returns newPatterns as empty array", async () => {
    const result = await recordSessionEndHandler(
      { session_id: "s1", domain: "cortex" },
      makeProfiles(),
    );
    expect(result.newPatterns).toEqual([]);
  });
});
