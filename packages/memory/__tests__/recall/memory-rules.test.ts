/**
 * Tests for memory-rules.ts
 *
 * Verifies: condition parsing; action parsing; field value extraction;
 * hard/soft rule application; validation.
 */

import { describe, it, expect } from "vitest";
import {
  parseCondition,
  parseAction,
  evaluateCondition,
  applyRules,
  validateRule,
  getFieldValue,
} from "../../src/recall/memory-rules.js";

describe("parseCondition", () => {
  it("parses numeric > operator", () => {
    const [field, op, value] = parseCondition("importance > 0.7");
    expect(field).toBe("importance");
    expect(op).toBe(">");
    expect(value).toBe("0.7");
  });

  it("parses not_contains operator", () => {
    const [field, op, value] = parseCondition("content not_contains password");
    expect(field).toBe("content");
    expect(op).toBe("not_contains");
    expect(value).toBe("password");
  });

  it("parses matches operator", () => {
    const [field, op, value] = parseCondition("directory_context matches /project/*");
    expect(op).toBe("matches");
    expect(field).toBe("directory_context");
  });

  it("throws on unparseable condition", () => {
    expect(() => parseCondition("no operator here")).toThrow();
  });
});

describe("parseAction", () => {
  it("parses filter action", () => {
    expect(parseAction("filter")).toEqual(["filter", 0.0]);
  });

  it("parses boost action", () => {
    const [type, val] = parseAction("boost:0.3");
    expect(type).toBe("boost");
    expect(val).toBeCloseTo(0.3);
  });

  it("parses penalty action", () => {
    const [type, val] = parseAction("penalty:0.2");
    expect(type).toBe("penalty");
    expect(val).toBeCloseTo(0.2);
  });

  it("throws on invalid action", () => {
    expect(() => parseAction("unknown")).toThrow();
  });
});

describe("evaluateCondition", () => {
  const mem = {
    heat: 0.8,
    importance: 0.6,
    content: "This contains a secret",
    tags: ["foo", "bar"],
    directory_context: "/projects/myapp",
  };

  it("evaluates > correctly", () => {
    expect(evaluateCondition("heat > 0.7", mem)).toBe(true);
    expect(evaluateCondition("heat > 0.9", mem)).toBe(false);
  });

  it("evaluates contains for string fields", () => {
    expect(evaluateCondition("content contains secret", mem)).toBe(true);
    expect(evaluateCondition("content contains missing", mem)).toBe(false);
  });

  it("evaluates contains for array tags", () => {
    expect(evaluateCondition("tags contains foo", mem)).toBe(true);
    expect(evaluateCondition("tags contains baz", mem)).toBe(false);
  });

  it("evaluates == for string equality", () => {
    expect(evaluateCondition("directory_context == /projects/myapp", mem)).toBe(true);
  });

  it("returns true on parse error (fail open)", () => {
    expect(evaluateCondition("not a valid condition", mem)).toBe(true);
  });
});

describe("applyRules", () => {
  const memories = [
    { id: 1, heat: 0.9, content: "important", score: 0.5 },
    { id: 2, heat: 0.2, content: "less important", score: 0.5 },
  ];

  it("hard rule filters out non-matching memories", () => {
    const rules = [{ rule_type: "hard", condition: "heat > 0.5", action: "filter" }];
    const result = applyRules([...memories], rules);
    expect(result.every((m) => (m["heat"] as number) > 0.5)).toBe(true);
  });

  it("soft rule boosts matching memories score", () => {
    const rules = [{ rule_type: "soft", condition: "heat > 0.5", action: "boost:0.3" }];
    const mems = memories.map((m) => ({ ...m }));
    const result = applyRules(mems, rules);
    const boosted = result.find((m) => m["id"] === 1);
    expect(boosted?.["score"] as number).toBeCloseTo(0.8, 4);
  });

  it("sorts result descending by score", () => {
    const rules = [{ rule_type: "soft", condition: "heat > 0.5", action: "boost:0.3" }];
    const mems = memories.map((m) => ({ ...m }));
    const result = applyRules(mems, rules);
    expect(result[0]["score"] as number).toBeGreaterThanOrEqual(result[result.length - 1]["score"] as number);
  });
});

describe("validateRule", () => {
  it("validates a correct hard rule", () => {
    expect(validateRule("hard", "heat > 0.5", "filter")).toHaveLength(0);
  });

  it("rejects invalid rule_type", () => {
    expect(validateRule("unknown", "heat > 0.5", "filter").length).toBeGreaterThan(0);
  });

  it("rejects hard rule with non-filter action", () => {
    expect(validateRule("hard", "heat > 0.5", "boost:0.3").length).toBeGreaterThan(0);
  });

  it("rejects invalid condition", () => {
    expect(validateRule("soft", "no operator here", "boost:0.3").length).toBeGreaterThan(0);
  });
});
