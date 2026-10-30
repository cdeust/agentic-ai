import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, Then, When, stored } from './helpers.js';

const TOOL_TIMEOUT_MS = 280_000;

interface Outcome {
  status: number | null;
  output: string;
}

/** Runs a binary of node_modules/.bin from the repository root, as the npm script does. */
function run(binary: string, args: string[]): Outcome {
  const result = spawnSync(join(ROOT, 'node_modules', '.bin', binary), args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: TOOL_TIMEOUT_MS,
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}${result.error?.message ?? ''}` };
}

const expectSuccess = (outcome: Outcome, what: string) =>
  assert.equal(outcome.status, 0, `${what} failed (status ${String(outcome.status)}):\n${outcome.output}`);

When('the repository is typechecked with tsc', function () {
  this.state['typecheck'] = run('tsc', ['-b']);
});

Then('the typecheck exits with status 0', function () {
  expectSuccess(stored<Outcome>(this, 'typecheck'), 'tsc -b');
});

When('the repository is checked with prettier', function () {
  this.state['format'] = run('prettier', ['--check', '.']);
});

Then('the format check exits with status 0', function () {
  expectSuccess(stored<Outcome>(this, 'format'), 'prettier --check .');
});
