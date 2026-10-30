import { execFileSync } from 'node:child_process';

/**
 * Runs `git` in `cwd` and returns its standard output. The only process launch of tools/test-gate: named exception
 * of the rule child-process-only-in-sandbox in .dependency-cruiser.cjs. The gate has no network code and no token.
 */
export function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1 << 30,
  });
}

function names(output: string): string[] {
  return output.split('\0').filter((name) => name !== '');
}

/** What the gate reads from git: the head, its first parent, the diff against it and the tree of the first parent. */
export class GitRepository {
  constructor(private readonly root: string) {}

  /** HEAD and its first parent (`HEAD^1`), null for a root commit. */
  commits(): { head: string; firstParent: string | null } {
    const [head, firstParent] = git(this.root, ['rev-list', '--parents', '-n', '1', 'HEAD'])
      .trim()
      .split(' ') as [string, string?];
    return { head, firstParent: firstParent ?? null };
  }

  /**
   * `git diff --unified=0 --no-renames <first parent>`: the first parent against the working tree (O-2: never a
   * merge-base, never a comparison of a branch to main).
   */
  diff(firstParent: string): string {
    return git(this.root, [
      'diff',
      '--unified=0',
      '--no-renames',
      '--no-color',
      '--no-ext-diff',
      firstParent,
    ]);
  }

  /** Files of the index (the whole tree of a root commit). */
  tracked(): string[] {
    return names(git(this.root, ['ls-files', '-z']));
  }

  /** Files of the working tree git does not track and does not ignore: they are additions too. */
  untracked(): string[] {
    return names(git(this.root, ['ls-files', '--others', '--exclude-standard', '-z']));
  }

  /** `git ls-tree -r --name-only <rev>`. */
  filesAt(rev: string): string[] {
    return names(git(this.root, ['ls-tree', '-r', '--name-only', '-z', rev]));
  }

  /** `git show <rev>:<path>`. */
  show(rev: string, path: string): string {
    return git(this.root, ['show', `${rev}:${path}`]);
  }
}
