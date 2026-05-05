/**
 * Tests for memory-decomposer.ts
 *
 * Verifies: single-chunk passthrough; conversation chunking by turns;
 * markdown chunking by headings; entity extraction; date prefix propagation.
 */

import { describe, it, expect } from "vitest";
import {
  decomposeMemory,
  extractConversationalEntities,
  buildEntitySummary,
} from "../../src/remember/memory-decomposer.js";

describe("extractConversationalEntities", () => {
  it("extracts person names", () => {
    const ents = extractConversationalEntities("Alice told Bob about the project");
    expect(ents.persons).toContain("Alice");
    expect(ents.persons).toContain("Bob");
  });

  it("filters common words from persons", () => {
    const ents = extractConversationalEntities("The project was awesome");
    expect(ents.persons).not.toContain("The");
  });

  it("detects instructions", () => {
    const ents = extractConversationalEntities("always use TypeScript for this project");
    expect(ents.has_instruction).toBe(true);
  });

  it("detects preferences", () => {
    const ents = extractConversationalEntities("I prefer functional programming style");
    expect(ents.has_preference).toBe(true);
  });
});

describe("buildEntitySummary", () => {
  it("returns non-empty string for entities with data", () => {
    const summary = buildEntitySummary({
      persons: ["Alice", "Bob"],
      quoted_terms: ["TypeScript"],
      has_preference: true,
      has_instruction: false,
      has_activity: false,
      has_decision: false,
    });
    expect(summary.length).toBeGreaterThan(0);
    expect(summary).toContain("Alice");
  });

  it("returns empty string for empty entities", () => {
    const summary = buildEntitySummary({
      persons: [],
      quoted_terms: [],
      has_preference: false,
      has_instruction: false,
      has_activity: false,
      has_decision: false,
    });
    expect(summary).toBe("");
  });
});

describe("decomposeMemory", () => {
  it("returns empty for empty content", () => {
    expect(decomposeMemory("")).toHaveLength(0);
  });

  it("returns single chunk for plain text", () => {
    const result = decomposeMemory("This is plain text content about a project.");
    expect(result).toHaveLength(1);
    expect(result[0].content).toContain("plain text");
  });

  it("splits at markdown headings", () => {
    const md = `## Section One\nContent about section one.\n\n## Section Two\nContent about section two.`;
    const result = decomposeMemory(md, 4, 10);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("preserves date prefix in each chunk for markdown", () => {
    const md = `[Date: 2024-01-01]\n## Section One\nContent A.\n\n## Section Two\nContent B.`;
    const result = decomposeMemory(md, 4, 10);
    if (result.length > 1) {
      expect(result[0].content).toContain("[Date: 2024-01-01]");
      expect(result[1].content).toContain("[Date: 2024-01-01]");
    }
  });

  it("splits conversation by turns", () => {
    const conv = [
      "[User]: Hello there",
      "[Assistant]: Hi, how can I help?",
      "[User]: Tell me about TypeScript",
      "[Assistant]: TypeScript is great",
      "[User]: Can you explain generics?",
      "[Assistant]: Of course...",
    ].join("\n");
    // turnsPerChunk=2, minChunkChars=10
    const result = decomposeMemory(conv, 2, 10);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("each chunk has entities field", () => {
    const result = decomposeMemory("Simple content here.");
    expect(result[0].entities).toBeDefined();
    expect(typeof result[0].entities.has_preference).toBe("boolean");
  });
});
