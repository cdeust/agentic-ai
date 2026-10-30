import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveWorktree } from '../../src/worktree.js';
import { Given, Then, When, messageMatches, type SandboxWorld } from './helpers.js';

interface Layout {
  repo: string;
  gitWt: string;
  worktree: string;
}
interface Layouts {
  root: string;
  byName: Record<string, Layout>;
}

/** Disposition de git pour un worktree lié, écrite à la main : aucun git lancé. */
function layout(root: string, name: string, at = join(root, 'repo', '.claude', 'worktrees', name)): Layout {
  const repo = join(root, 'repo');
  const gitWt = join(repo, '.git', 'worktrees', name);
  mkdirSync(gitWt, { recursive: true });
  mkdirSync(join(at, 'src'), { recursive: true });
  writeFileSync(join(at, '.git'), `gitdir: ${gitWt}\n`);
  writeFileSync(join(gitWt, 'commondir'), '../..\n');
  writeFileSync(join(gitWt, 'gitdir'), `${join(at, '.git')}\n`);
  return { repo, gitWt, worktree: at };
}

/** The scenario's temporary root, created on first use and removed by the After hook. */
function layouts(world: SandboxWorld): Layouts {
  if (world.state['layouts'] === undefined) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'aos-wt-')));
    world.cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    world.state['layouts'] = { root, byName: {} } satisfies Layouts;
  }
  return world.state['layouts'] as Layouts;
}
const named = (world: SandboxWorld, name: string): Layout => {
  const found = layouts(world).byName[name];
  assert.ok(found, `no layout named "${name}"`);
  return found;
};

Given('a hand-written git layout for the linked worktree {string}', function (name: string) {
  const l = layouts(this);
  l.byName[name] = layout(l.root, name);
});

Given(
  'a hand-written git layout for the linked worktree {string} placed at {string} outside the repository',
  function (name: string, at: string) {
    const l = layouts(this);
    l.byName[name] = layout(l.root, name, join(l.root, at));
  },
);

When(
  'the .git pointer of the worktree {string} is rewritten to the git directory of {string}',
  function (name: string, other: string) {
    writeFileSync(join(named(this, name).worktree, '.git'), `gitdir: ${named(this, other).gitWt}\n`);
  },
);

When('the commondir of {string} is rewritten to a folder outside the repository', function (name: string) {
  const l = layouts(this);
  mkdirSync(join(l.root, 'fake'), { recursive: true });
  writeFileSync(join(named(this, name).gitWt, 'commondir'), `${join(l.root, 'fake')}\n`);
});

Then('resolving the worktree gives its repo, itself and the name {string}', function (name: string) {
  const { repo, worktree } = named(this, name);
  assert.deepEqual(resolveWorktree(worktree), { repo, worktree, worktreeName: name });
});

Then('resolving the folder {string} under the worktree gives the same', function (folder: string) {
  const { repo, worktree } = named(this, 'w');
  assert.deepEqual(resolveWorktree(join(worktree, folder)), { repo, worktree, worktreeName: 'w' });
});

Then('resolving the main checkout fails with {string}', function (pattern: string) {
  assert.throws(() => resolveWorktree(named(this, 'w').repo), messageMatches(pattern));
});

Then('resolving the worktree fails with {string}', function (pattern: string) {
  assert.throws(() => resolveWorktree(named(this, 'w').worktree), messageMatches(pattern));
});
