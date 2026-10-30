import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  accessSync,
  constants,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { isatty } from 'node:tty';
import {
  SandboxError,
  type Sandbox,
  type SandboxExit,
  type SandboxRequest,
  type SandboxRunner,
} from './port.js';
import { closedEnv, isWritable, loadTemplate, resolveProfile, type SrtSettings } from './profile.js';
import { resolveWorktree } from './worktree.js';

/**
 * Adaptateur srt du port SandboxRunner (platform-v3-srt.md, §6). Règles tenues ici :
 * - profil résolu écrit dans un dossier temporaire propre à la sandbox, hors de tout chemin inscriptible ; seul
 *   son sous-dossier `tmp` (`CLAUDE_CODE_TMPDIR`) est inscriptible, et le tout est retiré à l'arrêt ;
 * - srt, node, l'exécutable lancé, le profil et les chemins de confiance du lanceur doivent être hors de tout
 *   chemin inscriptible par la sandbox (§4.1 T), sinon `ISOLATION_UNAVAILABLE` ;
 * - canari avant chaque lancement : lecture refusée et connexion refusée, sinon `ISOLATION_UNAVAILABLE`, sans repli ;
 * - `spawn` sans shell, environnement en liste fermée, `detached` et `kill(-pgid)` [T-06] ;
 * - stdio constant `['pipe', 'pipe', 'pipe']` pour le port ; le terminal seulement par `runInTerminal`, après
 *   vérification que 0, 1 et 2 sont des terminaux (jamais un socket [T-07-fd0]).
 */
export interface SrtRunnerOptions {
  readonly profilesDir: string;
  /** `dist/cli.js` du paquet `@anthropic-ai/sandbox-runtime` épinglé. */
  readonly srtCli: string;
  /** Binaire node qui exécute srt et le canari (`process.execPath`). */
  readonly node: string;
  readonly canaryProbe: string;
  /** Parent des dossiers temporaires par sandbox. */
  readonly tmpRoot: string;
  readonly home: string;
  readonly hostEnv: Readonly<Record<string, string | undefined>>;
  /** Chemins de confiance en plus (code du lanceur, plugins chargés) : refus s'ils sont inscriptibles. */
  readonly trusted: readonly string[];
  /** Variables du lanceur en plus de celles de l'adaptateur (port du proxy, jeton de session). */
  readonly variables?: Readonly<Record<string, string>>;
  readonly canaryTimeoutMs?: number;
  /** Vérifie que 0, 1 et 2 sont des terminaux ; défaut : `isatty` réel. Injectable pour `runInTerminal`. */
  readonly isTerminal?: () => boolean;
}

interface Prepared {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly env: Record<string, string>;
  readonly dir: string;
}

const CANARY_OUTPUT_LIMIT = 64 * 1024;
const STOP_GRACE_MS = 2000;

const standardStreamsAreTerminals = (): boolean => [0, 1, 2].every((fd) => isatty(fd));

const killGroup = (pid: number | undefined, signal: NodeJS.Signals): void => {
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch {
    /* groupe déjà disparu */
  }
};

const unavailable = (message: string): SandboxError => new SandboxError('ISOLATION_UNAVAILABLE', message);

/** Ancêtre le plus proche nommé `node_modules` : srt et ses dépendances y vivent ensemble. */
function nodeModulesOf(path: string): string {
  let dir = dirname(path);
  while (basename(dir) !== 'node_modules') {
    const parent = dirname(dir);
    if (parent === dir) return dirname(path);
    dir = parent;
  }
  return dir;
}

export function resolveExecutable(name: string, path: string | undefined): string {
  const candidates = isAbsolute(name)
    ? [name]
    : name.includes('/')
      ? []
      : (path ?? '')
          .split(delimiter)
          .filter((dir) => isAbsolute(dir))
          .map((dir) => join(dir, name));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return realpathSync(candidate);
    } catch {
      /* suivant */
    }
  }
  throw new SandboxError('COMMAND_NOT_FOUND', `exécutable introuvable : ${name}`);
}

/** Refuse tout chemin de confiance que la sandbox pourrait écrire, ou qui contient un chemin qu'elle peut écrire. */
export function assertTrusted(settings: SrtSettings, paths: readonly string[]): void {
  for (const path of paths) {
    let real: string;
    try {
      real = realpathSync(path);
    } catch {
      throw unavailable(`chemin de confiance absent : ${path}`);
    }
    const inside = settings.filesystem.allowWrite.some((root) => root.startsWith(`${real}/`));
    if (isWritable(settings, real) || inside)
      throw unavailable(`chemin de confiance inscriptible par la sandbox : ${real}`);
  }
}

export class SrtSandboxRunner implements SandboxRunner {
  constructor(private readonly options: SrtRunnerOptions) {}

  async start(request: SandboxRequest): Promise<Sandbox> {
    const prepared = await this.prepare(request);
    const child = spawn(this.options.node, prepared.argv, {
      cwd: prepared.cwd,
      env: prepared.env,
      detached: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.on('error', () => {
      /* EPIPE : l'enfant est parti [E-02] */
    });
    const exited = settle(child, prepared.dir);
    return {
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      exited,
      stop: () => stopGroup(child, exited),
    };
  }

  /**
   * Outil interactif de 1a.0 : la TUI exige un terminal. Hors du port, que la plateforme n'appelle jamais.
   * Les descripteurs 0 à 2 sont ceux de l'appelant, acceptés seulement s'ils sont tous trois des terminaux.
   * `TIOCSTI` depuis la sandbox est refusé par srt sous macOS (journal, §14, X-TTY).
   */
  async runInTerminal(request: SandboxRequest): Promise<SandboxExit> {
    if (!(this.options.isTerminal ?? standardStreamsAreTerminals)())
      throw new SandboxError('TERMINAL_REQUIRED', 'stdin, stdout et stderr doivent être des terminaux');
    const prepared = await this.prepare(request);
    const child = spawn(this.options.node, prepared.argv, {
      cwd: prepared.cwd,
      env: prepared.env,
      detached: true,
      shell: false,
      stdio: 'inherit',
    });
    const exited = settle(child, prepared.dir);
    const forward = (signal: NodeJS.Signals) => () => killGroup(child.pid, signal);
    const handlers: [NodeJS.Signals, () => void][] = [
      ['SIGWINCH', forward('SIGWINCH')],
      ['SIGINT', forward('SIGINT')],
      ['SIGTERM', () => void stopGroup(child, exited)],
      ['SIGHUP', () => void stopGroup(child, exited)],
    ];
    for (const [signal, handler] of handlers) process.on(signal, handler);
    try {
      return await exited;
    } finally {
      for (const [signal, handler] of handlers) process.off(signal, handler);
    }
  }

  private async prepare(request: SandboxRequest): Promise<Prepared> {
    const o = this.options;
    const [name, ...args] = request.command;
    if (name === undefined) throw new SandboxError('COMMAND_NOT_FOUND', 'argv vide');
    const template = loadTemplate(o.profilesDir, request.profile);
    const wt = resolveWorktree(request.cwd);
    const dir = realpathSync(mkdtempSync(join(o.tmpRoot, 'aos-sandbox-')));
    try {
      const tmp = join(dir, 'tmp');
      const config = join(dir, 'config');
      mkdirSync(tmp, { mode: 0o700 });
      mkdirSync(config, { mode: 0o700 });
      const profile = resolveProfile(template, {
        ...o.variables,
        home: realpathSync(o.home),
        repo: wt.repo,
        worktree: wt.worktree,
        worktreeName: wt.worktreeName,
        tmp,
        config,
      });
      for (const [file, content] of Object.entries(profile.files)) {
        mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
        writeFileSync(file, `${JSON.stringify(content, null, 2)}\n`, { mode: 0o600 });
      }
      const env = closedEnv(profile, o.hostEnv);
      const executable = resolveExecutable(name, env['PATH']);
      const unset =
        profile.env.unset.length === 0
          ? []
          : [resolveExecutable('env', env['PATH']), ...profile.env.unset.flatMap((n) => ['-u', n])];
      const settingsFile = join(dir, 'profile.json');
      writeFileSync(settingsFile, `${JSON.stringify(profile.settings, null, 2)}\n`, { mode: 0o400 });
      assertTrusted(profile.settings, [
        settingsFile,
        o.srtCli,
        o.node,
        o.canaryProbe,
        executable,
        ...o.trusted,
      ]);
      const srtCli = realpathSync(o.srtCli);
      assertTrusted(profile.settings, [nodeModulesOf(srtCli)]);
      const cwd = realpathSync(resolve(request.cwd));
      await this.canary(profile.settings, srtCli, dir, cwd, env);
      return {
        argv: [srtCli, '--settings', settingsFile, '--', ...unset, executable, ...args],
        cwd,
        env,
        dir,
      };
    } catch (error) {
      rmSync(dir, { recursive: true, force: true });
      throw error;
    }
  }

  /** Le profil réel, plus un fichier secret en denyRead ; un port écouté par l'hôte, hors allowlist. */
  private async canary(
    settings: SrtSettings,
    srtCli: string,
    dir: string,
    cwd: string,
    env: Record<string, string>,
  ) {
    const o = this.options;
    const secret = join(dir, 'canary-secret');
    writeFileSync(secret, randomUUID(), { mode: 0o600 });
    const canarySettings: SrtSettings = {
      ...settings,
      filesystem: { ...settings.filesystem, denyRead: [...settings.filesystem.denyRead, secret] },
    };
    const file = join(dir, 'canary.json');
    writeFileSync(file, JSON.stringify(canarySettings), { mode: 0o400 });
    const server = createServer((socket) => socket.destroy());
    await new Promise<void>((done, fail) => {
      server.once('error', fail);
      server.listen(0, '127.0.0.1', done);
    });
    const port = (server.address() as AddressInfo).port;
    try {
      const output = await runBounded(
        o.node,
        [srtCli, '--settings', file, '--', o.node, o.canaryProbe, secret, String(port)],
        cwd,
        env,
        o.canaryTimeoutMs ?? 30_000,
      );
      const line = output.trim().split('\n').at(-1) ?? '';
      let verdict: { read?: unknown; connect?: unknown } = {};
      try {
        verdict = JSON.parse(line) as typeof verdict;
      } catch {
        throw unavailable('canari sans verdict : srt absent ou en échec');
      }
      if (verdict.read !== 'denied' || verdict.connect !== 'denied')
        throw unavailable(`canari : lecture ${String(verdict.read)}, connexion ${String(verdict.connect)}`);
    } finally {
      server.close();
    }
  }
}

/** Fin du processus : groupe tué, dossier temporaire retiré. */
function settle(child: ChildProcess, dir: string): Promise<SandboxExit> {
  return new Promise((done) => {
    const finish = (exit: SandboxExit) => {
      killGroup(child.pid, 'SIGKILL');
      rmSync(dir, { recursive: true, force: true });
      done(exit);
    };
    child.once('error', () => finish({ code: null, signal: null }));
    child.once('exit', (code, signal) => finish({ code, signal }));
  });
}

async function stopGroup(child: ChildProcess, exited: Promise<SandboxExit>): Promise<SandboxExit> {
  killGroup(child.pid, 'SIGTERM');
  const timer = setTimeout(() => killGroup(child.pid, 'SIGKILL'), STOP_GRACE_MS);
  try {
    return await exited;
  } finally {
    clearTimeout(timer);
  }
}

/** Lance un processus borné en temps et en octets de sortie ; groupe tué à la fin. */
function runBounded(
  command: string,
  argv: readonly string[],
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
): Promise<string> {
  return new Promise((done) => {
    const child = spawn(command, argv, {
      cwd,
      env,
      detached: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdin.on('error', () => {});
    child.stdin.end();
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      if (output.length < CANARY_OUTPUT_LIMIT) output += chunk.toString('utf8');
    });
    child.stderr.resume();
    const timer = setTimeout(() => killGroup(child.pid, 'SIGKILL'), timeoutMs);
    const finish = () => {
      clearTimeout(timer);
      killGroup(child.pid, 'SIGKILL');
      done(output);
    };
    child.once('error', finish);
    child.once('close', finish);
  });
}
