// Orchestrateur : npm run bench:sandbox. Lance chaque fichier de test dans son propre processus (groupe propre, delai
// maximal), rassemble les enregistrements et ecrit reports/bench-sandbox-<os>.json. Un echec reste dans le rapport ;
// le code de sortie est non nul s'il y a au moins un `fail`.
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { arch, release, platform } from 'node:os';
import path from 'node:path';
import { findPgBin } from './lib/pg-cluster.ts';
import { agentSdkVersion, benchRoot, killGroup, osName, srtVersion, type Rec } from './lib/common.ts';

const SUITE: Array<{ file: string; timeoutMs: number }> = [
  { file: 'net', timeoutMs: 180_000 }, // T-03 d'abord : une panne du chemin broker doit etre attribuable avant T-41
  { file: 'fs', timeoutMs: 240_000 },
  { file: 'tree', timeoutMs: 180_000 },
  { file: 'fd', timeoutMs: 90_000 },
  { file: 'fdpipes', timeoutMs: 90_000 },
  { file: 'paths', timeoutMs: 300_000 },
  { file: 'inverted', timeoutMs: 240_000 },
  { file: 'modules', timeoutMs: 240_000 },
  { file: 'broker', timeoutMs: 240_000 },
  { file: 't41', timeoutMs: 420_000 },
  { file: 't42', timeoutMs: 420_000 },
  { file: 't43', timeoutMs: 180_000 },
  { file: 't45', timeoutMs: 300_000 },
];
const only = process.env['BENCH_ONLY']?.split(',');
const outDir = path.join(benchRoot, 'reports');
const workDir = path.join(outDir, 'work');
mkdirSync(workDir, { recursive: true });

const probeTool = (cmd: string, args: string[]): Promise<string> =>
  new Promise((r) => execFile(cmd, args, { timeout: 10_000 }, (e, out, err) => r(e ? `absent (${(e as NodeJS.ErrnoException).code ?? e.message})` : (out || err).split('\n')[0] ?? '')));
const readIf = (p: string): string => (existsSync(p) ? readFileSync(p, 'utf8').trim() : 'n/a');

const meta = {
  os: osName,
  platform: platform(),
  arch: arch(),
  kernel: release(),
  node: process.version,
  srtVersion,
  agentSdkVersion,
  startedAt: new Date().toISOString(),
  hostTools: {
    bwrap: osName === 'linux' ? await probeTool('bwrap', ['--version']) : 'sans objet',
    socat: osName === 'linux' ? await probeTool('socat', ['-V']) : 'sans objet',
    rg: await probeTool('rg', ['--version']),
    sandboxExec: osName === 'macos' ? (existsSync('/usr/bin/sandbox-exec') ? '/usr/bin/sandbox-exec' : 'absent') : 'sans objet',
  },
  postgres: await (async () => { const b = findPgBin(); return b ? probeTool(path.join(b, 'postgres'), ['--version']) : 'absent'; })(),
  openssl: await probeTool('openssl', ['version']),
  brokerLocalhost: await import('node:dns/promises').then((d) => d.lookup('broker.localhost', { all: true })).then((a) => JSON.stringify(a), (e: Error) => `ECHEC ${e.message}`),
  apparmorRestrictUnprivilegedUserns: osName === 'linux' ? readIf('/proc/sys/kernel/apparmor_restrict_unprivileged_userns') : 'sans objet',
  ci: process.env['GITHUB_ACTIONS'] === 'true',
  runUrl: process.env['GITHUB_SERVER_URL'] && process.env['GITHUB_RUN_ID'] ? `${process.env['GITHUB_SERVER_URL']}/${process.env['GITHUB_REPOSITORY']}/actions/runs/${process.env['GITHUB_RUN_ID']}` : null,
  sha: process.env['GITHUB_SHA'] ?? null,
};

const results: Rec[] = [];
for (const t of SUITE) {
  if (only && !only.includes(t.file)) continue;
  const ndjson = path.join(workDir, `${t.file}.ndjson`);
  rmSync(ndjson, { force: true });
  console.error(`\n=== ${t.file} ===`);
  const child = spawn(process.execPath, ['--import', 'tsx', path.join('src/tests', `${t.file}.ts`)], {
    cwd: benchRoot,
    env: { ...process.env, BENCH_RESULT: ndjson },
    stdio: ['ignore', 'inherit', 'pipe'],
    detached: true,
  });
  let err = '';
  child.stderr.on('data', (d: Buffer) => { err += d; process.stderr.write(d); });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; killGroup(child.pid); }, t.timeoutMs);
  const code = await new Promise<number | null>((r) => child.on('close', (c) => r(c)));
  clearTimeout(timer);
  killGroup(child.pid);
  const recs: Rec[] = existsSync(ndjson) ? readFileSync(ndjson, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Rec) : [];
  results.push(...recs);
  if (code !== 0 || timedOut) {
    results.push({ id: `HARNESS-${t.file}`, title: `fichier de test ${t.file} termine anormalement`, os: osName, srtVersion, command: `node --import tsx src/tests/${t.file}.ts`, result: 'fail', output: `exit=${code} timedOut=${timedOut} derniere sortie: ${err.slice(-1200)}`, at: new Date().toISOString() });
  }
}

const count = (r: string): number => results.filter((x) => x.result === r).length;
const summary = { total: results.length, pass: count('pass'), fail: count('fail'), residual: count('residual'), finding: count('finding') };
const report = { meta: { ...meta, finishedAt: new Date().toISOString() }, summary, results };
const file = path.join(outDir, `bench-sandbox-${osName}.json`);
writeFileSync(file, JSON.stringify(report, null, 2));
console.error(`\n${'id'.padEnd(18)} resultat   titre`);
for (const r of results) console.error(`${r.id.padEnd(18)} ${r.result.padEnd(9)}  ${r.title.slice(0, 100)}`);
console.error(`\n${JSON.stringify(summary)} -> ${file}`);
process.exit(summary.fail > 0 ? 1 : 0);
