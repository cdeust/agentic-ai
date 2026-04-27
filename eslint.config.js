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
        projectService: true,
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
];

export default config;
