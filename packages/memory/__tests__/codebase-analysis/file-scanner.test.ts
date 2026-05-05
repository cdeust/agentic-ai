/**
 * file-scanner.test.ts — unit tests for the file scanner stages.
 *
 * Tests use the temp filesystem from vitest's tmpdir utility to avoid
 * touching real project files.
 *
 * source: cortex@ed33435 mcp_server/handlers/seed_project_stages.py
 * source: packages/memory/src/codebase-analysis/file-scanner.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, beforeAll } from "vitest";
import {
  collectAllDiscoveries,
  heatForTags,
  stageConfigs,
  stageDocs,
  stageEntryPoints,
  stageCicd,
  stageStructuralSummary,
  HEAT_BY_TYPE,
} from "../../src/codebase-analysis/file-scanner.js";

// ── Test fixture ──────────────────────────────────────────────────────────────

let testRoot: string;

beforeAll(() => {
  // Create a minimal project fixture in temp dir
  // source: cortex@ed33435 mcp_server/handlers/seed_project_constants.py
  testRoot = join(tmpdir(), `scanner-test-${Date.now()}`);
  mkdirSync(testRoot, { recursive: true });

  // Config file
  writeFileSync(join(testRoot, "package.json"), JSON.stringify({ name: "test-project" }));

  // README
  writeFileSync(join(testRoot, "README.md"), "# Test Project\n\nThis is a test.");

  // Entry point
  writeFileSync(join(testRoot, "index.ts"), 'export const hello = "world";');

  // CI
  mkdirSync(join(testRoot, ".github", "workflows"), { recursive: true });
  writeFileSync(join(testRoot, ".github", "workflows", "ci.yml"), "name: CI\non: push:\njobs: {}");
  writeFileSync(join(testRoot, "Makefile"), "build:\n\techo building");

  // Source files for language detection
  mkdirSync(join(testRoot, "src"), { recursive: true });
  writeFileSync(join(testRoot, "src", "foo.ts"), "const x = 1;");
  writeFileSync(join(testRoot, "src", "bar.ts"), "const y = 2;");

  // Ignored directory (should not be walked)
  mkdirSync(join(testRoot, "node_modules", "pkg"), { recursive: true });
  writeFileSync(join(testRoot, "node_modules", "pkg", "index.ts"), "// should be ignored");
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("heatForTags", () => {
  it("returns structural_summary heat for project-structure tag", () => {
    expect(heatForTags(["project-structure"])).toBe(HEAT_BY_TYPE["structural_summary"]);
  });

  it("returns documentation heat for documentation tag", () => {
    expect(heatForTags(["documentation"])).toBe(HEAT_BY_TYPE["documentation"]);
  });

  it("returns entry_point heat for entry-point tag", () => {
    expect(heatForTags(["entry-point"])).toBe(HEAT_BY_TYPE["entry_point"]);
  });

  it("returns config heat for config tag", () => {
    expect(heatForTags(["config", "project-setup"])).toBe(HEAT_BY_TYPE["config"]);
  });

  it("returns ci_cd heat for ci-cd tag", () => {
    expect(heatForTags(["ci-cd", "devops"])).toBe(HEAT_BY_TYPE["ci_cd"]);
  });

  it("returns 0.7 for unknown tags", () => {
    expect(heatForTags(["seeded"])).toBe(0.7);
  });
});

describe("stageStructuralSummary", () => {
  it("returns a discovery with project-structure tag", () => {
    const disc = stageStructuralSummary(testRoot);
    expect(disc.tags).toContain("project-structure");
    expect(disc.tags).toContain("architecture");
    expect(disc.content).toContain("# Project structure:");
  });

  it("detects TypeScript as a language", () => {
    const disc = stageStructuralSummary(testRoot);
    expect(disc.content).toContain("TypeScript");
  });
});

describe("stageConfigs", () => {
  it("detects package.json", () => {
    const discoveries = stageConfigs(testRoot, 65536);
    const packageDisc = discoveries.find((d) => d.title.includes("package.json"));
    expect(packageDisc).toBeDefined();
    expect(packageDisc!.tags).toContain("config");
    expect(packageDisc!.content).toContain("test-project");
  });
});

describe("stageDocs", () => {
  it("detects README.md", () => {
    const discoveries = stageDocs(testRoot, 65536);
    const readmeDisc = discoveries.find((d) => d.title.includes("README"));
    expect(readmeDisc).toBeDefined();
    expect(readmeDisc!.tags).toContain("documentation");
  });
});

describe("stageEntryPoints", () => {
  it("detects index.ts as entry point", () => {
    const discoveries = stageEntryPoints(testRoot, 65536);
    const entryDisc = discoveries.find((d) => d.title.includes("index.ts"));
    expect(entryDisc).toBeDefined();
    expect(entryDisc!.tags).toContain("entry-point");
  });

  it("does not include files from node_modules", () => {
    const discoveries = stageEntryPoints(testRoot, 65536);
    const nodeModulesDisc = discoveries.find((d) => d.content.includes("should be ignored"));
    expect(nodeModulesDisc).toBeUndefined();
  });
});

describe("stageCicd", () => {
  it("detects CI/CD from .github/workflows", () => {
    const discoveries = stageCicd(testRoot);
    const ciDisc = discoveries.find((d) => d.tags.includes("ci-cd"));
    expect(ciDisc).toBeDefined();
  });

  it("detects Makefile", () => {
    const discoveries = stageCicd(testRoot);
    const makeDisc = discoveries.find((d) => d.title.includes("Makefile"));
    expect(makeDisc).toBeDefined();
  });
});

describe("collectAllDiscoveries", () => {
  it("starts with structural summary", () => {
    const discoveries = collectAllDiscoveries(testRoot, 65536);
    expect(discoveries.length).toBeGreaterThan(0);
    expect(discoveries[0]!.tags).toContain("project-structure");
  });

  it("includes all stage types", () => {
    const discoveries = collectAllDiscoveries(testRoot, 65536);
    const hasConfig = discoveries.some((d) => d.tags.includes("config"));
    const hasDocs = discoveries.some((d) => d.tags.includes("documentation"));
    const hasEntry = discoveries.some((d) => d.tags.includes("entry-point"));
    const hasCicd = discoveries.some((d) => d.tags.includes("ci-cd"));
    expect(hasConfig).toBe(true);
    expect(hasDocs).toBe(true);
    expect(hasEntry).toBe(true);
    expect(hasCicd).toBe(true);
  });

  it("returns empty-ish for non-existent directory", () => {
    // stageStructuralSummary still runs (just with no layout), but other stages are empty
    const discoveries = collectAllDiscoveries("/nonexistent/path/xyz/12345", 65536);
    // Structural summary is always returned
    expect(discoveries.length).toBeGreaterThanOrEqual(1);
  });
});
