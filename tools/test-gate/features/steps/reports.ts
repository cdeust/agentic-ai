import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURES, Given, Then, repository, type GateRepository } from './repository.js';

const CUCUMBER = 'reports/cucumber.ndjson';
const MUTATION = 'reports/mutation/mutation.json';
const BASE = 'reports/base/gate-base.json';
const REPORT = 'reports/gate-report.md';

interface MutationFixture {
  files: Record<string, { source: string; mutants: { id: string; status: string }[] }>;
}

function mutationReport(repo: GateRepository): MutationFixture {
  return JSON.parse(repo.read(MUTATION)) as MutationFixture;
}

function fixtureSource(fixture: string, path: string): string {
  const report = JSON.parse(
    readFileSync(join(FIXTURES, 'mutation', `${fixture}.json`), 'utf8'),
  ) as MutationFixture;
  const file = report.files[path];
  assert.ok(file !== undefined, `${path} is not in the mutation fixture ${fixture}`);
  return file.source;
}

function replaceLine(text: string, line: number, content: string): string {
  const lines = text.split('\n');
  assert.ok(line >= 1 && line <= lines.length, `line ${line} is outside the file`);
  lines[line - 1] = content;
  return lines.join('\n');
}

/** Lines under `## Violations`, as `<rule>: <text>`. */
function violations(report: string): string[] {
  const section = report.slice(report.indexOf('## Violations'), report.indexOf('## Mutation'));
  const found: string[] = [];
  let rule = '';
  for (const line of section.split('\n')) {
    const title = /^### Règle (\d)/.exec(line);
    if (title !== null) rule = title[1] ?? '';
    else if (line.startsWith('- ') && line !== '- aucune') found.push(`${rule}: ${line.slice(2)}`);
  }
  return found;
}

function expectedLines(repo: GateRepository, text: string): string[] {
  return repo
    .tokens(text)
    .split('\n')
    .filter((line) => line !== '');
}

Given('the gate cucumber report is the fixture {string}', function (name: string) {
  repository(this).write(CUCUMBER, readFileSync(join(FIXTURES, 'reports', `${name}.ndjson`), 'utf8'));
});

Given(
  'the gate cucumber report is the fixture {string} with a line of spaces between its envelopes',
  function (name: string) {
    const text = readFileSync(join(FIXTURES, 'reports', `${name}.ndjson`), 'utf8');
    repository(this).write(CUCUMBER, text.split('\n').join('\n   \n'));
  },
);

Given('the gate cucumber report reads:', function (text: string) {
  repository(this).write(CUCUMBER, text);
});

Given('the gate mutation report is the fixture {string}', function (name: string) {
  repository(this).write(MUTATION, readFileSync(join(FIXTURES, 'mutation', `${name}.json`), 'utf8'));
});

Given('the gate mutation report reads:', function (text: string) {
  repository(this).write(MUTATION, text);
});

Given(
  'mutant {string} of the gate mutation report has the status {string}',
  function (id: string, status: string) {
    const repo = repository(this);
    const report = mutationReport(repo);
    const mutant = Object.values(report.files)
      .flatMap((file) => file.mutants)
      .find((candidate) => candidate.id === id);
    assert.ok(mutant !== undefined, `no mutant ${id}`);
    mutant.status = status;
    repo.write(MUTATION, JSON.stringify(report));
  },
);

Given(
  'the gate repository holds {string} of the mutation fixture {string}',
  function (path: string, fixture: string) {
    repository(this).write(path, fixtureSource(fixture, path));
  },
);

Given(
  'the gate repository holds {string} of the mutation fixture {string} with line {int} changed',
  function (path: string, fixture: string, line: number) {
    repository(this).write(
      path,
      replaceLine(fixtureSource(fixture, path), line, '// changed since the first parent'),
    );
  },
);

Given(
  'line {int} of {string} reads {string} in the gate mutation report and in the working tree',
  function (line: number, path: string, content: string) {
    const repo = repository(this);
    const report = mutationReport(repo);
    const file = report.files[path];
    assert.ok(file !== undefined, `${path} is not in the mutation report`);
    file.source = replaceLine(file.source, line, content);
    repo.write(MUTATION, JSON.stringify(report));
    repo.write(path, file.source);
  },
);

Given('the gate base is the fixture {string}', function (name: string) {
  const repo = repository(this);
  const text = readFileSync(join(FIXTURES, 'base', `${name}.json`), 'utf8');
  repo.write(
    BASE,
    text.includes('FIRST_PARENT') ? text.replaceAll('FIRST_PARENT', repo.rev('HEAD^1')) : text,
  );
});

Given('the gate repository file {string} is the gate base just written', function (path: string) {
  const repo = repository(this);
  repo.write(path, repo.read('reports/gate-base.json'));
});

Given('the gate base reads:', function (text: string) {
  repository(this).write(BASE, text);
});

Then('the gate verdict is green', function () {
  const repo = repository(this);
  assert.match(repo.read(REPORT), /^# Porte de test, job \S+ : VERTE\n/);
  assert.equal(repo.exitCode, 0);
});

Then('the gate verdict is red', function () {
  const repo = repository(this);
  assert.match(repo.read(REPORT), /^# Porte de test, job \S+ : ROUGE\n/);
  assert.equal(repo.exitCode, 1);
});

Then('the gate verdict is {string}', function (verdict: string) {
  const repo = repository(this);
  const green = verdict === 'green';
  assert.match(repo.read(REPORT), new RegExp(`^# Porte de test, job \\S+ : ${green ? 'VERTE' : 'ROUGE'}\\n`));
  assert.equal(repo.exitCode, green ? 0 : 1);
});

Then('the gate reports no violation', function () {
  assert.deepEqual(violations(repository(this).read(REPORT)), []);
});

Then('the gate violations are:', function (text: string) {
  const repo = repository(this);
  assert.deepEqual(violations(repo.read(REPORT)), expectedLines(repo, text));
});

Then('the gate violations of rule {int} are:', function (rule: number, text: string) {
  const repo = repository(this);
  const ofRule = violations(repo.read(REPORT)).filter((line) => line.startsWith(`${rule}: `));
  assert.deepEqual(ofRule, expectedLines(repo, text));
});

Then('the gate report reads:', function (text: string) {
  const repo = repository(this);
  assert.equal(repo.read(REPORT), `${repo.tokens(text)}\n`);
});

Then('the gate report has the line {string}', function (line: string) {
  const repo = repository(this);
  assert.ok(repo.read(REPORT).split('\n').includes(repo.tokens(line)), repo.read(REPORT));
});

Then('the gate report has the line:', function (line: string) {
  const repo = repository(this);
  assert.ok(repo.read(REPORT).split('\n').includes(repo.tokens(line)), repo.read(REPORT));
});

Then('the gate mutation section reads:', function (text: string) {
  const repo = repository(this);
  const report = repo.read(REPORT);
  assert.equal(report.slice(report.indexOf('## Mutation')), `${repo.tokens(text)}\n`);
});

Then('the gate plan is:', function (text: string) {
  const repo = repository(this);
  assert.deepEqual(JSON.parse(repo.read('reports/gate-plan.json')), JSON.parse(repo.tokens(text)));
});

Then('the gate base written is:', function (text: string) {
  const repo = repository(this);
  assert.deepEqual(JSON.parse(repo.read('reports/gate-base.json')), JSON.parse(repo.tokens(text)));
});

Then('no gate base is written', function () {
  assert.equal(repository(this).exists('reports/gate-base.json'), false);
});

Then('the GitHub step summary holds the gate report {int} time(s)', function (times: number) {
  const repo = repository(this);
  assert.equal(repo.read('summary.md'), repo.read(REPORT).repeat(times));
});

Then('the gate output is the gate report', function () {
  const repo = repository(this);
  assert.equal(repo.output, repo.read(REPORT));
});
