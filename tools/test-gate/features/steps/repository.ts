import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Given as CucumberGiven, Then as CucumberThen, When as CucumberWhen } from '@cucumber/cucumber';
import { CONFIG_PATH, runGate } from '../../src/infrastructure/gate.js';
import { git } from '../../src/infrastructure/git.js';

/** Structural view of the root World (features/support/world.ts); a component cannot import across projects. */
export interface GateWorld {
  state: Record<string, unknown>;
  cleanups: (() => Promise<void> | void)[];
}

// Instantiation expressions: IDefineStep is generic in the World type
// (node_modules/@cucumber/cucumber/lib/support_code_library_builder/types.d.ts).
export const Given = CucumberGiven<GateWorld>;
export const When = CucumberWhen<GateWorld>;
export const Then = CucumberThen<GateWorld>;

export const FIXTURES = fileURLToPath(new URL('../../fixtures/', import.meta.url));

/** The `debt` of fixtures/gate.json: the empty registry every disposable repository starts with. */
export const DEBT_PATH = 'mutation-debt.json';

/**
 * A disposable git repository laid out like tools/test-gate/fixtures/gate.json expects (specs/, src/, mod/<name>/).
 * Real git, never this repository: commits are made with a fixed identity, no hook, no signature.
 */
export class GateRepository {
  readonly dir = mkdtempSync(join(tmpdir(), 'aos-gate-'));
  output = '';
  exitCode: number | undefined;

  constructor() {
    git(this.dir, ['init', '-q']);
    this.write(CONFIG_PATH, readFileSync(join(FIXTURES, 'gate.json'), 'utf8'));
    this.write('.gitignore', 'reports/\n');
    this.write(DEBT_PATH, '{"survivors": []}\n');
  }

  path(relative: string): string {
    return join(this.dir, relative);
  }

  write(relative: string, text: string): void {
    mkdirSync(dirname(this.path(relative)), { recursive: true });
    writeFileSync(this.path(relative), text);
  }

  read(relative: string): string {
    return readFileSync(this.path(relative), 'utf8');
  }

  exists(relative: string): boolean {
    return existsSync(this.path(relative));
  }

  remove(relative: string): void {
    rmSync(this.path(relative), { recursive: true, force: true });
  }

  /** Replaces every specs/*.feature by the named fixture specs of tools/test-gate/fixtures/suite/specs. */
  holdSpecs(names: readonly string[]): void {
    if (this.exists('specs')) {
      for (const name of readdirSync(this.path('specs')))
        if (name.endsWith('.feature')) this.remove(`specs/${name}`);
    }
    for (const name of names) cpSync(join(FIXTURES, 'suite', 'specs', name), this.path(`specs/${name}`));
  }

  commit(message: string): void {
    git(this.dir, ['add', '-A']);
    git(this.dir, [
      '-c',
      'user.name=gate',
      '-c',
      'user.email=gate@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      message,
    ]);
  }

  rev(name: string): string {
    return git(this.dir, ['rev-parse', name]).trim();
  }

  /** `<head>` and `<parent>` in an expected text stand for the SHAs of this repository. */
  tokens(text: string): string {
    if (!text.includes('<head>') && !text.includes('<parent>')) return text;
    const parent =
      git(this.dir, ['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(' ')[1] ?? 'NO-PARENT';
    return text.replaceAll('<head>', this.rev('HEAD')).replaceAll('<parent>', parent);
  }

  run(
    args: readonly string[],
    env: NodeJS.ProcessEnv = { GITHUB_STEP_SUMMARY: this.path('summary.md') },
  ): void {
    let output = '';
    this.exitCode = runGate(['node', 'main.ts', ...args], this.dir, env, {
      write: (text: string) => (output += text),
    });
    this.output = output;
  }
}

export function repository(world: GateWorld): GateRepository {
  const found = world.state['gateRepository'];
  assert.ok(found instanceof GateRepository, 'a gate repository must be given first');
  return found;
}

/** The fixture specs named in a step, `green.feature, second.feature`. */
export function names(list: string): string[] {
  return list === '' ? [] : list.split(', ');
}

Given('a gate repository', function () {
  const created = new GateRepository();
  this.state['gateRepository'] = created;
  this.cleanups.push(() => rmSync(created.dir, { recursive: true, force: true }));
});

Given('the gate repository holds the fixture specs {string}', function (list: string) {
  repository(this).holdSpecs(names(list));
});

Given('the gate repository file {string} reads:', function (path: string, text: string) {
  repository(this).write(path, `${text}\n`);
});

Given('the gate repository file {string} is removed', function (path: string) {
  repository(this).remove(path);
});

Given(
  'the gate repository holds the fixture file {string} as {string}',
  function (fixture: string, path: string) {
    repository(this).write(path, readFileSync(join(FIXTURES, fixture), 'utf8'));
  },
);

Given('the gate first parent is committed', function () {
  repository(this).commit('first parent');
});

Given('the gate head is committed', function () {
  repository(this).commit('head');
});

Given('the gate configuration reads:', function (text: string) {
  repository(this).write(CONFIG_PATH, text);
});

Given('the gate configuration is absent', function () {
  repository(this).remove(CONFIG_PATH);
});

When('the gate checks the {string} job', function (job: string) {
  repository(this).run(['check', '--job', job]);
});

When(
  'the gate checks the {string} job with the step summary {string}',
  function (job: string, summary: string) {
    const env: NodeJS.ProcessEnv = summary === 'empty' ? { GITHUB_STEP_SUMMARY: '' } : {};
    repository(this).run(['check', '--job', job], env);
  },
);

Then('no GitHub step summary is written', function () {
  assert.equal(repository(this).exists('summary.md'), false);
});

When('the gate checks with the default job', function () {
  repository(this).run(['check']);
});

When('the gate plans the {string} job', function (job: string) {
  repository(this).run(['plan', '--job', job]);
});

When('the gate plans with the default job', function () {
  repository(this).run(['plan']);
});

When('the gate runs with the arguments {string}', function (args: string) {
  repository(this).run(args === '' ? [] : args.split(' '));
});

Then('the gate exits with {int}', function (code: number) {
  assert.equal(repository(this).exitCode, code);
});

Then('the gate output is:', function (text: string) {
  const repo = repository(this);
  assert.equal(repo.output, `${repo.tokens(text)}\n`);
});
