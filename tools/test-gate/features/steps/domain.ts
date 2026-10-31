import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { countRule, type Count } from '../../src/domain/count.js';
import type { DebtInput } from '../../src/domain/debt.js';
import { parseUnifiedDiff, type ChangedFile } from '../../src/domain/diff.js';
import { componentOf, type Layout } from '../../src/domain/layout.js';
import {
  judgeMutation,
  perimeterOf,
  type MutantRecord,
  type MutationJudgement,
  type Perimeter,
} from '../../src/domain/mutation.js';
import { Workspace } from '../../src/infrastructure/workspace.js';
import { FIXTURES, Given, Then, When } from './repository.js';

// Direct scenarios over the pure functions of the domain and over Workspace: each pins one observable the
// end-to-end scenarios of the gate (a git repository, a cucumber report) cannot isolate (order, boundary at 0).

const layout = JSON.parse(readFileSync(join(FIXTURES, 'gate.json'), 'utf8')) as Layout;

const list = (text: string): string[] => (text === '' ? [] : text.split(', '));

// The registry of a gate that creates it empty: rule 6 has nothing to say.
const EMPTY_DEBT: DebtInput = {
  path: 'mutation-debt.json',
  current: { survivors: [] },
  parent: null,
  present: new Set(),
};

When(
  'the gate counts the static pickles {string} against those {string} of the first parent {string}',
  function (now: string, parent: string, firstParent: string) {
    this.state['count'] = countRule({
      job: 'linux',
      firstParent: firstParent === 'none' ? null : firstParent,
      now: list(now),
      parent: list(parent),
      executed: 0,
      base: null,
    });
  },
);

Then('the gate count added pickles are {string}', function (expected: string) {
  assert.deepEqual((this.state['count'] as Count).added, list(expected));
});

Then('the gate count removed pickles are {string}', function (expected: string) {
  assert.deepEqual((this.state['count'] as Count).removed, list(expected));
});

Then('the gate count base source is {string}', function (expected: string) {
  assert.equal((this.state['count'] as Count).source, expected);
});

When('the gate parses the unified diff:', function (text: string) {
  this.state['parsed'] = parseUnifiedDiff(text);
});

Then('the gate parsed diff is:', function (expected: string) {
  const lines = (this.state['parsed'] as ChangedFile[]).map(
    (file) => `${file.path}${file.deleted ? ' (supprimé)' : ''}: ${file.lines.join(',')}`,
  );
  assert.deepEqual(lines, expected.split('\n'));
});

Then(
  'the gate component of {string} among the components {string} is {string}',
  function (path: string, components: string, expected: string) {
    const found = componentOf({ ...layout, components: list(components) }, path);
    assert.equal(found, expected === 'none' ? null : expected);
  },
);

/** `src/a.mjs:1,2` -> a ChangedFile; no line after the colon is a file with no added line. */
const change = (spec: string): ChangedFile => {
  const [path, lines = ''] = spec.split(':');
  return {
    path: path as string,
    deleted: false,
    lines: lines === '' ? [] : lines.split(',').map(Number),
  };
};

When(
  'the gate computes the perimeter of the changes {string} over the production files {string}',
  function (changes: string, production: string) {
    this.state['perimeter'] = perimeterOf(layout, list(changes).map(change), list(production), []);
  },
);

Then('the gate perimeter changed files are {string}', function (expected: string) {
  assert.deepEqual([...(this.state['perimeter'] as Perimeter).changedLines.keys()], list(expected));
});

Then('the gate perimeter test scopes are {string}', function (expected: string) {
  assert.deepEqual((this.state['perimeter'] as Perimeter).scopes, list(expected));
});

Then('the gate perimeter fallback files are {string}', function (expected: string) {
  assert.deepEqual((this.state['perimeter'] as Perimeter).fallbackFiles, list(expected));
});

Then('the gate perimeter judged files are {string}', function (expected: string) {
  assert.deepEqual((this.state['perimeter'] as Perimeter).judged, list(expected));
});

Then('the gate perimeter files are {string}', function (expected: string) {
  assert.deepEqual((this.state['perimeter'] as Perimeter).files, list(expected));
});

Given(
  'a gate perimeter over {string} with test scopes {string}, changed lines {string} and fallback files {string}',
  function (files: string, scopes: string, changed: string, fallback: string) {
    const changedLines = new Map<string, ReadonlySet<number>>();
    for (const spec of list(changed)) {
      const { path, lines } = change(spec);
      changedLines.set(path, new Set(lines));
    }
    const perimeter: Perimeter = {
      changedLines,
      scopes: list(scopes),
      fallbackFiles: list(fallback),
      judged: list(files),
      files: list(files),
    };
    this.state['perimeter'] = perimeter;
  },
);

interface ReportFixture {
  mutate: string[];
  testFiles: Record<string, string>;
  files: Record<string, { source: string[]; mutants: MutantRecord[] }>;
}

When('the gate judges the mutation report:', function (text: string) {
  const fixture = JSON.parse(text) as ReportFixture;
  this.state['judgement'] = judgeMutation(
    this.state['perimeter'] as Perimeter,
    {
      mutate: fixture.mutate,
      testFiles: new Map(Object.entries(fixture.testFiles)),
      files: new Map(
        Object.entries(fixture.files).map(([path, file]) => [
          path,
          { source: file.source.join('\n'), mutants: file.mutants },
        ]),
      ),
    },
    EMPTY_DEBT,
  );
});

Then('the gate judged mutants are {string}', function (expected: string) {
  const judgement = this.state['judgement'] as MutationJudgement;
  assert.deepEqual(
    judgement.mutants.map(({ mutant }) => mutant.id),
    list(expected),
  );
});

Then('the gate judgement uses the coverage fallback: {string}', function (expected: string) {
  assert.equal((this.state['judgement'] as MutationJudgement).coverageFallback, expected === 'yes');
});

Then('the gate judgement violations are:', function (expected: string) {
  const judgement = this.state['judgement'] as MutationJudgement;
  assert.deepEqual(
    judgement.violations.map((violation) => `${violation.rule}: ${violation.text}`),
    expected.split('\n'),
  );
});

Given('a gate workspace holding the files {string}', function (files: string) {
  const root = mkdtempSync(join(tmpdir(), 'aos-workspace-'));
  this.cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  for (const file of list(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), '');
  }
  this.state['workspace'] = new Workspace(root);
});

When('the gate workspace globs {string} excluding {string}', function (include: string, exclude: string) {
  this.state['globbed'] = (this.state['workspace'] as Workspace).glob({
    include: list(include),
    exclude: list(exclude),
  });
});

Then('the gate workspace paths are {string}', function (expected: string) {
  assert.deepEqual(this.state['globbed'], list(expected));
});
