import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DataTable } from '@cucumber/cucumber';
import { Given, ROOT, Then, When, stored } from './helpers.js';

// DataTable.hashes(): node_modules/@cucumber/cucumber/lib/index.d.ts re-exports it from @cucumber/cucumber/lib/models/data_table.d.ts.

const DEPCRUISE = join(ROOT, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruiser.mjs');
const TARGETS = ['packages', 'data', 'gateway', 'services', 'tools'];
const FIXTURE_PREFIX = 'zz-fixture-';
const GUARD_TIMEOUT_MS = 120_000;

interface Violation {
  rule: { name: string };
  from: string;
  to: string;
}
interface Fixture {
  file: string;
  code: string;
  rule: string;
}

function cruise(): Violation[] {
  let stdout: string;
  try {
    stdout = execFileSync(
      'node',
      [DEPCRUISE, '--config', '.dependency-cruiser.cjs', '--output-type', 'json', ...TARGETS],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
  } catch (error) {
    // depcruise exits non-zero when an error-severity rule is violated; the report is still on stdout.
    stdout = (error as { stdout: string }).stdout;
  }
  return (JSON.parse(stdout) as { summary: { violations: Violation[] } }).summary.violations;
}

/** Removes every `zz-fixture-*` file under the targets, whatever run left it. */
function removeFixtures(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist') removeFixtures(path);
    } else if (entry.name.startsWith(FIXTURE_PREFIX)) rmSync(path);
  }
}

const removeAll = () => TARGETS.forEach((target) => removeFixtures(join(ROOT, target)));

Given('no architecture fixture file is left over', function () {
  removeAll();
  this.cleanups.push(removeAll);
});

Given('these temporary architecture fixtures exist:', function (table: DataTable) {
  const fixtures = table.hashes() as unknown as Fixture[];
  for (const fixture of fixtures) {
    mkdirSync(dirname(join(ROOT, fixture.file)), { recursive: true });
    writeFileSync(join(ROOT, fixture.file), `${fixture.code}\nexport {};\n`);
  }
  this.state['fixtures'] = fixtures;
});

When('the architecture guard runs', { timeout: GUARD_TIMEOUT_MS }, function () {
  this.state['violations'] = cruise();
});

When('the temporary architecture fixtures are removed', function () {
  removeAll();
});

Then('the architecture guard reports no violation', function () {
  assert.deepEqual(stored<Violation[]>(this, 'violations'), []);
});

Then('the architecture guard flags each fixture with its rule', function () {
  const violations = stored<Violation[]>(this, 'violations');
  const fixtures = stored<Fixture[]>(this, 'fixtures');
  assert.ok(fixtures.length > 0, 'no fixture');
  for (const fixture of fixtures) {
    assert.ok(existsSync(join(ROOT, fixture.file)), `${fixture.file} was not written`);
    const caught = violations.some(
      (v) => v.rule.name === fixture.rule && (v.from === fixture.file || v.to === fixture.file),
    );
    assert.equal(caught, true, `rule ${fixture.rule} should flag ${fixture.file}`);
  }
});
