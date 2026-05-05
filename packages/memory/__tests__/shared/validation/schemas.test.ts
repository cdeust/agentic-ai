/**
 * Tests for shared/validation/schemas.ts
 *
 * Invariants verified:
 * - SCHEMAS is exported and contains required tool definitions
 * - validateToolArgs passes through unknown tools unchanged
 * - validateToolArgs throws ValidationError for missing required fields
 * - validateToolArgs throws ValidationError for type mismatches
 * - validateToolArgs throws ValidationError for maxLength violations
 * - validateToolArgs throws ValidationError for maxItems violations
 * - validateToolArgs throws ValidationError for item-level violations
 * - validateToolArgs applies defaults for omitted optional fields
 * - validateToolArgs rejects boolean for number type (Python bool/int subclass parity)
 *
 * source: cortex@ed33435 mcp_server/validation/schemas.py
 */

import { describe, it, expect } from "vitest";
import { validateToolArgs, SCHEMAS } from "../../../src/shared/validation/schemas.js";
import { ValidationError } from "../../../src/shared/errors.js";

describe("SCHEMAS export", () => {
  it("is exported and contains known tool definitions", () => {
    // source: cortex@ed33435 mcp_server/validation/schemas.py:20 (SCHEMAS dict)
    expect(SCHEMAS).toBeDefined();
    expect(SCHEMAS["remember"]).toBeDefined();
    expect(SCHEMAS["recall"]).toBeDefined();
    expect(SCHEMAS["query_methodology"]).toBeDefined();
  });

  it("remember schema requires content field", () => {
    expect(SCHEMAS["remember"]!.required).toContain("content");
  });

  it("recall schema requires query field", () => {
    expect(SCHEMAS["recall"]!.required).toContain("query");
  });
});

describe("validateToolArgs — unknown tool", () => {
  it("passes args through for unknown tools", () => {
    const args = { foo: "bar" };
    expect(validateToolArgs("unknown_tool", args)).toEqual(args);
  });

  it("returns empty object for unknown tool with null args", () => {
    expect(validateToolArgs("unknown_tool", null)).toEqual({});
  });
});

describe("validateToolArgs — required field enforcement", () => {
  it("throws ValidationError when required field is missing", () => {
    // recall requires "query"
    // source: cortex@ed33435 mcp_server/validation/schemas.py:307-311
    expect(() => validateToolArgs("recall", {})).toThrow(ValidationError);
  });

  it("throws with message citing the missing field", () => {
    try {
      validateToolArgs("recall", {});
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).message).toContain("query");
    }
  });

  it("throws ValidationError when required field is null", () => {
    expect(() => validateToolArgs("recall", { query: null })).toThrow(ValidationError);
  });
});

describe("validateToolArgs — type checking", () => {
  it("throws for string field receiving a number", () => {
    expect(() => validateToolArgs("recall", { query: 42 })).toThrow(ValidationError);
  });

  it("throws for number field receiving a string", () => {
    expect(() => validateToolArgs("recall", { query: "ok", limit: "notanumber" })).toThrow(ValidationError);
  });

  it("accepts valid string for string field", () => {
    const result = validateToolArgs("recall", { query: "find something" });
    expect(result["query"]).toBe("find something");
  });

  it("accepts valid number for number field", () => {
    const result = validateToolArgs("recall", { query: "q", limit: 10 });
    expect(result["limit"]).toBe(10);
  });

  it("throws ValidationError for boolean where number is expected (Python bool/int parity)", () => {
    // source: cortex@ed33435 mcp_server/validation/schemas.py:267-271
    // Python: bool is subclass of int → explicitly rejected for 'number' type
    expect(() => validateToolArgs("recall", { query: "q", limit: true })).toThrow(ValidationError);
  });
});

describe("validateToolArgs — maxLength", () => {
  it("throws for string exceeding maxLength", () => {
    // remember.content has maxLength: 10000
    const tooLong = "x".repeat(10001);
    expect(() => validateToolArgs("remember", { content: tooLong })).toThrow(ValidationError);
  });

  it("accepts string at exactly maxLength", () => {
    const exact = "x".repeat(10000);
    const result = validateToolArgs("remember", { content: exact });
    expect(result["content"]).toBe(exact);
  });
});

describe("validateToolArgs — maxItems (array envelope)", () => {
  it("throws for tags array exceeding 20 items", () => {
    // source: cortex@ed33435 mcp_server/validation/schemas.py:238-245 (ADR-0045 R2 E4)
    const tooManyTags = Array.from({ length: 21 }, (_, i) => `tag${i}`);
    expect(() => validateToolArgs("remember", { content: "ok", tags: tooManyTags })).toThrow(ValidationError);
  });

  it("accepts tags array at exactly 20 items", () => {
    const exactTags = Array.from({ length: 20 }, (_, i) => `tag${i}`);
    const result = validateToolArgs("remember", { content: "ok", tags: exactTags });
    expect(result["tags"]).toEqual(exactTags);
  });
});

describe("validateToolArgs — per-item validation", () => {
  it("throws for tag item exceeding 80 chars", () => {
    const longTag = "x".repeat(81);
    expect(() =>
      validateToolArgs("remember", { content: "ok", tags: [longTag] }),
    ).toThrow(ValidationError);
  });

  it("accepts tag at exactly 80 chars", () => {
    const exactTag = "x".repeat(80);
    const result = validateToolArgs("remember", { content: "ok", tags: [exactTag] });
    expect((result["tags"] as string[])[0]).toBe(exactTag);
  });
});

describe("validateToolArgs — defaults", () => {
  it("applies default value for force field in rebuild_profiles", () => {
    // source: cortex@ed33435 mcp_server/validation/schemas.py:58 ("default": False)
    const result = validateToolArgs("rebuild_profiles", {});
    expect(result["force"]).toBe(false);
  });

  it("applies default server for run_pipeline", () => {
    const result = validateToolArgs("run_pipeline", {
      codebase_path: "/some/path",
      task_path: "/some/task",
    });
    expect(result["server"]).toBe("ai-architect");
    expect(result["max_findings"]).toBe(5);
  });
});
