import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveWorktree } from '../src/worktree.js';

/** Disposition de git pour un worktree lié, écrite à la main : aucun git lancé. */
function layout(root: string, name = 'w', at = join(root, 'repo', '.claude', 'worktrees', name)) {
  const repo = join(root, 'repo');
  const gitWt = join(repo, '.git', 'worktrees', name);
  mkdirSync(gitWt, { recursive: true });
  mkdirSync(join(at, 'src'), { recursive: true });
  writeFileSync(join(at, '.git'), `gitdir: ${gitWt}\n`);
  writeFileSync(join(gitWt, 'commondir'), '../..\n');
  writeFileSync(join(gitWt, 'gitdir'), `${join(at, '.git')}\n`);
  return { repo, gitWt, worktree: at };
}

describe('resolveWorktree', () => {
  let root: string;
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'aos-wt-')));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('resolves repo, worktree and name from the worktree or a folder under it', () => {
    const { repo, worktree } = layout(root);
    const expected = { repo, worktree, worktreeName: 'w' };
    expect(resolveWorktree(worktree)).toEqual(expected);
    expect(resolveWorktree(join(worktree, 'src'))).toEqual(expected);
  });

  it('refuses the main checkout', () => {
    const { repo } = layout(root);
    expect(() => resolveWorktree(repo)).toThrow(/NOT_A_WORKTREE.*dépôt principal/);
  });

  it('refuses a worktree outside <repo>/.claude/worktrees', () => {
    const { worktree } = layout(root, 'w', join(root, 'elsewhere', 'w'));
    expect(() => resolveWorktree(worktree)).toThrow(/NOT_A_WORKTREE.*hors de <repo>\/\.claude\/worktrees/);
  });

  it('refuses a .git pointer rewritten to another gitdir', () => {
    const { worktree } = layout(root);
    const other = layout(root, 'other');
    writeFileSync(join(worktree, '.git'), `gitdir: ${other.gitWt}\n`);
    expect(() => resolveWorktree(worktree)).toThrow(/NOT_A_WORKTREE/);
  });

  it('refuses a commondir that does not lead to <repo>/.git', () => {
    const { gitWt, worktree } = layout(root);
    mkdirSync(join(root, 'fake'), { recursive: true });
    writeFileSync(join(gitWt, 'commondir'), `${join(root, 'fake')}\n`);
    expect(() => resolveWorktree(worktree)).toThrow(/NOT_A_WORKTREE.*commondir/);
  });
});
