import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemorySandboxRunner } from '../../src/in-memory.js';
import type { Sandbox, SandboxExit, SandboxRunner } from '../../src/port.js';
import {
  SrtSandboxRunner,
  standardStreamsAreTerminals,
  type SrtRunnerOptions,
} from '../../src/srt-runner.js';
import { Given, PKG, Then, When, messageMatches, stored, type SandboxWorld } from './helpers.js';

// The steps of the SandboxRunner contract are shared by the scenarios of packages/sandbox/features (in-memory)
// and of features/sandbox (real srt sandboxes): cucumber loads every step file in one run.

const SRT_CLI = createRequire(import.meta.url).resolve('@anthropic-ai/sandbox-runtime/dist/cli.js');

/** Un vrai dépôt git jetable avec un worktree à `<repo>/.claude/worktrees/w`. */
function makeRepo(): { root: string; worktree: string } {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'aos-runner-')));
  const repo = join(root, 'repo');
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], {
      cwd,
      stdio: 'ignore',
      env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: root },
    });
  execFileSync('git', ['init', '-q', '-b', 'main', repo], { stdio: 'ignore' });
  git(
    repo,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@example.invalid',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'i',
  );
  git(repo, 'worktree', 'add', '-q', '-b', 'w', '.claude/worktrees/w');
  return { root, worktree: join(repo, '.claude', 'worktrees', 'w') };
}

const srtOptions = (extra: Partial<SrtRunnerOptions> = {}): SrtRunnerOptions => ({
  profilesDir: join(PKG, 'profiles'),
  srtCli: SRT_CLI,
  node: process.execPath,
  canaryProbe: join(PKG, 'src', 'canary-probe.mjs'),
  tmpRoot: tmpdir(),
  home: homedir(),
  hostEnv: { PATH: process.env['PATH'], HOME: process.env['HOME'] },
  trusted: [],
  variables: { authProxyPort: '9', sessionToken: 'contract-test' },
  ...extra,
});

const readAll = async (sandbox: Sandbox): Promise<string> => {
  let out = '';
  for await (const chunk of sandbox.stdout) out += String(chunk);
  return out;
};

/** The throwaway repository of the scenario, created on first use and removed by the After hook. */
function repoOf(world: SandboxWorld): { root: string; worktree: string } {
  if (world.state['repo'] === undefined) {
    const repo = makeRepo();
    world.cleanups.push(() => rmSync(repo.root, { recursive: true, force: true }));
    world.state['repo'] = repo;
  }
  return world.state['repo'] as { root: string; worktree: string };
}

/** Installs the srt runner over the scenario's repository; the working directory is its worktree. */
function useSrt(
  world: SandboxWorld,
  extra: (repo: { root: string; worktree: string }) => Partial<SrtRunnerOptions>,
) {
  const repo = repoOf(world);
  const runner = new SrtSandboxRunner(srtOptions(extra(repo)));
  world.state['runner'] = runner;
  world.state['srt'] = runner;
  world.state['cwd'] = repo.worktree;
}

Given('a {string} sandbox runner', function (adapter: string) {
  if (adapter === 'in-memory') {
    this.state['runner'] = new InMemorySandboxRunner(['builder']);
    this.state['cwd'] = '/unused';
  } else if (adapter === 'srt') {
    useSrt(this, () => ({}));
  } else assert.fail(`no adapter named "${adapter}"`);
});

Given('an srt runner over a throwaway git repository', function () {
  useSrt(this, () => ({}));
});

Given('an srt runner over a throwaway git repository whose descriptors are not terminals', function () {
  useSrt(this, () => ({ isTerminal: () => false }));
});

Given(
  'an srt runner over a throwaway git repository whose isatty says only descriptor 2 is not a terminal',
  function () {
    useSrt(this, () => ({ isatty: (fd: number) => fd !== 2 }));
  },
);

Given(
  'an srt runner over a throwaway git repository whose isatty says every descriptor is a terminal and whose srt cli is missing',
  function () {
    useSrt(this, (repo) => ({
      isatty: () => true,
      srtCli: join(repo.root, 'node_modules', 'srt', 'cli.js'),
    }));
  },
);

When('I check the standard streams with an isatty that accepts every descriptor', function () {
  const asked: number[] = [];
  this.state['asked'] = asked;
  this.state['streams'] = standardStreamsAreTerminals((fd) => {
    asked.push(fd);
    return true;
  });
});

When('I check the standard streams with an isatty that refuses descriptor {int}', function (refused: number) {
  this.state['streams'] = standardStreamsAreTerminals((fd) => fd !== refused);
});

Then('the standard streams are terminals', function () {
  assert.equal(this.state['streams'], true);
});

Then('the standard streams are not terminals', function () {
  assert.equal(this.state['streams'], false);
});

Then('isatty was asked about the descriptors {string}', function (expected: string) {
  assert.equal(stored<number[]>(this, 'asked').join(','), expected);
});

Given('an srt runner over a throwaway git repository whose srt cli is missing', function () {
  useSrt(this, (repo) => ({ srtCli: join(repo.root, 'node_modules', 'srt', 'cli.js') }));
});

Given('an srt runner over a throwaway git repository whose srt does not isolate', function () {
  useSrt(this, () => ({ srtCli: join(PKG, 'fixtures', 'no-isolation-srt.mjs') }));
});

Given(
  'an srt runner over a throwaway git repository that trusts a launcher file inside the worktree',
  function () {
    useSrt(this, (repo) => {
      const launcher = join(repo.worktree, 'launcher.ts');
      writeFileSync(launcher, '');
      return { trusted: [launcher] };
    });
  },
);

Given('the working directory is the main checkout of the repository', function () {
  this.state['cwd'] = join(repoOf(this).root, 'repo');
});

const runner = (world: SandboxWorld) => stored<SandboxRunner>(world, 'runner');
const sandbox = (world: SandboxWorld) => stored<Sandbox>(world, 'sandbox');

/** Keeps the error (or null) of an attempt, for the "is refused" step. */
async function attempt(world: SandboxWorld, action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
    world.state['refusal'] = null;
  } catch (error) {
    world.state['refusal'] = error;
  }
}

When(
  'I try to start profile {string} with command {string}',
  async function (profile: string, command: string) {
    await attempt(this, () =>
      runner(this).start({ profile, cwd: stored<string>(this, 'cwd'), command: [command] }),
    );
  },
);

When(
  'I try to run profile {string} with command {string} in the terminal',
  async function (profile: string, command: string) {
    const srt = stored<SrtSandboxRunner>(this, 'srt');
    await attempt(this, () =>
      srt.runInTerminal({ profile, cwd: stored<string>(this, 'cwd'), command: [command] }),
    );
  },
);

Then('it is refused with {string}', function (pattern: string) {
  const error = stored<unknown>(this, 'refusal');
  assert.ok(error !== null, 'the start was not refused');
  messageMatches(pattern)(error);
});

When('I start profile {string} with command {string}', async function (profile: string, command: string) {
  const started = await runner(this).start({ profile, cwd: stored<string>(this, 'cwd'), command: [command] });
  this.state['sandbox'] = started;
  this.state['output'] = readAll(started);
});

When('I send the line {string} on its standard input and close it', function (line: string) {
  sandbox(this).stdin.end(`${line}\n`);
});

Then('its standard output is the line {string}', async function (line: string) {
  assert.equal(await stored<Promise<string>>(this, 'output'), `${line}\n`);
});

Then('it exits with code {int}', async function (code: number) {
  assert.equal((await sandbox(this).exited).code, code);
});

When('I stop it', async function () {
  sandbox(this).stdout.resume();
  this.state['stopExit'] = await sandbox(this).stop();
});

Then('the exit code of the stop is not 0', function () {
  assert.equal(stored<SandboxExit>(this, 'stopExit').code === 0, false);
});

Then('its exit is the same as the exit of the stop', async function () {
  assert.deepEqual(await sandbox(this).exited, stored<SandboxExit>(this, 'stopExit'));
});

When('I note the entries of the temporary directory', function () {
  this.state['before'] = execFileSync('ls', [tmpdir()], { encoding: 'utf8' });
});

When(
  'I start profile {string} with command {string}, close its input, drain its output and wait for it to end',
  async function (profile: string, command: string) {
    const started = await runner(this).start({
      profile,
      cwd: stored<string>(this, 'cwd'),
      command: [command],
    });
    started.stdin.end();
    started.stdout.resume();
    await started.exited;
  },
);

Then('no per-sandbox folder is left in the temporary directory', function () {
  const before = stored<string>(this, 'before');
  const after = execFileSync('ls', [tmpdir()], { encoding: 'utf8' });
  const leftovers = after.split('\n').filter((f) => f.startsWith('aos-sandbox-') && !before.includes(f));
  assert.deepEqual(leftovers, []);
});
