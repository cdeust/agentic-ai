import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { SandboxError } from './port.js';

export interface Worktree {
  /** Racine du worktree, `<repo>/.claude/worktrees/<w>`. */
  readonly worktree: string;
  /** Dépôt principal, parent de `.git`. */
  readonly repo: string;
  /** Nom git du worktree : `<repo>/.git/worktrees/<w>`. */
  readonly worktreeName: string;
}

const refuse = (message: string): never => {
  throw new SandboxError('NOT_A_WORKTREE', message);
};

const readTrimmed = (file: string): string => {
  if (!existsSync(file)) refuse(`fichier absent : ${basename(file)}`);
  return readFileSync(file, 'utf8').trim();
};

/**
 * Résout le worktree qui contient `cwd`, par lecture des fichiers de git (aucune commande lancée).
 * Le worktree doit vivre à `<repo>/.claude/worktrees/<w>` : ce lieu ne peut pas être déplacé depuis la sandbox,
 * ce qui empêche un `.git` réécrit par une session précédente de désigner un autre dépôt. Le pointeur de retour
 * `<repo>/.git/worktrees/<w>/gitdir` doit désigner ce même worktree.
 */
export function resolveWorktree(cwd: string): Worktree {
  let dir = realpathSync(resolve(cwd));
  while (!existsSync(join(dir, '.git'))) {
    const parent = dirname(dir);
    if (parent === dir) refuse('aucun .git au-dessus du répertoire de travail');
    dir = parent;
  }
  const worktree = dir;
  const dotGit = join(worktree, '.git');
  if (statSync(dotGit).isDirectory()) refuse('dépôt principal : lancer depuis un worktree lié');
  const pointer = /^gitdir: (.+)$/.exec(readTrimmed(dotGit));
  if (pointer === null) refuse('.git ne désigne aucun gitdir');
  const gitWorktree = realpathSync(resolve(worktree, (pointer as RegExpExecArray)[1] as string));
  const commonDir = realpathSync(resolve(gitWorktree, readTrimmed(join(gitWorktree, 'commondir'))));
  if (basename(commonDir) !== '.git') refuse('commondir ne désigne pas <repo>/.git');
  const repo = dirname(commonDir);
  const worktreeName = basename(gitWorktree);
  if (gitWorktree !== join(commonDir, 'worktrees', worktreeName))
    refuse('gitdir hors de <repo>/.git/worktrees');
  if (worktree !== join(repo, '.claude', 'worktrees', basename(worktree)))
    refuse('worktree hors de <repo>/.claude/worktrees');
  const back = readTrimmed(join(gitWorktree, 'gitdir'));
  if (!existsSync(back) || realpathSync(back) !== realpathSync(dotGit))
    refuse('gitdir ne pointe pas vers ce worktree');
  return { worktree, repo, worktreeName };
}
