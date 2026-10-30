import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@architect-os/contracts': fileURLToPath(new URL('./packages/contracts/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['{packages,data,gateway,services,test}/**/test/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'test/arch/fixtures/**'],
    testTimeout: 30000,
  },
});
