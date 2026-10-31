import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEBT_PATH, FIXTURES, Given, Then, repository, type GateRepository } from './repository.js';

// Steps of debt.feature: the mutation debt registry of a disposable repository (fixtures/debt/), the code that
// moves in the mutation report, and the text the report prints of the debt.

const MUTATION = 'reports/mutation/mutation.json';
const REPORT = 'reports/gate-report.md';

interface Entry {
  start: { line: number; column: number };
  end: { line: number; column: number };
  [field: string]: unknown;
}

interface MutationFixture {
  files: Record<string, { source: string; mutants: { location: Entry }[] }>;
}

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}

/** `end.column` of an entry, set to a JSON value. */
function setField(entry: Record<string, unknown>, field: string, value: unknown): void {
  const path = field.split('.');
  const last = path.pop() as string;
  const holder = path.reduce<Record<string, unknown>>(
    (found, key) => found[key] as Record<string, unknown>,
    entry,
  );
  assert.ok(last in holder, `the entry has no field ${field}`);
  holder[last] = value;
}

/** A number in the step is a number of the entry, anything else is text. */
function jsonOrText(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function lines(repo: GateRepository, rule: number): string[] {
  const section = repo.read(REPORT);
  const found: string[] = [];
  let current = '';
  for (const line of section
    .slice(section.indexOf('## Violations'), section.indexOf('## Mutation'))
    .split('\n')) {
    const title = /^### Règle (\d)/.exec(line);
    if (title !== null) current = title[1] ?? '';
    else if (current === String(rule) && line.startsWith('- ') && line !== '- aucune')
      found.push(line.slice(2));
  }
  return found;
}

Given('the gate debt registry is the fixture {string}', function (name: string) {
  repository(this).write(DEBT_PATH, fixture(`debt/${name}.json`));
});

Given(
  'the gate debt registry is the fixture {string} with {string} of its entry {int} set to {string}',
  function (name: string, field: string, index: number, value: string) {
    const registry = JSON.parse(fixture(`debt/${name}.json`)) as { survivors: Record<string, unknown>[] };
    const entry = registry.survivors[index - 1];
    assert.ok(entry !== undefined, `the fixture ${name} has no entry ${index}`);
    setField(entry, field, jsonOrText(value));
    repository(this).write(DEBT_PATH, `${JSON.stringify(registry, null, 2)}\n`);
  },
);

Given('the gate debt registry reads:', function (text: string) {
  repository(this).write(DEBT_PATH, `${text}\n`);
});

Given('the gate debt registry is absent', function () {
  repository(this).remove(DEBT_PATH);
});

Given(
  'the code of {string} moves down by one line from line {int} in the gate mutation report and in the working tree',
  function (path: string, line: number) {
    const repo = repository(this);
    const report = JSON.parse(repo.read(MUTATION)) as MutationFixture;
    const file = report.files[path];
    assert.ok(file !== undefined, `${path} is not in the mutation report`);
    const source = file.source.split('\n');
    source.splice(line - 1, 0, '// inserted');
    file.source = source.join('\n');
    for (const { location } of file.mutants) {
      for (const position of [location.start, location.end]) {
        if (position.line >= line) position.line += 1;
      }
    }
    repo.write(MUTATION, JSON.stringify(report));
    repo.write(path, file.source);
  },
);

Then('the gate debt section reads:', function (text: string) {
  const repo = repository(this);
  const report = repo.read(REPORT);
  const section = report.slice(report.indexOf('## Dette de mutation'), report.indexOf('## Violations'));
  assert.equal(section, `${repo.tokens(text)}\n\n`);
});

Then('the gate report has no debt section', function () {
  assert.equal(repository(this).read(REPORT).includes('## Dette de mutation'), false);
});

Then('the gate violations of rule {int} start with {string}', function (rule: number, prefix: string) {
  const found = lines(repository(this), rule);
  assert.equal(found.length, 1, found.join('\n'));
  const [violation = ''] = found;
  assert.ok(violation.startsWith(prefix), violation);
});

Then('the gate repository file {string} is the fixture {string}', function (path: string, name: string) {
  assert.equal(repository(this).read(path), fixture(name));
});

Then('the gate repository file {string} now reads:', function (path: string, text: string) {
  assert.equal(repository(this).read(path), `${text}\n`);
});

Then('the gate repository holds no file {string}', function (path: string) {
  assert.equal(repository(this).exists(path), false);
});
