import { describe, it, expect } from "vitest";
import { categorize, categorizeWithScores } from "../../src/shared/categorizer.js";

describe("categorize", () => {
  it("returns 'general' for null/undefined", () => {
    expect(categorize(null)).toBe("general");
    expect(categorize(undefined)).toBe("general");
    expect(categorize("")).toBe("general");
  });

  it("classifies bug-fix text", () => {
    expect(categorize("fix the crash in auth module")).toBe("bug-fix");
  });

  it("classifies feature text", () => {
    expect(categorize("implement new user dashboard")).toBe("feature");
  });

  it("classifies refactor text", () => {
    expect(categorize("refactor the data layer")).toBe("refactor");
  });

  it("classifies testing text", () => {
    expect(categorize("write unit test for parser")).toBe("testing");
  });

  it("classifies docs text", () => {
    expect(categorize("update the readme and changelog")).toBe("docs");
  });

  it("classifies debug text", () => {
    expect(categorize("debug why is the service slow")).toBe("debug");
  });

  it("returns 'general' for unrelated text", () => {
    expect(categorize("xyz random")).toBe("general");
  });
});

describe("categorizeWithScores", () => {
  it("returns empty object for empty text", () => {
    expect(categorizeWithScores("")).toEqual({});
  });

  it("returns scores for matched categories", () => {
    const scores = categorizeWithScores("fix this bug crash error");
    expect(scores["bug-fix"]).toBeGreaterThan(0);
  });

  it("multi-word phrase scores higher weight (1.5)", () => {
    const scores = categorizeWithScores("why is the unit test failing");
    // "unit test" is a multi-word phrase (1.5) + "test" (1.0) + "failing" (1.0)
    expect(scores["testing"]).toBeGreaterThanOrEqual(1.5);
  });
});
