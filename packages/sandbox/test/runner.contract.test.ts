import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemorySandboxRunner } from '../src/in-memory.js';
import type { Sandbox, SandboxRunner } from '../src/port.js';
import { SrtSandboxRunner, type SrtRunnerOptions } from '../src/srt-runner.js';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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

/** Contrat du port, joué contre chaque adaptateur (CLAUDE.md, « Adding a brick », point 2). */
function contract(name: string, make: () => SandboxRunner, cwd: () => string) {
  describe(`SandboxRunner contract: ${name}`, () => {
    it('refuses an unknown profile', async () => {
      await expect(make().start({ profile: 'nope', cwd: cwd(), command: ['cat'] })).rejects.toThrow(
        /PROFILE_INVALID/,
      );
    });

    it('runs the command with pipes: stdin in, stdout out, exit 0', async () => {
      const sandbox = await make().start({ profile: 'builder', cwd: cwd(), command: ['cat'] });
      const out = readAll(sandbox);
      sandbox.stdin.end('ping\n');
      expect(await out).toBe('ping\n');
      expect((await sandbox.exited).code).toBe(0);
    });

    it('stop() ends a running sandbox', async () => {
      const sandbox = await make().start({ profile: 'builder', cwd: cwd(), command: ['cat'] });
      sandbox.stdout.resume();
      const exit = await sandbox.stop();
      expect(exit.code === 0).toBe(false);
      expect(await sandbox.exited).toEqual(exit);
    });
  });
}

contract(
  'in-memory',
  () => new InMemorySandboxRunner(['builder']),
  () => '/unused',
);

describe.runIf(process.platform === 'darwin')('srt adapter on this host (macOS)', () => {
  let repo: { root: string; worktree: string };
  beforeAll(() => {
    repo = makeRepo();
  });
  afterAll(() => rmSync(repo.root, { recursive: true, force: true }));

  contract(
    'srt',
    () => new SrtSandboxRunner(srtOptions()),
    () => repo.worktree,
  );

  it('removes the per-sandbox folder (profile, canary, tmp) once the sandbox ends', async () => {
    const before = execFileSync('ls', [tmpdir()], { encoding: 'utf8' });
    const sandbox = await new SrtSandboxRunner(srtOptions()).start({
      profile: 'builder',
      cwd: repo.worktree,
      command: ['cat'],
    });
    sandbox.stdin.end();
    sandbox.stdout.resume();
    await sandbox.exited;
    const after = execFileSync('ls', [tmpdir()], { encoding: 'utf8' });
    const leftovers = after.split('\n').filter((f) => f.startsWith('aos-sandbox-') && !before.includes(f));
    expect(leftovers).toEqual([]);
  });

  it('refuses to start when a trusted path is writable by the sandbox (the launcher inside the worktree)', async () => {
    const launcher = join(repo.worktree, 'launcher.ts');
    writeFileSync(launcher, '');
    await expect(
      new SrtSandboxRunner(srtOptions({ trusted: [launcher] })).start({
        profile: 'builder',
        cwd: repo.worktree,
        command: ['cat'],
      }),
    ).rejects.toThrow(/ISOLATION_UNAVAILABLE: chemin de confiance inscriptible/);
  });
});

describe('srt adapter refuses without isolation, with no fallback', () => {
  let repo: { root: string; worktree: string };
  beforeAll(() => {
    repo = makeRepo();
  });
  afterAll(() => rmSync(repo.root, { recursive: true, force: true }));

  it('refuses when srt is missing', async () => {
    const missing = join(repo.root, 'node_modules', 'srt', 'cli.js');
    await expect(
      new SrtSandboxRunner(srtOptions({ srtCli: missing })).start({
        profile: 'builder',
        cwd: repo.worktree,
        command: ['cat'],
      }),
    ).rejects.toThrow(/ISOLATION_UNAVAILABLE/);
  });

  it('refuses a srt that does not isolate: the canary reads the secret and reaches the port', async () => {
    const fake = join(PKG, 'test', 'fixtures', 'no-isolation-srt.mjs');
    await expect(
      new SrtSandboxRunner(srtOptions({ srtCli: fake })).start({
        profile: 'builder',
        cwd: repo.worktree,
        command: ['cat'],
      }),
    ).rejects.toThrow(/ISOLATION_UNAVAILABLE: canari : lecture allowed, connexion allowed/);
  });

  it('refuses the main checkout as working directory', async () => {
    await expect(
      new SrtSandboxRunner(srtOptions()).start({
        profile: 'builder',
        cwd: join(repo.root, 'repo'),
        command: ['cat'],
      }),
    ).rejects.toThrow(/NOT_A_WORKTREE/);
  });

  it('runInTerminal refuses when the descriptors are not terminals', async () => {
    await expect(
      new SrtSandboxRunner(srtOptions()).runInTerminal({
        profile: 'builder',
        cwd: repo.worktree,
        command: ['cat'],
      }),
    ).rejects.toThrow(/TERMINAL_REQUIRED/);
  });
});
