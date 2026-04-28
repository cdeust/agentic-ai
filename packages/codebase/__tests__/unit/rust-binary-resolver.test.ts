/**
 * Unit tests for adapters/rust-binary-resolver.ts
 *
 * Tests the resolution priority order: AI_ARCH_BIN > workspace package > null.
 *
 * source: docs/PHASE_3_PLAN.md §2.3 — binary-path helper
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import type * as nodeFsType from "node:fs";
import type * as nodeModuleType from "node:module";

// Mock node:fs so we can control existsSync without real filesystem access.
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof nodeFsType>();
  return {
    ...original,
    existsSync: vi.fn(original.existsSync),
  };
});

// Mock node:module to control require.resolve for the workspace package.
vi.mock("node:module", async (importOriginal) => {
  const original = await importOriginal<typeof nodeModuleType>();
  return {
    ...original,
    createRequire: vi.fn(() => ({
      resolve: vi.fn(() => {
        throw new Error("Cannot find module '@agentic/codebase-rust/package.json'");
      }),
    })),
  };
});

describe("resolveBinaryPath", () => {
  const savedEnv = process.env["AI_ARCH_BIN"];

  afterEach(() => {
    vi.resetAllMocks();
    if (savedEnv === undefined) {
      delete process.env["AI_ARCH_BIN"];
    } else {
      process.env["AI_ARCH_BIN"] = savedEnv;
    }
  });

  it("returns AI_ARCH_BIN path when set and file exists", async () => {
    const { existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(true);

    process.env["AI_ARCH_BIN"] = "/explicit/path/ai-architect-mcp";
    const { resolveBinaryPath } = await import(
      "../../src/adapters/rust-binary-resolver.js"
    );

    expect(resolveBinaryPath()).toBe("/explicit/path/ai-architect-mcp");
  });

  it("returns null when AI_ARCH_BIN file does not exist", async () => {
    const { existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(false);

    process.env["AI_ARCH_BIN"] = "/nonexistent/ai-architect-mcp";
    const { resolveBinaryPath } = await import(
      "../../src/adapters/rust-binary-resolver.js"
    );

    expect(resolveBinaryPath()).toBeNull();
  });

  it("returns null when no binary source is available", async () => {
    const { existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(false);

    delete process.env["AI_ARCH_BIN"];
    const { resolveBinaryPath } = await import(
      "../../src/adapters/rust-binary-resolver.js"
    );

    expect(resolveBinaryPath()).toBeNull();
  });

  it("requireBinaryPath throws with diagnostic message when binary absent", async () => {
    const { existsSync } = await import("node:fs");
    vi.mocked(existsSync).mockReturnValue(false);

    delete process.env["AI_ARCH_BIN"];
    const { requireBinaryPath } = await import(
      "../../src/adapters/rust-binary-resolver.js"
    );

    expect(() => requireBinaryPath()).toThrowError(/ai-architect-mcp binary not found/);
    expect(() => requireBinaryPath()).toThrowError(/PR #18/);
  });
});
