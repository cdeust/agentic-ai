import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@architect-os/contracts': fileURLToPath(new URL('./packages/contracts/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['{packages,data,gateway,services}/**/test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 30000,
    // Every test is a Gherkin scenario now (cucumber-js); vitest is removed in the last step of brick 1a.2.
    passWithNoTests: true,
  },
});
