/**
 * Trigger-matcher tests — pattern + event → matched / unmatched.
 *
 * source: mcp_server/core/prospective.py (parity tests)
 * source: Einstein, G. O. & McDaniel, M. A. (2005). "Prospective memory:
 *   Multiple retrieval processes." Current Directions in Psychological
 *   Science, 14(6), 286–290.
 */

import { describe, expect, it } from "vitest";

import {
  checkTrigger,
  extractProspectiveIntents,
  matchTriggers,
} from "../../src/automation/trigger-matcher.js";
import type { Trigger, TriggerContext } from "../../src/automation/types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const makeTrigger = (overrides: Partial<Trigger>): Trigger => ({
  content: "test reminder",
  trigger_condition: "cortex",
  trigger_type: "keyword",
  is_active: true,
  triggered_count: 0,
  ...overrides,
});

const makeContext = (overrides: Partial<TriggerContext>): TriggerContext => ({
  directory: "",
  content: "",
  entities: [],
  ...overrides,
});

// ── checkTrigger — keyword ────────────────────────────────────────────────────

describe("checkTrigger / keyword", () => {
  it("fires when content contains the keyword", () => {
    const t = makeTrigger({ trigger_type: "keyword", trigger_condition: "cortex" });
    expect(checkTrigger(t, makeContext({ content: "working on cortex today" }))).toBe(true);
  });

  it("does not fire when keyword absent", () => {
    const t = makeTrigger({ trigger_type: "keyword", trigger_condition: "cortex" });
    expect(checkTrigger(t, makeContext({ content: "working on something else" }))).toBe(false);
  });

  it("matches any keyword in space-separated condition", () => {
    const t = makeTrigger({ trigger_type: "keyword", trigger_condition: "cortex recall" });
    expect(checkTrigger(t, makeContext({ content: "today I worked on recall" }))).toBe(true);
  });
});

// ── checkTrigger — keyword_match ──────────────────────────────────────────────

describe("checkTrigger / keyword_match", () => {
  it("fires on content match", () => {
    const t = makeTrigger({
      trigger_type: "keyword_match",
      trigger_condition: "pg_recall",
    });
    expect(
      checkTrigger(t, makeContext({ content: "editing pg_recall.py" })),
    ).toBe(true);
  });

  it("is case-insensitive", () => {
    const t = makeTrigger({
      trigger_type: "keyword_match",
      trigger_condition: "PG_RECALL",
    });
    expect(
      checkTrigger(t, makeContext({ content: "editing pg_recall.py" })),
    ).toBe(true);
  });
});

// ── checkTrigger — directory_match ────────────────────────────────────────────

describe("checkTrigger / directory_match", () => {
  it("fires when directory contains the target", () => {
    const t = makeTrigger({
      trigger_type: "directory_match",
      trigger_condition: "/code/cortex",
    });
    expect(
      checkTrigger(t, makeContext({ directory: "/home/user/code/cortex/src" })),
    ).toBe(true);
  });

  it("uses target_directory over condition when present", () => {
    const t = makeTrigger({
      trigger_type: "directory_match",
      trigger_condition: "ignored",
      target_directory: "/code/cortex",
    });
    expect(
      checkTrigger(t, makeContext({ directory: "/home/user/code/cortex" })),
    ).toBe(true);
  });

  it("does not fire on directory mismatch", () => {
    const t = makeTrigger({
      trigger_type: "directory_match",
      trigger_condition: "/code/other-project",
    });
    expect(
      checkTrigger(t, makeContext({ directory: "/code/cortex" })),
    ).toBe(false);
  });
});

// ── checkTrigger — entity_match ───────────────────────────────────────────────

describe("checkTrigger / entity_match", () => {
  it("fires when entity is in the context list", () => {
    const t = makeTrigger({
      trigger_type: "entity_match",
      trigger_condition: "Alice",
    });
    expect(
      checkTrigger(t, makeContext({ entities: ["alice", "bob"] })),
    ).toBe(true);
  });

  it("does not fire when entity absent", () => {
    const t = makeTrigger({
      trigger_type: "entity_match",
      trigger_condition: "Charlie",
    });
    expect(
      checkTrigger(t, makeContext({ entities: ["alice", "bob"] })),
    ).toBe(false);
  });
});

// ── checkTrigger — time_based ─────────────────────────────────────────────────

describe("checkTrigger / time_based", () => {
  it("fires when current time matches HH:MM", () => {
    const t = makeTrigger({
      trigger_type: "time_based",
      trigger_condition: "14:30",
    });
    // 2026-04-26T14:30:00Z
    expect(
      checkTrigger(t, makeContext({ current_time: "2026-04-26T14:30:00.000Z" })),
    ).toBe(true);
  });

  it("does not fire at different time", () => {
    const t = makeTrigger({
      trigger_type: "time_based",
      trigger_condition: "14:30",
    });
    expect(
      checkTrigger(t, makeContext({ current_time: "2026-04-26T09:00:00.000Z" })),
    ).toBe(false);
  });

  it("fires on weekday match (weekday:6 = Sunday in Python)", () => {
    const t = makeTrigger({
      trigger_type: "time_based",
      trigger_condition: "weekday:6",
    });
    // 2026-04-26 is a Sunday (JS getDay()=0 → Python weekday()=6)
    expect(
      checkTrigger(t, makeContext({ current_time: "2026-04-26T10:00:00.000Z" })),
    ).toBe(true);
  });
});

// ── checkTrigger — inactive trigger ──────────────────────────────────────────

describe("matchTriggers / inactive filter", () => {
  it("does not include inactive triggers", () => {
    const triggers = [
      makeTrigger({ trigger_type: "keyword", trigger_condition: "cortex", is_active: false }),
    ];
    const result = matchTriggers(triggers, makeContext({ content: "working on cortex" }));
    expect(result).toHaveLength(0);
  });

  it("returns all active matching triggers", () => {
    const triggers = [
      makeTrigger({ trigger_type: "keyword", trigger_condition: "cortex", is_active: true }),
      makeTrigger({ trigger_type: "keyword", trigger_condition: "recall", is_active: true }),
      makeTrigger({ trigger_type: "keyword", trigger_condition: "unrelated", is_active: true }),
    ];
    const result = matchTriggers(
      triggers,
      makeContext({ content: "checking cortex recall pipeline" }),
    );
    expect(result).toHaveLength(2);
  });
});

// ── extractProspectiveIntents ─────────────────────────────────────────────────

describe("extractProspectiveIntents", () => {
  it("detects TODO patterns", () => {
    const intents = extractProspectiveIntents("TODO: update the pg_recall schema");
    expect(intents.length).toBeGreaterThan(0);
    expect(intents[0]?.trigger_type).toBe("keyword_match");
  });

  it("detects 'remember to' pattern", () => {
    const intents = extractProspectiveIntents(
      "remember to check the migration scripts before deploying",
    );
    expect(intents.length).toBeGreaterThan(0);
  });

  it("detects 'next time' pattern", () => {
    const intents = extractProspectiveIntents(
      "next time we change this module run all parity tests",
    );
    expect(intents.length).toBeGreaterThan(0);
  });

  it("skips actionable text shorter than 5 chars", () => {
    const intents = extractProspectiveIntents("TODO: fix");
    // "fix" is 3 chars — too short
    expect(intents).toHaveLength(0);
  });

  it("returns empty array for content with no prospective patterns", () => {
    const intents = extractProspectiveIntents("the sky is blue");
    expect(intents).toHaveLength(0);
  });

  it("strips stop words from trigger_condition", () => {
    const intents = extractProspectiveIntents(
      "remember to check the deployment scripts for the auth service",
    );
    expect(intents.length).toBeGreaterThan(0);
    // "the" and "for" should not be in trigger_condition
    const conditions = intents.map((i) => i.trigger_condition).join(" ");
    expect(conditions).not.toMatch(/\bthe\b/);
    expect(conditions).not.toMatch(/\bfor\b/);
  });
});
