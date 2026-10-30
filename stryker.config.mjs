// Stryker configuration of the CI gate (docs/design/platform-v3-srt.md §7). Options:
// node_modules/@stryker-mutator/api/dist/src-generated/stryker-core.d.ts; cucumber runner options:
// node_modules/@stryker-mutator/cucumber-runner/dist/src-generated/cucumber-runner-options.d.ts.
// `mutate` comes from reports/gate-plan.json, written by `test-gate plan` (the perimeter of rule 5); a
// `--mutate` on the command line overrides it. The runner reads cucumber.mjs (default profile): every feature runs
// in the dry run, so `coveredBy` (perTest coverage) is known for every mutant.
import { existsSync, readFileSync } from 'node:fs';

const PLAN = 'reports/gate-plan.json';
const plan = existsSync(PLAN) ? JSON.parse(readFileSync(PLAN, 'utf8')) : { mutate: [] };

export default {
  testRunner: 'cucumber',
  plugins: ['@stryker-mutator/cucumber-runner'],
  coverageAnalysis: 'perTest',
  // Explicit, not the default (CPU count - 1): every test-runner worker may start its own disposable PostgreSQL
  // (features/support/postgres.ts), each holding one SysV shared memory segment, and macOS allows only
  // kern.sysv.shmmni=32. Four workers keep that bounded even when Stryker kills and restarts them.
  concurrency: 4,
  mutate: plan.mutate,
  reporters: ['json', 'clear-text', 'progress'],
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  thresholds: { high: 100, low: 100, break: null },
};
