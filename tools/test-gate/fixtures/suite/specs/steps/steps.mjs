// Step definitions of the fixture suite (plain JS: they are run only to regenerate the fixture reports).
// Given, Before, AfterAll, the 'pending' / 'skipped' return values: node_modules/@cucumber/cucumber/lib/index.d.ts and
// lib/support_code_library_builder/types.d.ts.
import assert from 'node:assert/strict';
import { AfterAll, Before, Given } from '@cucumber/cucumber';
import { isPositive, sum } from '../../src/math.mjs';

let attempts = 0;

Given('a passing step', () => {});

Given('a step with value {int}', (value) => {
  assert.equal(sum(value, 0), value);
  assert.equal(isPositive(value), true);
});

Given('a pending step', () => 'pending');

Given('a skipped step', () => 'skipped');

Given('an ambiguous step', () => {});

Given(/^an ambiguous (step)$/, () => {});

Given('a failing step', () => {
  throw new Error('fixture failure');
});

Given('a step that passes on its second attempt', () => {
  attempts += 1;
  if (attempts === 1) throw new Error('first attempt fails');
});

Before({ tags: '@broken-hook' }, () => {
  throw new Error('fixture hook failure');
});

AfterAll(() => {});
