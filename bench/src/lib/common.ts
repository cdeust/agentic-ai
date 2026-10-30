// Utilitaires communs du banc 1b.0 : mondes jetables, profils srt, lancement borne, enregistrement des resultats.
// Aucun shell : tout passe par spawn/execFile avec un argv. Aucune cle reelle : les cles sont generees a l'execution.
import { spawn, execFile } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const benchRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const srtBin = path.join(benchRoot, 'node_modules/.bin/srt');
// Chemin absolu : un `--import tsx` nu se resout depuis le cwd de la sandbox, qui ne contient pas node_modules.
export const tsxImport = ['--import', import.meta.resolve('tsx')];
const pkgVersion = (name: string): string =>
  (JSON.parse(readFileSync(path.join(benchRoot, 'node_modules', name, 'package.json'), 'utf8')) as { version: string }).version;
export const srtVersion = pkgVersion('@anthropic-ai/sandbox-runtime');
export const agentSdkVersion = pkgVersion('@anthropic-ai/claude-agent-sdk');
export const osName = process.platform === 'darwin' ? 'macos' : process.platform === 'linux' ? 'linux' : process.platform;

/** pass : propriete tenue. fail : propriete violee (fait echouer le banc). residual : echec documente et attendu
 * (le constat correspond au residu ecrit dans la conception). finding : constat de revue, ni reussite ni echec. */
export type Result = 'pass' | 'fail' | 'residual' | 'finding';

export interface Rec {
  id: string;
  title: string;
  os: string;
  srtVersion: string;
  command: string;
  result: Result;
  output: string;
  at: string;
}

const clip = (s: string, n = 2400): string => (s.length > n ? `${s.slice(0, n)}...[+${s.length - n}]` : s);

/** Les valeurs sensibles du banc (cles generees) sont masquees dans le rapport ; la detection de fuite se fait avant. */
const masks = new Set<string>();
export const maskValue = (v: string): void => void masks.add(v);

export function record(id: string, title: string, command: string, result: Result, output: string): Rec {
  let out = output;
  for (const m of masks) out = out.split(m).join('<CLE-DU-BANC>');
  const rec: Rec = { id, title, os: osName, srtVersion, command: clip(command, 600), result, output: clip(out), at: new Date().toISOString() };
  const file = process.env['BENCH_RESULT'];
  if (file) appendFileSync(file, `${JSON.stringify(rec)}\n`);
  console.error(`[${result}] ${id} ${title}`);
  return rec;
}

/** Un monde = un faux HOME jetable avec un faux ~/.ssh/id_test, un repertoire de travail et un dossier de profils
 * en dehors de toute zone inscriptible. */
export interface World {
  root: string;
  tmp: string;
  home: string;
  work: string;
  profiles: string;
  canary: string;
}
export function makeWorld(name: string): World {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), `srt-bench-${name}-`)));
  const home = path.join(root, 'home');
  const work = path.join(home, 'work');
  const profiles = path.join(root, 'profiles');
  // srt fixe TMPDIR=/tmp/claude dans la sandbox (ou CLAUDE_CODE_TMPDIR) sans le creer : tsx et Claude Code y font un mkdir non recursif.
  // Le banc cree un tmp par monde, le transmet par CLAUDE_CODE_TMPDIR et l'ajoute a allowWrite (exigence d'hote decouverte sur le runner).
  const tmp = path.join(root, 'tmp');
  mkdirSync(tmp, { recursive: true });
  mkdirSync(path.join(home, '.ssh'), { recursive: true });
  mkdirSync(work, { recursive: true });
  mkdirSync(profiles, { recursive: true });
  const canary = `CANARY-${randomUUID()}`;
  writeFileSync(path.join(home, '.ssh', 'id_test'), canary);
  writeFileSync(path.join(home, '.zshrc'), 'export CANARY_RC=1\n');
  maskValue(canary);
  return { root, tmp, home, work, profiles, canary };
}

export interface ProfileOpts {
  allowedDomains?: string[];
  allowRead?: string[];
  allowWrite?: string[];
  denyRead?: string[];
  denyWrite?: string[];
  allowUnixSockets?: string[];
  allowLocalBinding?: boolean;
  /** Repertoires temporaires inscriptibles de la sandbox (defaut : w.tmp). */
  tmp?: string[];
  /** network.tlsTerminate (experimental) : necessaire au mode mask. */
  tlsTerminate?: Record<string, unknown>;
  /** Bloc credentials de srt (T-42 : autorisation de task en mode mask). */
  credentials?: Record<string, unknown>;
}
export function writeProfile(w: World, name: string, o: ProfileOpts): string {
  const net: Record<string, unknown> = { allowedDomains: o.allowedDomains ?? [], deniedDomains: [], strictAllowlist: true };
  if (o.allowUnixSockets) net['allowUnixSockets'] = o.allowUnixSockets;
  if (o.allowLocalBinding) net['allowLocalBinding'] = true;
  if (o.tlsTerminate) net['tlsTerminate'] = o.tlsTerminate;
  const fsCfg: Record<string, unknown> = {
    denyRead: o.denyRead ?? ['~'],
    allowRead: o.allowRead ?? [w.work],
    allowWrite: [...(o.allowWrite ?? [w.work]), ...(o.tmp ?? [w.tmp])],
    denyWrite: o.denyWrite ?? [],
  };
  const file = path.join(w.profiles, `${name}.srt.json`);
  writeFileSync(file, JSON.stringify({ network: net, filesystem: fsCfg, ...(o.credentials ? { credentials: o.credentials } : {}) }, null, 2));
  return file;
}

export const baseEnv = (w: World, extra: Record<string, string> = {}): Record<string, string> => ({
  PATH: process.env['PATH'] ?? '/usr/bin:/bin',
  HOME: w.home,
  CLAUDE_CODE_TMPDIR: w.tmp,
  ...extra,
});

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export function killGroup(pid: number | undefined, sig: NodeJS.Signals = 'SIGKILL'): void {
  if (!pid) return;
  try {
    process.kill(-pid, sig);
  } catch {
    /* groupe deja disparu */
  }
}

/** pids dont le groupe de processus est pgid (pgrep -g). */
export function pidsInGroup(pgid: number): Promise<number[]> {
  return new Promise((resolve) => {
    execFile('pgrep', ['-g', String(pgid)], (err, out) => {
      if (err) return resolve([]);
      resolve(out.split('\n').filter(Boolean).map(Number));
    });
  });
}
/** pids dont la ligne de commande contient marker, hors le processus courant. */
export function pidsMatching(marker: string): Promise<number[]> {
  return new Promise((resolve) => {
    execFile('pgrep', ['-f', marker], (err, out) => {
      if (err) return resolve([]);
      resolve(out.split('\n').filter(Boolean).map(Number).filter((p) => p !== process.pid));
    });
  });
}
export function killPids(pids: number[]): void {
  for (const p of pids) {
    try {
      process.kill(p, 'SIGKILL');
    } catch {
      /* deja mort */
    }
  }
}

export interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  pid: number | undefined;
}
export interface RunOpts {
  settings: string;
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs?: number;
  stdio?: Array<'pipe' | 'ignore' | 'inherit' | number | object>;
}
export const srtArgv = (settings: string, argv: string[]): string[] => ['--settings', settings, '--', ...argv];
export const cmdString = (settings: string, argv: string[]): string =>
  `srt --settings ${path.basename(settings)} -- ${argv.map((a) => (a.length > 90 ? `${a.slice(0, 90)}...` : a)).join(' ')}`;

/** Lance un processus sous srt, detache (groupe propre), avec delai maximal et mise a mort du groupe entier. */
export function runSrt(o: RunOpts): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(srtBin, srtArgv(o.settings, o.argv), {
      cwd: o.cwd,
      env: o.env,
      detached: true,
      stdio: (o.stdio ?? ['ignore', 'pipe', 'pipe']) as never,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
    child.stdin?.on('error', () => {});
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child.pid);
    }, o.timeoutMs ?? 60_000);
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: null, signal: null, stdout, stderr: `${stderr}\nspawn error: ${e.message}`, timedOut, pid: child.pid });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      killGroup(child.pid); // aucun survivant du groupe apres la fin normale
      resolve({ code, signal, stdout, stderr, timedOut, pid: child.pid });
    });
  });
}

/** Lance le script sous srt et renvoie la derniere ligne JSON de stdout. */
export async function runSrtJson<T = Record<string, unknown>>(o: RunOpts): Promise<{ run: RunResult; json: T | undefined }> {
  const run = await runSrt(o);
  const lines = run.stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{') || l.startsWith('['));
  let json: T | undefined;
  for (let i = lines.length - 1; i >= 0 && json === undefined; i--) {
    try {
      json = JSON.parse(lines[i] as string) as T;
    } catch {
      /* ligne suivante */
    }
  }
  return { run, json };
}

export const sandboxed = (name: string): string => path.join(benchRoot, 'src/sandboxed', name);
export const randomKey = (): string => {
  const k = `bench-key-${randomUUID()}`;
  maskValue(k);
  return k;
};
export const chmodX = (p: string): void => chmodSync(p, 0o755);

/** Resume court de la sortie d'un run pour le rapport. */
export const brief = (r: RunResult): string =>
  `exit=${r.code} signal=${r.signal} timedOut=${r.timedOut}\nstdout: ${r.stdout.trim().slice(0, 700)}\nstderr: ${r.stderr.trim().slice(0, 500)}`;
