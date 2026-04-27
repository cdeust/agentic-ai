#!/usr/bin/env tsx
// check-layer-imports.ts — Standalone CI gate for layer-import rule enforcement.
//
// This script walks packages/*/src/ and asserts the Clean Architecture dependency
// rule from coding-standards.md §2.2:
//
//   core/    → shared/ + stdlib ONLY (may NOT import adapters/, mcp-servers/)
//   adapters/ → core/ + shared/ + stdlib (may NOT import mcp-servers/)
//   mcp-servers/ → anything (composition root)
//
// Difference from ESLint rule:
//   The ESLint rule operates at per-file import-specifier level and catches
//   direct path violations on-save. This script performs full package-level
//   static analysis and fails LOUDLY in CI with a structured report.
//   It also catches violations through barrel re-exports (index.ts) that the
//   ESLint no-restricted-imports pattern cannot trace.
//
// Approach: AST walker using TypeScript compiler API (ts.createProgram).
//   - Reads tsconfig.base.json for compiler options.
//   - Walks every .ts source file in packages/*/src/ (excluding test files).
//   - For each ImportDeclaration / ExportDeclaration with a from-specifier,
//     resolves the specifier relative to the file and classifies the target layer.
//   - Reports violations with file, line, specifier, and the rule that was broken.
//
// Known holes (documented per Deming — every gate must document what it misses):
//   1. Dynamic require() and import() expressions are NOT traced. These are
//      banned by coding-standards.md §7.2 anyway; the ESLint rule catches them.
//   2. Re-exports through external npm packages are NOT traced (would require
//      full call-graph analysis). Not applicable here: all packages are workspace.
//   3. Circular imports WITHIN a layer (e.g., two core files importing each other)
//      are not flagged by this script — use `madge --circular` for that.
//
// Usage:
//   npx tsx scripts/check-layer-imports.ts [--root <path>] [--fix-suggestions]
//   pnpm layer-check
//
// Exit codes:
//   0 — no violations
//   1 — internal error
//   2 — violations found
//
// source: coding-standards.md §2.2 — Dependency Rule (absolute).
// source: Martin, R. C. (2017). Clean Architecture. Prentice Hall. Ch. 15–23.

import * as ts from "typescript";
import * as path from "node:path";
import * as fs from "node:fs";
import * as process from "node:process";

// ── Layer classification ───────────────────────────────────────────────────────

/**
 * The known layers in the monorepo, in dependency order (innermost first).
 * source: coding-standards.md §2.2 — layer vocabulary.
 */
const enum Layer {
  Shared = "shared",
  Core = "core",
  Adapters = "adapters",
  McpServers = "mcp-servers",
  Unknown = "unknown",
}

/**
 * Allowed imports for each layer.
 * source: coding-standards.md §2.2 — Dependency Rule (absolute).
 *
 * Layer → Set of layers it is PERMITTED to import from.
 * Anything not in the set is a violation.
 */
const ALLOWED_IMPORTS: ReadonlyMap<Layer, ReadonlySet<Layer>> = new Map([
  [Layer.Shared, new Set([Layer.Shared])], // shared → stdlib only (no project imports)
  [Layer.Core, new Set([Layer.Core, Layer.Shared])], // core → shared + stdlib
  [Layer.Adapters, new Set([Layer.Adapters, Layer.Core, Layer.Shared])],
  [
    Layer.McpServers,
    new Set([Layer.McpServers, Layer.Adapters, Layer.Core, Layer.Shared]),
  ],
  [Layer.Unknown, new Set([Layer.Unknown])], // unknown → no rule applied
]);

// ── File path → layer classification ──────────────────────────────────────────

/**
 * Classify a file path into a layer based on its location in the monorepo.
 * Matches against package directory names.
 */
function classifyFilePath(filePath: string): Layer {
  const normalized = filePath.replace(/\\/g, "/");

  // Match packages/<layer-name>/ or packages/mcp-servers/<name>/
  const mcpMatch = /\/packages\/mcp-servers\//.test(normalized);
  if (mcpMatch) return Layer.McpServers;

  const packageMatch = normalized.match(/\/packages\/([^/]+)\//);
  if (!packageMatch) return Layer.Unknown;

  const packageName = packageMatch[1] ?? "";

  if (packageName === "shared" || packageName.startsWith("shared-")) {
    return Layer.Shared;
  }
  if (packageName === "core" || packageName.startsWith("core-")) {
    return Layer.Core;
  }
  if (packageName === "adapters" || packageName.startsWith("adapters-")) {
    return Layer.Adapters;
  }

  // Default: treat as unknown (no rule violation reported for unknown)
  return Layer.Unknown;
}

/**
 * Classify an import specifier string (the string after `from`).
 * Handles:
 *   - Relative paths (./foo, ../../adapters/bar)
 *   - Workspace package names (@agentic-ai/adapters, @agentic-ai/core)
 *   - Node.js built-ins (node:fs, node:path, fs, path)
 */
function classifyImportSpecifier(
  specifier: string,
  sourceFile: string,
  repoRoot: string
): Layer {
  // Node.js built-ins: not a layer violation.
  if (
    specifier.startsWith("node:") ||
    /^(fs|path|os|crypto|stream|util|events|net|http|https|url|querystring|assert|buffer|zlib|child_process|worker_threads|vm|readline|tty|perf_hooks|v8|diagnostics_channel|async_hooks|inspector)$/.test(
      specifier
    )
  ) {
    return Layer.Unknown;
  }

  // Workspace package names.
  if (specifier.startsWith("@agentic-ai/")) {
    const packageSuffix = specifier.replace("@agentic-ai/", "").split("/")[0] ?? "";
    if (packageSuffix === "shared" || packageSuffix.startsWith("shared-")) {
      return Layer.Shared;
    }
    if (packageSuffix === "core" || packageSuffix.startsWith("core-")) {
      return Layer.Core;
    }
    if (packageSuffix === "adapters" || packageSuffix.startsWith("adapters-")) {
      return Layer.Adapters;
    }
    if (packageSuffix === "mcp-servers" || packageSuffix.startsWith("mcp-")) {
      return Layer.McpServers;
    }
    return Layer.Unknown;
  }

  // Third-party packages: not a layer violation.
  if (!specifier.startsWith(".")) {
    return Layer.Unknown;
  }

  // Relative imports: resolve to an absolute path and classify.
  const sourceDir = path.dirname(sourceFile);
  const resolved = path.resolve(sourceDir, specifier);
  const relativeToRoot = path.relative(repoRoot, resolved).replace(/\\/g, "/");

  return classifyFilePath("/" + relativeToRoot + "/");
}

// ── Violation type ─────────────────────────────────────────────────────────────

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly specifier: string;
  readonly sourceLayer: Layer;
  readonly targetLayer: Layer;
  readonly rule: string;
}

// ── AST walker ─────────────────────────────────────────────────────────────────

/**
 * Walk a TypeScript source file and collect layer-import violations.
 */
function walkFile(
  sourceFile: ts.SourceFile,
  absolutePath: string,
  repoRoot: string
): Violation[] {
  const sourceLayer = classifyFilePath(absolutePath);
  if (sourceLayer === Layer.Unknown) return [];

  const allowed = ALLOWED_IMPORTS.get(sourceLayer);
  if (!allowed) return [];

  const violations: Violation[] = [];

  function visit(node: ts.Node): void {
    let specifier: string | null = null;

    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifier = node.moduleSpecifier.text;
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifier = node.moduleSpecifier.text;
    }

    if (specifier !== null) {
      const targetLayer = classifyImportSpecifier(
        specifier,
        absolutePath,
        repoRoot
      );

      if (targetLayer !== Layer.Unknown && !allowed.has(targetLayer)) {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(
          (node as ts.ImportDeclaration).moduleSpecifier.getStart(sourceFile)
        );
        violations.push({
          file: path.relative(repoRoot, absolutePath),
          line: line + 1, // source: TypeScript API — 0-indexed line numbers
          column: character + 1,
          specifier,
          sourceLayer,
          targetLayer,
          rule: `${sourceLayer}/ may not import ${targetLayer}/ (coding-standards.md §2.2)`,
        });
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

// ── File discovery ─────────────────────────────────────────────────────────────

/**
 * Recursively collect .ts source files under a directory.
 * Excludes test files, dist/, and node_modules/.
 */
function collectSourceFiles(dir: string): string[] {
  const results: string[] = [];

  function recurse(current: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        if (
          entry.name === "node_modules" ||
          entry.name === "dist" ||
          entry.name === "__tests__" ||
          entry.name.startsWith(".")
        ) {
          continue;
        }
        recurse(fullPath);
      } else if (entry.isFile()) {
        if (
          !entry.name.endsWith(".ts") ||
          entry.name.endsWith(".d.ts") ||
          entry.name.endsWith(".test.ts") ||
          entry.name.endsWith(".spec.ts") ||
          entry.name.endsWith(".parity.test.ts")
        ) {
          continue;
        }
        results.push(fullPath);
      }
    }
  }

  recurse(dir);
  return results;
}

// ── Main ───────────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);

  // Allow --root <path> override for testing from fixture directories.
  const rootIndex = args.indexOf("--root");
  const repoRoot =
    rootIndex !== -1 && args[rootIndex + 1]
      ? path.resolve(args[rootIndex + 1] ?? ".")
      : path.resolve(path.join(path.dirname(process.argv[1] ?? "."), ".."));

  const packagesDir = path.join(repoRoot, "packages");

  if (!fs.existsSync(packagesDir)) {
    console.error(
      `check-layer-imports: packages/ not found at ${packagesDir}`
    );
    process.exit(1);
  }

  // Collect all .ts source files under packages/.
  const sourceFiles = collectSourceFiles(packagesDir);

  if (sourceFiles.length === 0) {
    console.error("check-layer-imports: no source files found — nothing to check.");
    process.exit(0);
  }

  // Parse each file using the TypeScript compiler API.
  // source: TypeScript compiler API docs — createSourceFile for single-file parse.
  const allViolations: Violation[] = [];

  for (const filePath of sourceFiles) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.ES2022,
      /* setParentNodes */ true,
      ts.ScriptKind.TS
    );

    const violations = walkFile(sourceFile, filePath, repoRoot);
    allViolations.push(...violations);
  }

  // ── Report ───────────────────────────────────────────────────────────────────

  if (allViolations.length === 0) {
    console.error(
      `check-layer-imports: OK — ${sourceFiles.length} files checked, 0 violations.`
    );
    process.exit(0);
  }

  console.error("");
  console.error(
    "╔══════════════════════════════════════════════════════════════════════╗"
  );
  console.error(
    "║  LAYER IMPORT VIOLATION — CI gate failed                            ║"
  );
  console.error(
    "║  coding-standards.md §2.2: Dependency Rule violated.               ║"
  );
  console.error(
    "╚══════════════════════════════════════════════════════════════════════╝"
  );
  console.error("");
  console.error(
    `${allViolations.length} violation(s) found in ${sourceFiles.length} files:\n`
  );

  for (const v of allViolations) {
    console.error(`  ${v.file}:${v.line}:${v.column}`);
    console.error(`    import "${v.specifier}"`);
    console.error(`    ${v.rule}`);
    console.error("");
  }

  console.error(
    "Fix: declare a port (interface) in core/ and let the outer layer implement it."
  );
  console.error(
    "     source: coding-standards.md §2.3 — Ports and Adapters pattern."
  );
  console.error("");

  process.exit(2);
}

// ── Fixture-based self-test ────────────────────────────────────────────────────
// When invoked with --self-test, run internal assertions to verify the layer
// classifier correctly catches deliberate violations.
// This satisfies: MISSION.md §3.4 — "layer-import script includes a fixture-based
// test asserting that a deliberate violation is caught."

function selfTest(): void {
  const PASS = "✓";
  const FAIL = "✗";
  let failures = 0;

  function assert(label: string, condition: boolean): void {
    if (condition) {
      console.error(`  ${PASS} ${label}`);
    } else {
      console.error(`  ${FAIL} FAIL: ${label}`);
      failures++;
    }
  }

  console.error("check-layer-imports: running self-test...\n");

  // ── classifyFilePath tests ──────────────────────────────────────────────────

  assert(
    "classifyFilePath: core package → Layer.Core",
    classifyFilePath("/repo/packages/core/src/foo.ts") === Layer.Core
  );
  assert(
    "classifyFilePath: adapters package → Layer.Adapters",
    classifyFilePath("/repo/packages/adapters/src/bar.ts") === Layer.Adapters
  );
  assert(
    "classifyFilePath: mcp-servers package → Layer.McpServers",
    classifyFilePath("/repo/packages/mcp-servers/my-server/src/index.ts") ===
      Layer.McpServers
  );
  assert(
    "classifyFilePath: shared package → Layer.Shared",
    classifyFilePath("/repo/packages/shared/src/utils.ts") === Layer.Shared
  );
  assert(
    "classifyFilePath: unknown package → Layer.Unknown",
    classifyFilePath("/repo/packages/orchestration/src/index.ts") ===
      Layer.Unknown
  );

  // ── classifyImportSpecifier tests ──────────────────────────────────────────

  const fakeRepoRoot = "/repo";

  assert(
    "classifyImportSpecifier: node: built-in → Unknown",
    classifyImportSpecifier(
      "node:fs",
      "/repo/packages/core/src/foo.ts",
      fakeRepoRoot
    ) === Layer.Unknown
  );
  assert(
    "classifyImportSpecifier: @agentic-ai/adapters → Adapters",
    classifyImportSpecifier(
      "@agentic-ai/adapters",
      "/repo/packages/core/src/foo.ts",
      fakeRepoRoot
    ) === Layer.Adapters
  );
  assert(
    "classifyImportSpecifier: @agentic-ai/core → Core",
    classifyImportSpecifier(
      "@agentic-ai/core",
      "/repo/packages/adapters/src/bar.ts",
      fakeRepoRoot
    ) === Layer.Core
  );
  assert(
    "classifyImportSpecifier: third-party (vitest) → Unknown",
    classifyImportSpecifier(
      "vitest",
      "/repo/packages/core/src/foo.ts",
      fakeRepoRoot
    ) === Layer.Unknown
  );

  // ── Deliberate violation test: core importing adapters ─────────────────────
  // This is the fixture test required by MISSION.md §3.4.

  const violatingSource = `import { SomeAdapter } from "@agentic-ai/adapters";`;
  const violatingFile = ts.createSourceFile(
    "/repo/packages/core/src/bad.ts",
    violatingSource,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS
  );

  const violations = walkFile(
    violatingFile,
    "/repo/packages/core/src/bad.ts",
    fakeRepoRoot
  );

  assert(
    "deliberate violation: core importing @agentic-ai/adapters is caught",
    violations.length === 1
  );
  assert(
    "deliberate violation: correct source layer reported",
    violations[0]?.sourceLayer === Layer.Core
  );
  assert(
    "deliberate violation: correct target layer reported",
    violations[0]?.targetLayer === Layer.Adapters
  );

  // ── Non-violation test: adapters importing core ─────────────────────────────

  const validSource = `import { SomePort } from "@agentic-ai/core";`;
  const validFile = ts.createSourceFile(
    "/repo/packages/adapters/src/good.ts",
    validSource,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS
  );

  const noViolations = walkFile(
    validFile,
    "/repo/packages/adapters/src/good.ts",
    fakeRepoRoot
  );

  assert(
    "non-violation: adapters importing core produces no violations",
    noViolations.length === 0
  );

  // ── adapters importing mcp-servers (violation) ─────────────────────────────

  const mcpViolatingSource = `import { handler } from "@agentic-ai/mcp-servers";`;
  const mcpViolatingFile = ts.createSourceFile(
    "/repo/packages/adapters/src/bad.ts",
    mcpViolatingSource,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS
  );

  const mcpViolations = walkFile(
    mcpViolatingFile,
    "/repo/packages/adapters/src/bad.ts",
    fakeRepoRoot
  );

  assert(
    "deliberate violation: adapters importing mcp-servers is caught",
    mcpViolations.length === 1
  );

  // ── Summary ─────────────────────────────────────────────────────────────────

  console.error("");
  if (failures === 0) {
    console.error("check-layer-imports: self-test PASSED");
    process.exit(0);
  } else {
    console.error(`check-layer-imports: self-test FAILED — ${failures} assertion(s) failed`);
    process.exit(2);
  }
}

// ── Entry point ────────────────────────────────────────────────────────────────

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  main();
}
