/**
 * Tests for shared/errors.ts
 *
 * Invariants verified:
 * - MethodologyError is the base class; code defaults to -32000
 * - ValidationError has code -32602 (JSON-RPC invalid params)
 * - StorageError has code -32001
 * - AnalysisError has code -32002
 * - McpConnectionError has code -32003
 * - All subtypes are instanceof MethodologyError (LSP: substitutable)
 * - details field carries the provided details object or null
 *
 * source: cortex@ed33435 mcp_server/errors/__init__.py
 */

import { describe, it, expect } from "vitest";
import {
  MethodologyError,
  ValidationError,
  StorageError,
  AnalysisError,
  McpConnectionError,
} from "../../../src/shared/errors.js";

describe("MethodologyError", () => {
  it("defaults code to -32000", () => {
    // source: cortex@ed33435 mcp_server/errors/__init__.py:13 (code: int = -32000)
    const e = new MethodologyError("something failed");
    expect(e.code).toBe(-32000);
  });

  it("accepts custom code and details", () => {
    const details = { context: "test" };
    const e = new MethodologyError("msg", -99999, details);
    expect(e.code).toBe(-99999);
    expect(e.details).toEqual(details);
  });

  it("is instanceof Error", () => {
    expect(new MethodologyError("x")).toBeInstanceOf(Error);
  });

  it("defaults details to null", () => {
    expect(new MethodologyError("x").details).toBeNull();
  });
});

describe("ValidationError", () => {
  it("has code -32602 (JSON-RPC invalid params)", () => {
    // source: cortex@ed33435 mcp_server/errors/__init__.py:22
    expect(new ValidationError("bad input").code).toBe(-32602);
  });

  it("is instanceof MethodologyError (LSP substitution)", () => {
    expect(new ValidationError("x")).toBeInstanceOf(MethodologyError);
  });

  it("carries details", () => {
    const details = { field: "query" };
    const e = new ValidationError("missing field", details);
    expect(e.details).toEqual(details);
  });

  it("message is accessible via .message", () => {
    expect(new ValidationError("invalid field").message).toBe("invalid field");
  });
});

describe("StorageError", () => {
  it("has code -32001", () => {
    // source: cortex@ed33435 mcp_server/errors/__init__.py:28
    expect(new StorageError("disk full").code).toBe(-32001);
  });

  it("is instanceof MethodologyError", () => {
    expect(new StorageError("x")).toBeInstanceOf(MethodologyError);
  });
});

describe("AnalysisError", () => {
  it("has code -32002", () => {
    // source: cortex@ed33435 mcp_server/errors/__init__.py:34
    expect(new AnalysisError("algo failed").code).toBe(-32002);
  });

  it("is instanceof MethodologyError", () => {
    expect(new AnalysisError("x")).toBeInstanceOf(MethodologyError);
  });
});

describe("McpConnectionError", () => {
  it("has code -32003", () => {
    // source: cortex@ed33435 mcp_server/errors/__init__.py:40
    expect(new McpConnectionError("connection reset").code).toBe(-32003);
  });

  it("is instanceof MethodologyError", () => {
    expect(new McpConnectionError("x")).toBeInstanceOf(MethodologyError);
  });
});
