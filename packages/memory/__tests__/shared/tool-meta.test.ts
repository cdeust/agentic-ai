/**
 * Unit tests for tool-meta.ts
 * source: cortex@ed33435 mcp_server/handlers/_tool_meta.py
 */

import { describe, it, expect } from "vitest";
import {
  READ_ONLY,
  IDEMPOTENT_WRITE,
  NON_IDEMPOTENT_WRITE,
  DESTRUCTIVE,
  READ_ONLY_EXTERNAL,
  toolKwargs,
} from "../../src/shared/tool-meta.js";

describe("annotation presets", () => {
  it("READ_ONLY has readOnlyHint=true", () => {
    expect(READ_ONLY.readOnlyHint).toBe(true);
    expect(READ_ONLY.destructiveHint).toBe(false);
    expect(READ_ONLY.idempotentHint).toBe(true);
  });

  it("IDEMPOTENT_WRITE has readOnlyHint=false idempotentHint=true", () => {
    expect(IDEMPOTENT_WRITE.readOnlyHint).toBe(false);
    expect(IDEMPOTENT_WRITE.idempotentHint).toBe(true);
    expect(IDEMPOTENT_WRITE.destructiveHint).toBe(false);
  });

  it("NON_IDEMPOTENT_WRITE has idempotentHint=false", () => {
    expect(NON_IDEMPOTENT_WRITE.idempotentHint).toBe(false);
    expect(NON_IDEMPOTENT_WRITE.readOnlyHint).toBe(false);
  });

  it("DESTRUCTIVE has destructiveHint=true", () => {
    expect(DESTRUCTIVE.destructiveHint).toBe(true);
  });

  it("READ_ONLY_EXTERNAL has openWorldHint=true", () => {
    expect(READ_ONLY_EXTERNAL.openWorldHint).toBe(true);
    expect(READ_ONLY_EXTERNAL.readOnlyHint).toBe(true);
  });
});

describe("toolKwargs", () => {
  it("extracts description and title", () => {
    const schema = { title: "My Tool", description: "Does stuff" };
    const result = toolKwargs(schema);
    expect(result["title"]).toBe("My Tool");
    expect(result["description"]).toBe("Does stuff");
  });

  it("normalises outputSchema → output_schema", () => {
    const schema = { outputSchema: { type: "object" } };
    const result = toolKwargs(schema);
    expect(result["output_schema"]).toEqual({ type: "object" });
  });

  it("also handles output_schema snake_case", () => {
    const schema = { output_schema: { type: "array" } };
    const result = toolKwargs(schema);
    expect(result["output_schema"]).toEqual({ type: "array" });
  });

  it("ignores unknown keys", () => {
    const schema = { unknownKey: "value", title: "T" } as Record<string, unknown>;
    const result = toolKwargs(schema as Parameters<typeof toolKwargs>[0]);
    expect("unknownKey" in result).toBe(false);
  });
});
