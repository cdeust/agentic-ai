/**
 * session-extractor tests — user message extraction + classification.
 */

import { describe, expect, it } from "vitest";
import {
  classifyMessage,
  extractMemorableItems,
  extractSessionSummary,
  extractText,
  extractUserMessages,
  scoreImportance,
} from "../../src/narrative/session-extractor.js";
import type { SessionRecord } from "../../src/narrative/types.js";

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeUserRecord(text: string, overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    type: "user",
    sessionId: "session-1",
    timestamp: "2024-01-01T00:00:00Z",
    message: { content: text },
    ...overrides,
  };
}

function makeAssistantRecord(toolNames: string[]): SessionRecord {
  return {
    type: "assistant",
    sessionId: "session-1",
    timestamp: "2024-01-01T00:00:01Z",
    message: {
      content: toolNames.map((name) => ({ type: "tool_use", name })),
    },
  };
}

// ── extractText ────────────────────────────────────────────────────────────

describe("extractText", () => {
  it("returns string content as-is (trimmed)", () => {
    expect(extractText("  hello world  ")).toBe("hello world");
  });

  it("concatenates text blocks from array content", () => {
    const content = [
      { type: "text", text: "part one" },
      { type: "text", text: "part two" },
    ];
    expect(extractText(content)).toBe("part one part two");
  });

  it("ignores non-text blocks", () => {
    const content = [
      { type: "tool_use", name: "Bash" },
      { type: "text", text: "answer" },
    ];
    expect(extractText(content)).toBe("answer");
  });

  it("returns empty string for unknown types", () => {
    expect(extractText(42)).toBe("");
    expect(extractText(null)).toBe("");
  });
});

// ── extractUserMessages ────────────────────────────────────────────────────

describe("extractUserMessages", () => {
  it("extracts user messages meeting minimum length", () => {
    const records: SessionRecord[] = [
      makeUserRecord("This is a substantial user message that is definitely long enough."),
    ];
    const result = extractUserMessages(records);
    expect(result).toHaveLength(1);
  });

  it("skips assistant records", () => {
    const records: SessionRecord[] = [
      makeAssistantRecord(["Bash"]),
    ];
    expect(extractUserMessages(records)).toHaveLength(0);
  });

  it("skips messages below minimum length (< 40 chars)", () => {
    const records: SessionRecord[] = [makeUserRecord("short")];
    expect(extractUserMessages(records)).toHaveLength(0);
  });

  it("skips meta records", () => {
    const records: SessionRecord[] = [
      makeUserRecord(
        "This is long enough to pass the length check and should be skipped.",
        { isMeta: true }
      ),
    ];
    expect(extractUserMessages(records)).toHaveLength(0);
  });

  it("skips [Request interrupted messages", () => {
    const records: SessionRecord[] = [
      makeUserRecord("[Request interrupted by user — this should be skipped entirely."),
    ];
    expect(extractUserMessages(records)).toHaveLength(0);
  });
});

// ── classifyMessage ────────────────────────────────────────────────────────

describe("classifyMessage", () => {
  it("classifies decision messages", () => {
    expect(classifyMessage("We decided to use Postgres.")).toContain("decision");
  });

  it("classifies error messages", () => {
    expect(classifyMessage("There was an error in the build pipeline.")).toContain("error");
  });

  it("classifies architecture messages", () => {
    expect(classifyMessage("Discussing the clean architecture pattern.")).toContain("architecture");
  });

  it("classifies insight messages", () => {
    expect(classifyMessage("Lesson: always validate at system boundaries.")).toContain("insight");
  });

  it("returns empty array for unclassified messages", () => {
    expect(classifyMessage("Updated the readme file today.")).toEqual([]);
  });

  it("returns multiple categories for multi-signal messages", () => {
    const cats = classifyMessage(
      "We decided to refactor: error in the old design led us to this conclusion."
    );
    expect(cats).toContain("decision");
    expect(cats).toContain("architecture");
    expect(cats).toContain("error");
    expect(cats).toContain("insight");
  });
});

// ── scoreImportance ────────────────────────────────────────────────────────

describe("scoreImportance", () => {
  it("returns at least baseline score (0.3) for any message", () => {
    expect(scoreImportance("simple short text", [])).toBeGreaterThanOrEqual(0.3);
  });

  it("boosts score for decision category", () => {
    const base = scoreImportance("text", []);
    const boosted = scoreImportance("text", ["decision"]);
    expect(boosted).toBeGreaterThan(base);
  });

  it("caps score at 1.0", () => {
    const score = scoreImportance(
      "x".repeat(300) + "```code```",
      ["decision", "architecture", "insight"]
    );
    expect(score).toBeLessThanOrEqual(1.0);
  });

  it("boosts for content length > 200 chars", () => {
    const short = scoreImportance("a".repeat(50), []);
    const long = scoreImportance("a".repeat(250), []);
    expect(long).toBeGreaterThan(short);
  });
});

// ── extractMemorableItems ──────────────────────────────────────────────────

describe("extractMemorableItems", () => {
  const records: SessionRecord[] = [
    makeUserRecord("We decided to switch from Python to TypeScript for the narrative subsystem."),
    makeUserRecord("This short note."), // below MIN_CONTENT_LEN
    makeUserRecord("Found an error in session extraction — the tool results were not filtered."),
    makeUserRecord("We decided to switch from Python to TypeScript for the narrative subsystem."), // duplicate
  ];

  it("extracts items above default importance threshold", () => {
    const items = extractMemorableItems(records);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.importance).toBeGreaterThanOrEqual(0.4);
    }
  });

  it("deduplicates by content prefix", () => {
    const items = extractMemorableItems(records);
    const contents = items.map((i) => i.content.slice(0, 100).toLowerCase());
    const unique = new Set(contents);
    expect(contents.length).toBe(unique.size);
  });

  it("tags extracted items with 'imported'", () => {
    const items = extractMemorableItems(records);
    for (const item of items) {
      expect(item.tags).toContain("imported");
    }
  });

  it("respects custom minImportance", () => {
    const liberal = extractMemorableItems(records, { minImportance: 0.1 });
    const strict = extractMemorableItems(records, { minImportance: 0.9 });
    expect(liberal.length).toBeGreaterThanOrEqual(strict.length);
  });
});

// ── extractSessionSummary ──────────────────────────────────────────────────

describe("extractSessionSummary", () => {
  const records: SessionRecord[] = [
    makeUserRecord("This is a substantial first message from the user, establishing context."),
    makeAssistantRecord(["Bash", "Read"]),
    makeUserRecord("Follow-up question about the implementation approach."),
  ];

  it("extracts session_id from first record with sessionId", () => {
    const summary = extractSessionSummary(records);
    expect(summary.session_id).toBe("session-1");
  });

  it("counts user messages", () => {
    const summary = extractSessionSummary(records);
    expect(summary.user_count).toBe(2);
  });

  it("collects tools_used from assistant records, sorted", () => {
    const summary = extractSessionSummary(records);
    expect(summary.tools_used).toEqual(["Bash", "Read"]);
  });

  it("captures first_message from first non-tool-result user message", () => {
    const summary = extractSessionSummary(records);
    expect(summary.first_message).toContain("substantial first message");
  });

  it("returns empty strings for empty records", () => {
    const summary = extractSessionSummary([]);
    expect(summary.session_id).toBe("");
    expect(summary.start_time).toBe("");
    expect(summary.end_time).toBe("");
  });
});
