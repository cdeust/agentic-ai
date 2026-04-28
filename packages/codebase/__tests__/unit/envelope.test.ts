/**
 * Unit tests for internal/envelope.ts
 *
 * Verifies: unwrapEnvelope correctly extracts the inner JSON payload from the
 * MCP text-envelope that the Rust binary wraps tool results in.
 *
 * source: docs/PHASE_3_PLAN.md §1.6 — Tool-call envelope description
 */

import { describe, it, expect } from "vitest";
import { unwrapEnvelope } from "../../src/internal/envelope.js";
import { CodebaseSubprocessError } from "@agentic/core";

describe("unwrapEnvelope", () => {
  it("extracts inner JSON payload from a well-formed envelope", () => {
    const inner = { stage: 3, node_count: 42, edge_count: 100 };
    const raw = {
      content: [{ type: "text", text: JSON.stringify(inner) }],
    };
    const result = unwrapEnvelope(raw);
    expect(result).toEqual(inner);
  });

  it("throws CodebaseSubprocessError for isError: true envelope", () => {
    const raw = {
      isError: true,
      content: [{ type: "text", text: "Unknown tool: bad_tool" }],
    };
    expect(() => unwrapEnvelope(raw)).toThrowError(CodebaseSubprocessError);
    expect(() => unwrapEnvelope(raw)).toThrowError(/Unknown tool: bad_tool/);
  });

  it("throws CodebaseSubprocessError for missing content array", () => {
    expect(() => unwrapEnvelope({})).toThrowError(CodebaseSubprocessError);
    expect(() => unwrapEnvelope({ content: [] })).toThrowError(
      CodebaseSubprocessError,
    );
  });

  it("throws CodebaseSubprocessError when content[0].type is not 'text'", () => {
    const raw = { content: [{ type: "image", data: "base64" }] };
    expect(() => unwrapEnvelope(raw)).toThrowError(CodebaseSubprocessError);
  });

  it("throws CodebaseSubprocessError for invalid inner JSON", () => {
    const raw = { content: [{ type: "text", text: "not valid json {" }] };
    expect(() => unwrapEnvelope(raw)).toThrowError(CodebaseSubprocessError);
  });

  it("throws CodebaseSubprocessError when input is not an object", () => {
    expect(() => unwrapEnvelope(null)).toThrowError(CodebaseSubprocessError);
    expect(() => unwrapEnvelope("string")).toThrowError(CodebaseSubprocessError);
    expect(() => unwrapEnvelope(42)).toThrowError(CodebaseSubprocessError);
  });

  it("throws CodebaseSubprocessError when inner payload is not an object", () => {
    const raw = { content: [{ type: "text", text: '"just a string"' }] };
    expect(() => unwrapEnvelope(raw)).toThrowError(CodebaseSubprocessError);
  });
});
