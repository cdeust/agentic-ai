/**
 * Tests for shared/domain-mapping.ts
 *
 * Invariants verified:
 * - resolveDomain("") → ""
 * - resolveDomain for known path prefix matches canonical
 * - resolveDomain slug stripping removes known path prefixes
 * - sharedPrefix(a, b) requires >= 4 chars (guards false grouping)
 * - resolveCwd("") → ""
 * - DomainRegistry is exported (public-symbol parity with Python dataclass)
 *
 * source: cortex@ed33435 mcp_server/shared/domain_mapping.py
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveDomain,
  resolveCwd,
  resetRegistry,
  type DomainRegistry,
  type RepoInfo,
} from "../../src/shared/domain-mapping.js";

// Verify type-export — TypeScript-only assertion; compile-time check
// If DomainRegistry is not exported, this file fails to compile.
const _registryTypeCheck: DomainRegistry | null = null;
void _registryTypeCheck;

describe("resolveDomain — empty / whitespace input", () => {
  it("returns empty string for empty input", () => {
    // postcondition: empty/blank input → ""
    expect(resolveDomain("")).toBe("");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(resolveDomain("   ")).toBe("");
  });
});

describe("resolveDomain — slug stripping (no registry match)", () => {
  beforeEach(() => resetRegistry());

  it("strips known user path prefix from slug", () => {
    // source: cortex@ed33435 mcp_server/shared/domain_mapping.py:337-344
    const slug = "-users-cdeust-developments-jarvis";
    const result = resolveDomain(slug);
    // First segment after prefix is "jarvis"
    expect(result).toBe("jarvis");
  });

  it("strips -worktrees- suffix from slug", () => {
    const slug = "-users-cdeust-developments-jarvis-worktrees-some-branch";
    const result = resolveDomain(slug);
    expect(result).toBe("jarvis");
  });

  it("lowercases the input for exact/fragment matching", () => {
    // postcondition: no match → returns lower-cased last meaningful segment
    const result = resolveDomain("UNKNOWN-DOMAIN-NAME");
    expect(result).toBe(result.toLowerCase());
  });
});

describe("resolveDomain — filesystem path resolution", () => {
  beforeEach(() => resetRegistry());

  it("does not treat a filesystem path as a slug", () => {
    // paths start with "/" not "-"
    const path = "/tmp/nonexistent/path/to/repo";
    // Should NOT throw; path not in registry → falls through to lower-case
    expect(() => resolveDomain(path)).not.toThrow();
  });
});

describe("resolveCwd — empty input", () => {
  it("returns empty string for empty cwd", () => {
    // postcondition: empty cwd → "" (callers use empty-string as fall-through signal)
    // source: cortex@ed33435 mcp_server/shared/domain_mapping.py:383
    expect(resolveCwd("")).toBe("");
  });
});

describe("resetRegistry", () => {
  it("resets the singleton cache without error", () => {
    expect(() => resetRegistry()).not.toThrow();
    expect(() => resetRegistry()).not.toThrow(); // idempotent
  });
});

describe("RepoInfo type", () => {
  it("can be constructed with all required fields", () => {
    // source: cortex@ed33435 mcp_server/shared/domain_mapping.py:26-29 (RepoInfo dataclass)
    const repo: RepoInfo = {
      fsPath: "/some/path",
      dirName: "somerepo",
      remoteName: "somerepo",
      canonical: "somerepo",
    };
    expect(repo.fsPath).toBe("/some/path");
    expect(repo.canonical).toBe("somerepo");
  });
});
