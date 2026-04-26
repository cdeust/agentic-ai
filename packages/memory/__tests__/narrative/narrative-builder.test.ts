/**
 * narrative-builder tests — structural arc detection + narrative generation.
 *
 * Tests cover the structural arc shape (rising action → complication →
 * resolution) on synthetic MemoryRecord inputs.  The test oracle is the
 * Proppian grammar: if a complication is present without a resolution, the
 * arc is incomplete — not an error but a structurally interesting gap.
 *
 * // source: Propp 1928/1968 Ch. 9 — the tale schema as the alignment
 *            template for morphological comparison.
 */

import { describe, expect, it } from "vitest";
import {
  arcFunctionSequence,
  detectArc,
  extractDecisions,
  extractEvents,
  extractHotTopics,
  extractTopEntities,
  generateBriefSummary,
  generateNarrative,
} from "../../src/narrative/narrative-builder.js";
import type { MemoryRecord } from "../../src/narrative/types.js";

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeRecord(
  overrides: Partial<MemoryRecord> & { content: string }
): MemoryRecord {
  return {
    tags: [],
    importance: 0.5,
    heat: 0,
    timestamp: "",
    session_id: "",
    ...overrides,
  };
}

const DECISION_MEMORY: MemoryRecord = makeRecord({
  content: "We decided to use Zod for runtime validation instead of io-ts.",
  tags: ["decision"],
  importance: 0.8,
  heat: 0.6,
});

const ARCHITECTURE_MEMORY: MemoryRecord = makeRecord({
  content: "Refactored the layer structure to follow Clean Architecture with strict dependency inversion.",
  tags: ["architecture"],
  importance: 0.75,
  heat: 0.5,
});

const ERROR_MEMORY: MemoryRecord = makeRecord({
  content: "Error: the build pipeline crashed because NODE_ENV was not set in CI.",
  tags: ["error"],
  importance: 0.9,
  heat: 0.8,
});

const BUG_MEMORY: MemoryRecord = makeRecord({
  content: "Found a bug in the session extractor — it was not filtering tool-use results.",
  tags: ["error"],
  importance: 0.85,
  heat: 0.7,
});

const INSIGHT_MEMORY: MemoryRecord = makeRecord({
  content: "Lesson learned: always validate at system boundaries, never inside the domain layer.",
  tags: ["insight"],
  importance: 0.9,
  heat: 0.3,
});

const RESOLVED_MEMORY: MemoryRecord = makeRecord({
  content: "Fixed the CI crash — now NODE_ENV is correctly set in the GitHub Actions workflow.",
  tags: ["insight"],
  importance: 0.7,
  heat: 0.4,
});

const ENTITY_MEMORY: MemoryRecord = makeRecord({
  content: "NarrativeBuilder.detectArc now returns a NarrativeArc with orientation/complication/resolution.",
  tags: [],
  importance: 0.5,
  heat: 0.2,
});

const HOT_TOPIC_MEMORY: MemoryRecord = makeRecord({
  content: "Current focus: porting the Cortex narrative subsystem to TypeScript.",
  tags: [],
  importance: 0.5,
  heat: 0.9,
});

// ── Arc detection: structural grammar ─────────────────────────────────────

describe("detectArc — structural arc detection", () => {
  it("produces a full orientation → complication → resolution arc", () => {
    const memories = [DECISION_MEMORY, ERROR_MEMORY, RESOLVED_MEMORY];
    const arc = detectArc(memories);

    expect(arc.orientation).toBeDefined();
    expect(arc.complication).toBeDefined();
    expect(arc.resolution).toBeDefined();
  });

  it("function sequence follows grammar order: orientation < complication < resolution", () => {
    const memories = [DECISION_MEMORY, ERROR_MEMORY, INSIGHT_MEMORY];
    const arc = detectArc(memories);
    const seq = arcFunctionSequence(arc);

    // Grammar constraint: orientation must precede complication, complication before resolution
    const orientationIdx = seq.indexOf("orientation");
    const complicationIdx = seq.indexOf("complication");
    const resolutionIdx = seq.indexOf("resolution");

    if (orientationIdx !== -1 && complicationIdx !== -1) {
      expect(orientationIdx).toBeLessThan(complicationIdx);
    }
    if (complicationIdx !== -1 && resolutionIdx !== -1) {
      expect(complicationIdx).toBeLessThan(resolutionIdx);
    }
  });

  it("detects a degenerate arc (orientation only — no complication, no resolution)", () => {
    const memories = [DECISION_MEMORY, ARCHITECTURE_MEMORY];
    const arc = detectArc(memories);

    expect(arc.orientation).toBeDefined();
    expect(arc.complication).toBeUndefined();
    expect(arc.resolution).toBeUndefined();
    expect(arcFunctionSequence(arc)).toEqual(["orientation"]);
  });

  it("detects a rising-action-only arc (complication without resolution — structural gap)", () => {
    const memories = [DECISION_MEMORY, ERROR_MEMORY];
    const arc = detectArc(memories);

    expect(arc.orientation).toBeDefined();
    expect(arc.complication).toBeDefined();
    expect(arc.resolution).toBeUndefined();
    // Gap is structurally visible: complication present, resolution absent
    expect(arcFunctionSequence(arc)).toEqual(["orientation", "complication"]);
  });

  it("detects a resolution-only arc (unusual but structurally valid as a gap)", () => {
    const memories = [RESOLVED_MEMORY];
    const arc = detectArc(memories);

    expect(arc.orientation).toBeUndefined();
    expect(arc.complication).toBeUndefined();
    expect(arc.resolution).toBeDefined();
    expect(arcFunctionSequence(arc)).toEqual(["resolution"]);
  });

  it("returns empty arc for empty memories", () => {
    const arc = detectArc([]);
    expect(arc.orientation).toBeUndefined();
    expect(arc.complication).toBeUndefined();
    expect(arc.resolution).toBeUndefined();
    expect(arcFunctionSequence(arc)).toEqual([]);
  });

  it("assigns error-tagged memories to complication", () => {
    const arc = detectArc([ERROR_MEMORY]);
    expect(arc.complication).toBeDefined();
    expect(arc.complication?.items).toHaveLength(1);
  });

  it("assigns insight-tagged memories to resolution", () => {
    const arc = detectArc([INSIGHT_MEMORY]);
    expect(arc.resolution).toBeDefined();
    expect(arc.resolution?.items).toHaveLength(1);
  });

  it("assigns decision-tagged memories to orientation", () => {
    const arc = detectArc([DECISION_MEMORY]);
    expect(arc.orientation).toBeDefined();
    expect(arc.orientation?.items).toHaveLength(1);
  });
});

// ── extractDecisions ───────────────────────────────────────────────────────

describe("extractDecisions", () => {
  it("extracts memories with decision tag", () => {
    const result = extractDecisions([DECISION_MEMORY]);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("decided");
  });

  it("extracts memories with decision keyword in content", () => {
    const mem = makeRecord({ content: "We chose PostgreSQL over SQLite for the data store." });
    const result = extractDecisions([mem]);
    expect(result).toHaveLength(1);
  });

  it("ignores memories with neither tag nor keyword", () => {
    const mem = makeRecord({ content: "The module has 120 lines and three functions." });
    const result = extractDecisions([mem]);
    expect(result).toHaveLength(0);
  });

  it("truncates long content at 150 chars with ellipsis", () => {
    const longContent = "We decided to " + "x".repeat(200);
    const mem = makeRecord({ content: longContent });
    const [result] = extractDecisions([mem]);
    expect(result).toBeDefined();
    expect(result!.length).toBeLessThanOrEqual(153); // 150 + "..."
    expect(result!.endsWith("...")).toBe(true);
  });
});

// ── extractEvents ──────────────────────────────────────────────────────────

describe("extractEvents", () => {
  it("extracts high-importance memories", () => {
    const highImp = makeRecord({ content: "Shipped the billing module.", importance: 0.9 });
    const result = extractEvents([highImp]);
    expect(result).toHaveLength(1);
  });

  it("extracts memories matching event keywords regardless of importance", () => {
    // Use "error" — a whole word in _EVENT_KEYWORDS / EVENT_RE.
    // "crashed" does not match \bcrash\b; the source keyword list contains
    // "crash" as a standalone word (source: narrative.py _EVENT_KEYWORDS).
    const lowImp = makeRecord({
      content: "There was an error during the build on main.",
      importance: 0.2,
    });
    const result = extractEvents([lowImp]);
    expect(result).toHaveLength(1);
  });

  it("ignores low-importance memories without event keywords", () => {
    const mem = makeRecord({ content: "Reviewed the PR.", importance: 0.3 });
    const result = extractEvents([mem]);
    expect(result).toHaveLength(0);
  });
});

// ── extractTopEntities ─────────────────────────────────────────────────────

describe("extractTopEntities", () => {
  it("extracts CamelCase entities", () => {
    const result = extractTopEntities([ENTITY_MEMORY]);
    expect(result).toContain("NarrativeBuilder");
    expect(result).toContain("NarrativeArc");
  });

  it("respects maxEntities limit", () => {
    const mems = Array.from({ length: 20 }, (_, i) =>
      makeRecord({ content: `Entity${i}Word used here.` })
    );
    const result = extractTopEntities(mems, 5);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it("returns empty list for empty memories", () => {
    expect(extractTopEntities([])).toEqual([]);
  });
});

// ── extractHotTopics ───────────────────────────────────────────────────────

describe("extractHotTopics", () => {
  it("returns topics for high-heat memories", () => {
    const result = extractHotTopics([HOT_TOPIC_MEMORY]);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("Current focus");
  });

  it("ignores low-heat memories", () => {
    const cold = makeRecord({ content: "Some old note.", heat: 0.1 });
    expect(extractHotTopics([cold])).toHaveLength(0);
  });

  it("sorts by heat descending", () => {
    const a = makeRecord({ content: "lower heat", heat: 0.75 });
    const b = makeRecord({ content: "higher heat", heat: 0.95 });
    const result = extractHotTopics([a, b]);
    expect(result[0]).toBe("higher heat");
  });
});

// ── generateNarrative ──────────────────────────────────────────────────────

describe("generateNarrative", () => {
  const allMemories = [
    DECISION_MEMORY,
    ARCHITECTURE_MEMORY,
    ERROR_MEMORY,
    BUG_MEMORY,
    INSIGHT_MEMORY,
    RESOLVED_MEMORY,
    HOT_TOPIC_MEMORY,
  ];

  it("returns narrative prose string", () => {
    const result = generateNarrative(allMemories, "/projects/cortex");
    expect(result.narrative).toBeDefined();
    expect(result.narrative).toContain("Project Narrative");
    expect(result.narrative).toContain("/projects/cortex");
  });

  it("returns memory_count equal to input length", () => {
    const result = generateNarrative(allMemories);
    expect(result.memory_count).toBe(allMemories.length);
  });

  it("includes decisions, events, entities, topics", () => {
    const result = generateNarrative(allMemories);
    expect(result.decisions.length).toBeGreaterThan(0);
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.topics.length).toBeGreaterThan(0);
  });

  it("includes the structural arc", () => {
    const result = generateNarrative(allMemories);
    expect(result.arc).toBeDefined();
  });

  it("returns empty narrative marker for zero memories", () => {
    const result = generateNarrative([]);
    expect(result.narrative).toContain("No significant activity");
    expect(result.memory_count).toBe(0);
  });
});

// ── generateBriefSummary ───────────────────────────────────────────────────

describe("generateBriefSummary", () => {
  const memories = [DECISION_MEMORY, ERROR_MEMORY, HOT_TOPIC_MEMORY];

  it("returns a non-empty string", () => {
    expect(generateBriefSummary(memories)).toBeTruthy();
  });

  it("respects maxChars constraint", () => {
    const result = generateBriefSummary(memories, 100);
    expect(result.length).toBeLessThanOrEqual(103); // maxChars + possible "..."
  });

  it("returns empty string for empty memories", () => {
    expect(generateBriefSummary([])).toBe("");
  });
});
