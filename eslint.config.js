// eslint.config.js — ESLint v9 flat config for the agentic-ai monorepo.
//
// Layer-import rule source: coding-standards.md §2.2 (Clean Architecture dependency rule).
// Martin, R. C. (2017). Clean Architecture. Prentice Hall. Chapters 15–23.
//
// File-size limit source: coding-standards.md §4.1 — 500 lines max.
//
// Rule: core/ → shared/ + stdlib ONLY.
//       core/ may NOT import from adapters/, mcp-servers/, or sibling packages.
//       adapters/ may NOT import from mcp-servers/.
//       mcp-servers/ is the sole composition root; it may import everything.
//
// Enforcement is ALSO performed by scripts/check-layer-imports.ts in CI as a
// louder gate. This ESLint rule provides on-save feedback in editors.

import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

/** @type {import("eslint").Linter.Config[]} */
const config = [
  // ── Global ignores ────────────────────────────────────────────────────────
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/*.js.map",
      "**/*.d.ts",
      "pnpm-lock.yaml",
      // Generated / auto-built artefacts — do not lint.
      "mcp-server/index.js",
      // Compiled bundle — 80 K-line esbuild output; not source.
      // source: §4.1 auto-generated exemption: this file has no // auto-generated
      // marker but is a binary-equivalent output of `esbuild` — treating it as
      // auto-generated and excluding from lint to avoid false rule-not-found errors.
      "packages/prd-pipeline/mcp-server/index.js",
      // Template file — sits outside every tsconfig; used as docs scaffolding only.
      "docs/vitest.config.template.ts",
      // Rust test fixture — TypeScript file inside a Cargo workspace; not part of
      // any TS project. source: codebase-rust is a Rust crate, not a TS package.
      "packages/codebase-rust/tests/**",
    ],
  },

  // ── File-size limit (all source files) ────────────────────────────────────
  // source: coding-standards.md §4.1 — files must not exceed 500 lines.
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.js"],
    ignores: ["**/dist/**", "**/node_modules/**"],
    rules: {
      "max-lines": [
        "warn",
        { max: 500, skipBlankLines: true, skipComments: true },
      ],
    },
  },

  // ── TypeScript files ───────────────────────────────────────────────────────
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        projectService: {
          // allowDefaultProject lets test files that are excluded from the
          // package tsconfig.json still be parsed by the TypeScript project
          // service. Test files are excluded from tsconfig to keep compiled
          // output clean, but ESLint still needs to type-check them.
          // source: @typescript-eslint docs §projectService.allowDefaultProject
          allowDefaultProject: [
            "packages/*/__tests__/*.ts",
            "packages/*/__tests__/*/*.ts",
            "packages/*/__tests__/*/*/*.ts",
            "packages/*/vitest.config.ts",
            // source: packages/mcp-servers/memory/vitest.config.ts + src/__tests__/ added for Eng-17 doctor tests
            "packages/mcp-servers/*/vitest.config.ts",
            "packages/mcp-servers/*/src/__tests__/*.ts",
            "packages/mcp-servers/*/src/__tests__/*/*.ts",
            // Nested prd-pipeline sub-packages — tests excluded from their tsconfig
            // (benchmark, ecosystem-adapters, orchestration, verification) need
            // allowDefaultProject because their tsconfig has explicit excludes.
            // Packages whose tsconfig does NOT exclude test files (mcp-server, core,
            // meta-prompting, validation, strategy) must NOT be listed here — they
            // are already found by the project service and double-registration errors.
            //
            // benchmark: "exclude": ["src/**/__tests__/**", "calibration/**/__tests__/**"]
            "packages/prd-pipeline/packages/benchmark/src/__tests__/*.ts",
            "packages/prd-pipeline/packages/benchmark/calibration/__tests__/*.ts",
            "packages/prd-pipeline/packages/benchmark/vitest.config.ts",
            // ecosystem-adapters: "exclude": ["src/**/__tests__/**"]
            "packages/prd-pipeline/packages/ecosystem-adapters/src/__tests__/*.ts",
            "packages/prd-pipeline/packages/ecosystem-adapters/vitest.config.ts",
            // orchestration: "exclude": ["src/**/__tests__/**"]
            "packages/prd-pipeline/packages/orchestration/src/__tests__/*.ts",
            "packages/prd-pipeline/packages/orchestration/vitest.config.ts",
            // verification: "exclude": ["src/**/__tests__/**"]
            "packages/prd-pipeline/packages/verification/src/__tests__/*.ts",
            "packages/prd-pipeline/packages/verification/vitest.config.ts",
            // Remaining vitest configs (not tests) for packages whose tests are in tsconfig
            "packages/prd-pipeline/packages/mcp-server/vitest.config.ts",
            "packages/prd-pipeline/packages/core/vitest.config.ts",
            "packages/prd-pipeline/packages/meta-prompting/vitest.config.ts",
            "packages/prd-pipeline/packages/validation/vitest.config.ts",
            "packages/prd-pipeline/packages/strategy/vitest.config.ts",
            // memory-dashboard and parity-runner test files added in PR #77 / #79.
            "packages/memory-dashboard/__tests__/*.ts",
            "packages/parity-runner/src/__tests__/*.ts",
            // Root-level config and script files — outside all package tsconfigs.
            // Note: allowDefaultProject does not support '**' glob — only flat patterns.
            // source: @typescript-eslint docs §allowDefaultProject restrictions.
            "vitest.config.ts",
            "scripts/*.ts",
            // Parity oracle test and config files — live outside packages/.
            "parity-oracle/*.ts",
            "parity-oracle/cortex/*.ts",
            "parity-oracle/codebase/*.ts",
            "parity-oracle/prd/*.ts",
          ],
          // Raised from 25 to 400 to accommodate the full test suite:
          //   198 files matched existing globs + ~100 from new prd-pipeline globs
          //   above + headroom for further test additions.
          // Measured count: ~300 files across all glob patterns (2026-05-06).
          // source: @typescript-eslint docs §maximumDefaultProjectFileMatchCount
          // source: measured glob count 2026-05-06, worktree lint-and-standards-2026-05-06
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 400,
        },
        tsconfigRootDir: import.meta.dirname,
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      // ── TypeScript strict recommended ──────────────────────────────────────
      // source: @typescript-eslint/eslint-plugin README — "strict" preset.
      ...tseslint.configs["strict"].rules,

      // ── Unused variables ───────────────────────────────────────────────────
      // Catches dead code at authoring time, not at code-review time.
      "no-unused-vars": "off", // disabled in favour of TS-aware version below
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // ── Console usage ──────────────────────────────────────────────────────
      // Warn on all console.* calls except console.error, which is acceptable
      // in CLI and server-error paths.
      "no-console": ["warn", { allow: ["error"] }],

      // ── Layer-import rule ──────────────────────────────────────────────────
      // source: coding-standards.md §2.2 — Dependency Rule (absolute).
      //
      // core/ → shared/ + stdlib ONLY.
      // core/ may NOT import: adapters/, mcp-servers/, or any workspace package
      // that is not @agentic-ai/shared or a Node.js built-in.
      //
      // adapters/ may NOT import mcp-servers/ (adapters are not the composition root).
      //
      // Pattern strategy: match import specifiers that resolve to the forbidden
      // layers. Both relative (../../adapters) and workspace-package
      // (@agentic-ai/adapters) forms are covered.
      //
      // Known limitation: barrel re-exports (index.ts) that re-export from
      // forbidden layers are NOT caught here. The standalone
      // scripts/check-layer-imports.ts performs full transitive tracing in CI.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            // ── core/ may not import adapters layer ──────────────────────
            {
              group: [
                "**/adapters/**",
                "**/adapters",
                "@agentic-ai/adapters",
                "@agentic-ai/adapters/*",
              ],
              // source: coding-standards.md §2.2 — adapters is an outer layer
              message:
                "[layer-import] core/ must not import from adapters/. " +
                "Declare a port (interface) in core/ and let adapters/ implement it. " +
                "source: coding-standards.md §2.2",
            },
            // ── core/ may not import mcp-servers layer ───────────────────
            {
              group: [
                "**/mcp-servers/**",
                "**/mcp-servers",
                "@agentic-ai/mcp-servers",
                "@agentic-ai/mcp-servers/*",
              ],
              message:
                "[layer-import] core/ must not import from mcp-servers/. " +
                "mcp-servers/ is the composition root; dependencies point inward. " +
                "source: coding-standards.md §2.2",
            },
          ],
        },
      ],

      // ── No magic numbers without source comment ────────────────────────────
      // Warn on raw numeric literals in source (not in tests).
      // Complements scripts/check-source-citations.sh which enforces the same
      // rule at commit time.
      // source: coding-standards.md §3.1 — "No magic numbers."
      "@typescript-eslint/no-magic-numbers": [
        "warn",
        {
          ignore: [-1, 0, 1, 2],
          ignoreEnums: true,
          ignoreNumericLiteralTypes: true,
          ignoreReadonlyClassProperties: true,
          ignoreTypeIndexes: true,
          enforceConst: true,
        },
      ],

      // ── Explicit return types ──────────────────────────────────────────────
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
          allowDirectConstAssertionInArrowFunctions: true,
        },
      ],

      // ── No explicit any ────────────────────────────────────────────────────
      "@typescript-eslint/no-explicit-any": "error",

      // ── Consistent type imports ────────────────────────────────────────────
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports" },
      ],
    },
  },

  // ── Test files — relaxed rules ─────────────────────────────────────────────
  // Test files legitimately use magic numbers and may import across layers
  // to assemble fixtures. The layer-import rule is suspended for test files
  // only because tests build full dependency graphs including adapters.
  // Console is also permitted in tests for debugging output.
  //
  // allowDefaultProject: test files are excluded from the package-level
  // tsconfig.json (to keep compiled output clean) but must still be parseable
  // by the TypeScript project service used by ESLint. allowDefaultProject
  // instructs the project service to parse these files using the default
  // compiler options rather than failing with "not found by the project
  // service". source: @typescript-eslint/typescript-eslint docs §allowDefaultProject.
  {
    files: [
      "**/__tests__/**/*.ts",
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/*.parity.test.ts",
    ],
    rules: {
      "@typescript-eslint/no-magic-numbers": "off",
      "no-console": "off",
      "no-restricted-imports": "off",
      // Tests legitimately use `!` for fixture-derived values whose
      // nullability TypeScript can't statically prove (e.g.
      // `mock.calls[0]![0]` after asserting toHaveBeenCalledOnce, or
      // `result.find(p => p.id === x)!.value` when the seed data
      // guarantees the find succeeds). The strict preset enables this
      // rule globally; tests opt out.
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },

  // ── Config and script files ────────────────────────────────────────────────
  {
    files: ["*.config.js", "*.config.ts", "scripts/**/*.ts"],
    rules: {
      "@typescript-eslint/no-magic-numbers": "off",
      "no-console": "off",
    },
  },

  // ── Composition roots — allowed to import from adapters/ ─────────────────
  // Factory files (index.ts at the package root) are the composition root;
  // they wire adapters to the port. The no-restricted-imports rule is relaxed
  // here intentionally: these files are not core/ domain code.
  // source: coding-standards.md §5.2 — factory / composition root pattern
  {
    files: ["packages/*/src/index.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];

export default config;
