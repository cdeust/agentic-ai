/**
 * Unit tests for session-extractor.ts
 *
 * Each test validates the TS port against invariants documented in
 * parity-oracle/cortex/expected/import/claude_mem_smallset.json.
 *
 * Fixture data is minimal synthetic JSONL — enough to exercise every
 * classification category and boundary condition, without requiring live
 * ~/.claude/projects/ files (which are nondeterministic).
 *
 * source: parity-oracle/cortex/inputs/import/claude_mem_smallset.json
 *         (failure_modes_caught list drives the test matrix below)
 */

import { describe, it, expect } from "vitest";
import {
  extractUserMessages,
  classifyMessage,
  scoreImportance,
  extractMemorableItems,
  extractSessionSummary,
} from "../../src/import/session-extractor.js";
import type { JsonlRecord } from "../../src/import/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────

function makeUserRecord(text: string, overrides: Partial<JsonlRecord> = {}): JsonlRecord {
  return {
    type: "user",
    sessionId: "sess-001",
    cwd: "/Users/alice/Developments/cortex",
    timestamp: "2025-01-15T10:00:00Z",
    message: { content: text },
    ...overrides,
  };
}

function makeAssistantRecord(toolNames: string[] = []): JsonlRecord {
  return {
    type: "assistant",
    sessionId: "sess-001",
    timestamp: "2025-01-15T10:00:01Z",
    message: {
      content: toolNames.map((name) => ({ type: "tool_use", name, input: {} })),
    },
  };
}

// ── extractUserMessages ───────────────────────────────────────────────────

describe("extractUserMessages", () => {
  it("returns messages with text above MIN_CONTENT_LEN", () => {
    const records: JsonlRecord[] = [
      makeUserRecord("I decided to switch from SQLite to PostgreSQL for the project."),
    ];
    const msgs = extractUserMessages(records);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.text).toContain("PostgreSQL");
  });

  it("skips non-user records", () => {
    const records: JsonlRecord[] = [
      makeAssistantRecord(["Bash"]),
      makeUserRecord("I decided to use TypeScript for better type safety in the project."),
    ];
    const msgs = extractUserMessages(records);
    expect(msgs).toHaveLength(1);
  });

  it("skips isMeta records", () => {
    const records: JsonlRecord[] = [
      makeUserRecord("This message is very long and should be remembered.", {
        isMeta: true,
      }),
    ];
    expect(extractUserMessages(records)).toHaveLength(0);
  });

  it("skips toolUseResult records", () => {
    const records: JsonlRecord[] = [
      makeUserRecord("A long result message that should be skipped.", {
        toolUseResult: { exit_code: 0, stdout: "ok" },
      }),
    ];
    expect(extractUserMessages(records)).toHaveLength(0);
  });

  it("skips text shorter than MIN_CONTENT_LEN (40 chars)", () => {
    const records: JsonlRecord[] = [
      makeUserRecord("Too short."),
    ];
    expect(extractUserMessages(records)).toHaveLength(0);
  });

  it("skips system-reminder prefix", () => {
    const records: JsonlRecord[] = [
      makeUserRecord("<system-reminder>This should be skipped because it's a system message."),
    ];
    expect(extractUserMessages(records)).toHaveLength(0);
  });

  it("truncates text at MAX_CONTENT_LEN (2000 chars)", () => {
    const longText = "I decided to use this approach. ".repeat(100);
    const records: JsonlRecord[] = [makeUserRecord(longText)];
    const msgs = extractUserMessages(records);
    expect(msgs[0]?.text.length).toBeLessThanOrEqual(2000);
  });

  it("handles list-of-blocks content", () => {
    const records: JsonlRecord[] = [
      {
        type: "user",
        sessionId: "sess-001",
        timestamp: "2025-01-15T10:00:00Z",
        message: {
          content: [
            { type: "text", text: "I decided to refactor the codebase using clean architecture patterns." },
          ],
        },
      },
    ];
    const msgs = extractUserMessages(records);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.text).toContain("refactor");
  });
});

// ── classifyMessage ───────────────────────────────────────────────────────

describe("classifyMessage", () => {
  it("classifies decision messages", () => {
    const cats = classifyMessage("We decided to switch from Python to TypeScript for this module.");
    expect(cats).toContain("decision");
  });

  it("classifies error messages", () => {
    const cats = classifyMessage("There was an error in the authentication flow that caused a crash.");
    expect(cats).toContain("error");
  });

  it("classifies architecture messages", () => {
    const cats = classifyMessage("The architecture should use dependency injection and clean architecture.");
    expect(cats).toContain("architecture");
  });

  it("classifies insight messages", () => {
    const cats = classifyMessage("I learned that the root cause was the missing transaction boundary.");
    expect(cats).toContain("insight");
  });

  it("returns empty array for unclassifiable text", () => {
    const cats = classifyMessage("The weather is nice today and the sky is blue.");
    expect(cats).toHaveLength(0);
  });

  it("can assign multiple categories", () => {
    const cats = classifyMessage(
      "Fixed the error by refactoring the architecture layer with dependency injection.",
    );
    expect(cats).toContain("error");
    expect(cats).toContain("architecture");
  });
});

// ── scoreImportance ───────────────────────────────────────────────────────

describe("scoreImportance", () => {
  it("baseline score is 0.3 for no categories", () => {
    const score = scoreImportance("neutral text with no signal words", []);
    expect(score).toBeCloseTo(0.3, 5);
  });

  it("insight adds 0.3 to baseline", () => {
    const score = scoreImportance("short", ["insight"]);
    expect(score).toBeCloseTo(0.6, 5);
  });

  it("decision adds 0.25 to baseline", () => {
    const score = scoreImportance("short", ["decision"]);
    expect(score).toBeCloseTo(0.55, 5);
  });

  it("caps at 1.0", () => {
    const score = scoreImportance(
      "always must should ```code``` long message ".repeat(10),
      ["decision", "architecture", "insight", "error"],
    );
    expect(score).toBe(1.0);
  });

  it("code block adds 0.05", () => {
    const score = scoreImportance("```const x = 1;```", []);
    expect(score).toBeCloseTo(0.35, 5);
  });

  it("prescriptive words add 0.1", () => {
    const score = scoreImportance("always use strict mode", []);
    expect(score).toBeCloseTo(0.4, 5);
  });
});

// ── extractMemorableItems ─────────────────────────────────────────────────

describe("extractMemorableItems", () => {
  it("includes imported tag on every item", () => {
    const records: JsonlRecord[] = [
      makeUserRecord(
        "I decided to use dependency injection. This was a key architectural decision for the project.",
      ),
    ];
    const items = extractMemorableItems(records, 0.4);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.tags).toContain("imported");
  });

  it("deduplicates items with same content prefix", () => {
    const text = "I decided to switch to TypeScript for all new modules in the codebase.";
    const records: JsonlRecord[] = [
      makeUserRecord(text),
      makeUserRecord(text),
    ];
    const items = extractMemorableItems(records, 0.0);
    expect(items).toHaveLength(1);
  });

  it("filters items below min_importance threshold", () => {
    // text that gives baseline 0.3 — below default 0.4
    const records: JsonlRecord[] = [
      makeUserRecord("The weather today is really quite nice and pleasant outside."),
    ];
    const items = extractMemorableItems(records, 0.4);
    expect(items).toHaveLength(0);
  });

  it("returns empty array for empty records", () => {
    expect(extractMemorableItems([], 0.4)).toHaveLength(0);
  });

  it("preserves timestamp and session_id", () => {
    const records: JsonlRecord[] = [
      makeUserRecord(
        "I decided to switch to TypeScript because of the type safety benefits for long-term maintenance.",
      ),
    ];
    const items = extractMemorableItems(records, 0.0);
    expect(items[0]?.timestamp).toBe("2025-01-15T10:00:00Z");
    expect(items[0]?.session_id).toBe("sess-001");
  });
});

// ── extractSessionSummary ─────────────────────────────────────────────────

describe("extractSessionSummary", () => {
  it("extracts session_id and cwd", () => {
    const records: JsonlRecord[] = [
      makeUserRecord("Hello, how can I help?"),
    ];
    const summary = extractSessionSummary(records);
    expect(summary.session_id).toBe("sess-001");
    expect(summary.cwd).toBe("/Users/alice/Developments/cortex");
  });

  it("extracts tool names from assistant records", () => {
    const records: JsonlRecord[] = [
      makeUserRecord("Run the tests please."),
      makeAssistantRecord(["Bash", "Read"]),
    ];
    const summary = extractSessionSummary(records);
    expect(summary.tools_used).toContain("Bash");
    expect(summary.tools_used).toContain("Read");
  });

  it("returns empty strings for empty records", () => {
    const summary = extractSessionSummary([]);
    expect(summary.session_id).toBe("");
    expect(summary.cwd).toBe("");
    expect(summary.start_time).toBe("");
    expect(summary.end_time).toBe("");
  });

  it("computes start_time and end_time from timestamps", () => {
    const records: JsonlRecord[] = [
      { ...makeUserRecord("First message"), timestamp: "2025-01-15T08:00:00Z" },
      { ...makeUserRecord("Second message"), timestamp: "2025-01-15T10:00:00Z" },
    ];
    const summary = extractSessionSummary(records);
    expect(summary.start_time).toBe("2025-01-15T08:00:00Z");
    expect(summary.end_time).toBe("2025-01-15T10:00:00Z");
  });

  it("tools_used is sorted", () => {
    const records: JsonlRecord[] = [
      makeAssistantRecord(["Write", "Bash", "Read"]),
    ];
    const summary = extractSessionSummary(records);
    expect(summary.tools_used).toEqual(["Bash", "Read", "Write"]);
  });
});
