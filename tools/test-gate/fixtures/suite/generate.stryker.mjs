// Regenerates the real-shape mutation report of the fixture suite (perTest coverage, so `coveredBy` is filled):
//   cd tools/test-gate/fixtures/suite && npx stryker run generate.stryker.mjs
// Options: node_modules/@stryker-mutator/api/dist/src-generated/stryker-core.d.ts;
// cucumber runner options: node_modules/@stryker-mutator/cucumber-runner/dist/src-generated/cucumber-runner-options.d.ts.
export default {
  testRunner: 'cucumber',
  plugins: ['@stryker-mutator/cucumber-runner'],
  cucumber: { features: ['specs/green.feature', 'specs/second.feature'] },
  coverageAnalysis: 'perTest',
  mutate: ['src/math.mjs'],
  reporters: ['json'],
  jsonReporter: { fileName: '../mutation/real.json' },
  tempDirName: '../../../../.stryker-tmp/fixture-suite',
  cleanTempDir: true,
  concurrency: 1,
};
