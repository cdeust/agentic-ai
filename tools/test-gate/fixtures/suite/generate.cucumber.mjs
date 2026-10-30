// Regenerates the fixture reports of tools/test-gate from the fixture suite, one profile per report:
//   cd tools/test-gate/fixtures/suite && npx cucumber-js --config generate.cucumber.mjs --profile <name>
// then replace the absolute path of this directory by `<suite>` in the written file (stack traces).
// interrupted.ndjson is green.ndjson with four envelopes removed, as a run killed mid-way leaves it: the last
// testStepFinished and the testCaseFinished of its test case, the testRunHookFinished of the AfterAll hook and
// testRunFinished. run-hook-crash.ndjson is real: a failing BeforeAll stops cucumber-js 12.9.0 before any test case.
// This is NOT the repository configuration: profiles here filter and retry on purpose, to produce red reports.
// Options: node_modules/@cucumber/cucumber/lib/configuration/types.d.ts.
const base = { import: ['specs/steps/*.mjs'], retry: 0, strict: true };
const only = (name, paths, extra = {}) => ({
  ...base,
  paths,
  format: [`message:../reports/${name}.ndjson`],
  ...extra,
});
const GREEN = ['specs/green.feature', 'specs/second.feature'];

export default only('green', GREEN);
export const greenOnly = only('green-only', ['specs/green.feature']);
export const undefinedStep = only('undefined', ['specs/undefined.feature']);
export const pendingStep = only('pending', ['specs/pending.feature']);
export const skippedStep = only('skipped', ['specs/skipped.feature']);
export const ambiguousStep = only('ambiguous', ['specs/ambiguous.feature']);
export const failedStep = only('failed', ['specs/failed.feature']);
export const retried = only('retried', ['specs/retried.feature'], { retry: 1 });
export const empty = only('empty', ['specs/empty.feature']);
export const hook = only('hook', ['specs/hook.feature']);
export const duplicate = only('duplicate', ['specs/duplicate.feature']);
export const runHook = only('run-hook-crash', GREEN, { import: ['specs/steps/*.mjs', 'hooks/*.mjs'] });
export const filtered = only('filtered', GREEN, {
  name: ['^a plain scenario$', '^another passing scenario$'],
});
