// vitest.config.template.ts — COPY THIS into packages/<package-name>/ as vitest.config.ts
// and replace every <PLACEHOLDER> with the correct value.
//
// Pattern: lifted from prd-spec-generator/packages/core/vitest.config.ts.
// The workspace root enumerates this file via "packages/*/vitest.config.ts".
//
// Usage:
//   1. cp docs/vitest.config.template.ts packages/<pkg>/vitest.config.ts
//   2. Set `name` to the package's npm name: "@agentic-ai/<pkg>"
//   3. Adjust include/exclude if the package has non-standard test locations.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // REPLACE: must be unique across the workspace — use the package's npm name.
    name: "@agentic-ai/<package-name>",

    // Tests live in src/__tests__/ (preferred) or __tests__/ at package root.
    include: [
      "src/__tests__/**/*.test.ts",
      "src/**/*.test.ts",
      "__tests__/**/*.test.ts",
    ],

    exclude: ["dist/**", "node_modules/**"],

    // Coverage provider: v8 (built into Node). Enable per package if desired.
    // To generate coverage: vitest run --coverage
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/__tests__/**", "dist/**"],
    },
  },
});
