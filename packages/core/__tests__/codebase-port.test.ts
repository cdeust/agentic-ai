/**
 * Unit tests for @agentic/core/ports/codebase.ts
 *
 * Verifies: Zod schema shapes, discriminated error types, and that the
 * CodebasePort interface is structurally sound.
 *
 * source: docs/PHASE_3_PLAN.md §2.7 — CodebasePort sketched interface
 * source: inventory/MCP_TOOLS.md — schema definitions
 */

import { describe, it, expect } from "vitest";
import {
  HealthCheckInputSchema,
  IndexCodebaseInputSchema,
  NotFoundOutputSchema,
  GetSymbolOutputSchema,
  LspResolveInputSchema,
  ArtifactWriteSpecSchema,
  LanguageSchema,
  CodebaseValidationError,
  CodebaseTimeoutError,
  CodebaseSubprocessError,
  CodebaseLspError,
} from "../src/index.js";

describe("ArtifactWriteSpecSchema", () => {
  it("accepts a well-formed spec", () => {
    const result = ArtifactWriteSpecSchema.safeParse({
      runId: "run-1",
      findingId: "finding-1",
      outputDir: "/tmp/out",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty strings", () => {
    expect(
      ArtifactWriteSpecSchema.safeParse({
        runId: "",
        findingId: "f",
        outputDir: "/tmp",
      }).success,
    ).toBe(false);
  });
});

describe("LanguageSchema", () => {
  it("accepts valid language values", () => {
    for (const lang of ["auto", "rust", "python", "typescript"] as const) {
      expect(LanguageSchema.safeParse(lang).success).toBe(true);
    }
  });

  it("rejects unknown language", () => {
    expect(LanguageSchema.safeParse("go").success).toBe(false);
  });
});

describe("HealthCheckInputSchema", () => {
  it("accepts empty object", () => {
    expect(HealthCheckInputSchema.safeParse({}).success).toBe(true);
  });

  it("rejects extra fields (strict)", () => {
    expect(
      HealthCheckInputSchema.safeParse({ extra: "field" }).success,
    ).toBe(false);
  });
});

describe("IndexCodebaseInputSchema", () => {
  it("accepts valid input with defaults", () => {
    const result = IndexCodebaseInputSchema.safeParse({
      path: "/some/path",
      outputDir: "/out",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.language).toBe("auto"); // default
    }
  });

  it("rejects missing required fields", () => {
    expect(
      IndexCodebaseInputSchema.safeParse({ outputDir: "/out" }).success,
    ).toBe(false);
  });
});

describe("NotFoundOutputSchema", () => {
  it("accepts a valid not-found response", () => {
    const result = NotFoundOutputSchema.safeParse({
      status: "error",
      reason: "symbol_not_found",
      didYouMean: ["Foo::bar"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects wrong reason string", () => {
    expect(
      NotFoundOutputSchema.safeParse({
        status: "error",
        reason: "other_reason",
        didYouMean: [],
      }).success,
    ).toBe(false);
  });
});

describe("GetSymbolOutputSchema", () => {
  it("accepts a valid get_symbol success response", () => {
    const result = GetSymbolOutputSchema.safeParse({
      node: { id: "Foo::bar" },
      edgesOut: [],
      edgesIn: [],
    });
    expect(result.success).toBe(true);
  });
});

describe("LspResolveInputSchema", () => {
  it("accepts minimal valid input", () => {
    const result = LspResolveInputSchema.safeParse({
      graphPath: "/g.db",
      codebasePath: "/code",
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional lspCommand", () => {
    const result = LspResolveInputSchema.safeParse({
      graphPath: "/g.db",
      codebasePath: "/code",
      lspCommand: "/usr/bin/rust-analyzer",
      timeoutMs: 30000,
    });
    expect(result.success).toBe(true);
  });
});

describe("Typed errors", () => {
  it("CodebaseValidationError has correct name and fields", () => {
    const err = new CodebaseValidationError("msg", "reason", { raw: true });
    expect(err.name).toBe("CodebaseValidationError");
    expect(err.reason).toBe("reason");
    expect(err.raw).toEqual({ raw: true });
    expect(err).toBeInstanceOf(Error);
  });

  it("CodebaseTimeoutError has correct name and fields", () => {
    const err = new CodebaseTimeoutError("index_codebase", 60000);
    expect(err.name).toBe("CodebaseTimeoutError");
    expect(err.method).toBe("index_codebase");
    expect(err.timeoutMs).toBe(60000);
    expect(err.message).toMatch(/60000ms/);
  });

  it("CodebaseSubprocessError has correct name", () => {
    const err = new CodebaseSubprocessError("process crashed", -1);
    expect(err.name).toBe("CodebaseSubprocessError");
    expect(err.code).toBe(-1);
  });

  it("CodebaseLspError carries reason and optional allowed list", () => {
    const err = new CodebaseLspError(
      "not allowed",
      "lsp_command_not_allowed",
      ["rust-analyzer"],
    );
    expect(err.name).toBe("CodebaseLspError");
    expect(err.reason).toBe("lsp_command_not_allowed");
    expect(err.allowed).toContain("rust-analyzer");
  });

  it("CodebaseLspError without allowed is valid", () => {
    const err = new CodebaseLspError("not found", "lsp_not_found");
    expect(err.allowed).toBeUndefined();
  });
});
