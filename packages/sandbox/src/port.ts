import type { Readable, Writable } from 'node:stream';

/**
 * Port SandboxRunner (docs/design/platform-v3-srt.md, §6). Signature fermée : un profil nommé, un répertoire de
 * travail et un argv. Aucun contenu (script, prompt, fichier) ne passe par ici ; il arrive ensuite sur stdin.
 * Les trois flux sont des tubes créés par l'adaptateur, jamais hérités de l'appelant.
 */
export interface SandboxRequest {
  /** Nom d'un gabarit de `packages/sandbox/profiles/<nom>.json`. */
  readonly profile: string;
  /** Un worktree du dépôt, `<repo>/.claude/worktrees/<w>`, ou un dossier sous lui. */
  readonly cwd: string;
  /** argv statique ; argv[0] est résolu dans PATH vers un exécutable hors de tout chemin inscriptible. */
  readonly command: readonly string[];
}

export interface SandboxExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface Sandbox {
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  /** Résolu à la fin du processus ; le groupe entier est alors tué et le dossier temporaire retiré. */
  readonly exited: Promise<SandboxExit>;
  /** Tue le groupe de processus (`kill(-pgid)`) et attend la fin. */
  stop(): Promise<SandboxExit>;
}

export interface SandboxRunner {
  start(request: SandboxRequest): Promise<Sandbox>;
}

export type SandboxErrorCode =
  'ISOLATION_UNAVAILABLE' | 'PROFILE_INVALID' | 'NOT_A_WORKTREE' | 'COMMAND_NOT_FOUND' | 'TERMINAL_REQUIRED';

/** Refus nommé : aucun repli, aucune exécution hors sandbox. */
export class SandboxError extends Error {
  readonly code: SandboxErrorCode;
  constructor(code: SandboxErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = 'SandboxError';
  }
}
