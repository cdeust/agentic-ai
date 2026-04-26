/**
 * Rule-engine tests — known rule + known input → expected fired actions.
 *
 * source: mcp_server/core/memory_rules.py (parity tests)
 */

import { describe, expect, it } from "vitest";

import {
  applyRules,
  evaluateCondition,
  parseAction,
  parseCondition,
  validateRule,
} from "../../src/automation/rule-engine.js";
import type { Rule } from "../../src/automation/types.js";

// ── parseCondition ────────────────────────────────────────────────────────────

describe("parseCondition", () => {
  it("parses > operator", () => {
    expect(parseCondition("importance > 0.7")).toEqual({
      field: "importance",
      operator: ">",
      value: "0.7",
    });
  });

  it("parses >= operator", () => {
    expect(parseCondition("heat >= 0.5")).toEqual({
      field: "heat",
      operator: ">=",
      value: "0.5",
    });
  });

  it("parses == operator", () => {
    expect(parseCondition("source == import")).toEqual({
      field: "source",
      operator: "==",
      value: "import",
    });
  });

  it("parses != operator", () => {
    expect(parseCondition("source != import")).toEqual({
      field: "source",
      operator: "!=",
      value: "import",
    });
  });

  it("parses contains operator", () => {
    expect(parseCondition("tag contains architecture")).toEqual({
      field: "tag",
      operator: "contains",
      value: "architecture",
    });
  });

  it("parses not_contains operator", () => {
    expect(parseCondition("content not_contains password")).toEqual({
      field: "content",
      operator: "not_contains",
      value: "password",
    });
  });

  it("parses matches operator", () => {
    expect(parseCondition("directory_context matches /project/*")).toEqual({
      field: "directory_context",
      operator: "matches",
      value: "/project/*",
    });
  });

  it("throws on unparseable condition", () => {
    expect(() => parseCondition("foobar")).toThrow("Cannot parse condition");
  });
});

// ── parseAction ───────────────────────────────────────────────────────────────

describe("parseAction", () => {
  it("parses filter action", () => {
    expect(parseAction("filter")).toEqual({ action_type: "filter", value: 0 });
  });

  it("parses boost action", () => {
    expect(parseAction("boost:0.3")).toEqual({ action_type: "boost", value: 0.3 });
  });

  it("parses penalty action", () => {
    expect(parseAction("penalty:0.2")).toEqual({
      action_type: "penalty",
      value: 0.2,
    });
  });

  it("throws on unknown action", () => {
    expect(() => parseAction("unknown")).toThrow("Invalid action");
  });
});

// ── evaluateCondition ─────────────────────────────────────────────────────────

describe("evaluateCondition", () => {
  it("evaluates > on numeric field", () => {
    expect(evaluateCondition("importance > 0.5", { importance: 0.8 })).toBe(true);
    expect(evaluateCondition("importance > 0.5", { importance: 0.3 })).toBe(false);
  });

  it("evaluates < on numeric field", () => {
    expect(evaluateCondition("heat < 0.4", { heat: 0.2 })).toBe(true);
  });

  it("evaluates == on string field (case insensitive)", () => {
    expect(evaluateCondition("source == import", { source: "Import" })).toBe(true);
  });

  it("evaluates != on string field", () => {
    expect(evaluateCondition("source != import", { source: "export" })).toBe(true);
    expect(evaluateCondition("source != import", { source: "import" })).toBe(false);
  });

  it("evaluates contains on list field", () => {
    expect(
      evaluateCondition("tag contains arch", { tags: ["architecture", "core"] }),
    ).toBe(true);
    expect(
      evaluateCondition("tag contains auth", { tags: ["architecture", "core"] }),
    ).toBe(false);
  });

  it("evaluates not_contains on string field", () => {
    expect(
      evaluateCondition("content not_contains password", {
        content: "setup the database",
      }),
    ).toBe(true);
    expect(
      evaluateCondition("content not_contains password", {
        content: "store the password here",
      }),
    ).toBe(false);
  });

  it("evaluates matches with glob pattern", () => {
    expect(
      evaluateCondition("directory_context matches /project/*", {
        directory_context: "/project/cortex",
      }),
    ).toBe(true);
    expect(
      evaluateCondition("directory_context matches /project/*", {
        directory_context: "/other/cortex",
      }),
    ).toBe(false);
  });

  it("fails open on unparseable condition", () => {
    // source: memory_rules.py evaluate_condition — returns True on parse error
    expect(evaluateCondition("notparseable", { foo: "bar" })).toBe(true);
  });

  it("treats missing field as 0 for numeric operators", () => {
    expect(evaluateCondition("heat > 0.5", {})).toBe(false);
    expect(evaluateCondition("heat < 0.5", {})).toBe(true);
  });
});

// ── applyRules ────────────────────────────────────────────────────────────────

describe("applyRules", () => {
  const makeRule = (overrides: Partial<Rule>): Rule => ({
    condition: "importance > 0.5",
    action: "filter",
    rule_type: "hard",
    scope: "global",
    priority: 0,
    is_active: true,
    ...overrides,
  });

  it("hard rule filters out non-matching memories", () => {
    const memories = [
      { id: "1", content: "keep", importance: 0.9, score: 0.9 },
      { id: "2", content: "drop", importance: 0.2, score: 0.5 },
    ];
    const rules = [makeRule({ condition: "importance > 0.5", rule_type: "hard", action: "filter" })];
    const result = applyRules(memories, rules, "score");
    expect(result).toHaveLength(1);
    expect(result[0]?.["id"]).toBe("1");
  });

  it("soft boost increases score of matching memories", () => {
    const memories = [
      { id: "1", content: "lesson", tags: ["lesson"], score: 0.5 },
      { id: "2", content: "other", tags: [], score: 0.5 },
    ];
    const rules = [
      makeRule({
        rule_type: "soft",
        condition: "tag contains lesson",
        action: "boost:0.3",
      }),
    ];
    const result = applyRules(memories, rules, "score");
    const lessonMem = result.find((m) => m["id"] === "1");
    expect(lessonMem?.["score"]).toBeCloseTo(0.8);
  });

  it("soft penalty decreases score of matching memories", () => {
    const memories = [
      { id: "1", content: "deprecated thing", tags: ["deprecated"], score: 0.9 },
      { id: "2", content: "fresh thing", tags: [], score: 0.5 },
    ];
    const rules = [
      makeRule({
        rule_type: "soft",
        condition: "tag contains deprecated",
        action: "penalty:0.4",
      }),
    ];
    const result = applyRules(memories, rules, "score");
    const depMem = result.find((m) => m["id"] === "1");
    expect(depMem?.["score"]).toBeCloseTo(0.5);
  });

  it("results are sorted by score descending", () => {
    const memories = [
      { id: "a", score: 0.3 },
      { id: "b", score: 0.9 },
      { id: "c", score: 0.5 },
    ];
    const result = applyRules(memories, [], "score");
    expect(result.map((m) => m["id"])).toEqual(["b", "c", "a"]);
  });

  it("skips rules with no condition", () => {
    const memories = [{ id: "x", score: 0.5 }];
    const rules = [makeRule({ condition: "" })];
    const result = applyRules(memories, rules, "score");
    expect(result).toHaveLength(1);
  });
});

// ── validateRule ──────────────────────────────────────────────────────────────

describe("validateRule", () => {
  it("accepts valid hard rule", () => {
    expect(validateRule("hard", "importance < 0.1", "filter")).toEqual([]);
  });

  it("accepts valid soft rule", () => {
    expect(validateRule("soft", "tag contains lesson", "boost:0.2")).toEqual([]);
  });

  it("rejects invalid rule_type", () => {
    const errors = validateRule("invalid", "importance > 0.5", "filter");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects hard rule with non-filter action", () => {
    const errors = validateRule("hard", "importance > 0.5", "boost:0.3");
    expect(errors).toContain("Hard rules must use 'filter' action");
  });

  it("rejects unparseable condition", () => {
    const errors = validateRule("soft", "notparseable", "boost:0.3");
    expect(errors.length).toBeGreaterThan(0);
  });
});
