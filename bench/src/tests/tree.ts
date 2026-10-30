// T-06 (mort de l'arbre), T-06b (enfant setsid), I-6 (timeout qui tue tous les descendants).
import { spawn } from 'node:child_process';
import { baseEnv, cmdString, killGroup, killPids, makeWorld, osName, pidsMatching, record, runSrt, sleep, srtArgv, srtBin, writeProfile, type Result } from '../lib/common.ts';
import { randomUUID } from 'node:crypto';

const w = makeWorld('tree');
const settings = writeProfile(w, 'tree', {});
const treeCmd = (mark: string): string[] => ['sh', '-c', `sleep 300 & sleep 301 & node -e "setInterval(()=>{},1000)" ${mark} & echo ${mark} ; wait`];
const within = <T>(p: Promise<T>, ms: number, label: string): Promise<T | string> => Promise.race([p, sleep(ms).then(() => label)]);

async function scenario(id: string, title: string, sig: NodeJS.Signals, group: boolean, required: boolean) {
  const mark = `benchTree${randomUUID().replaceAll('-', '')}`;
  const child = spawn(srtBin, srtArgv(settings, treeCmd(mark)), { cwd: w.work, env: baseEnv(w), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const exit = new Promise<string>((r) => child.on('exit', (c, s) => r(`code=${c} signal=${s}`)));
  const started = await within(new Promise<string>((r) => child.stdout.once('data', () => r('started'))), 15_000, 'pas-de-sortie');
  await sleep(500);
  const before = (await pidsMatching(mark)).length;
  if (group) killGroup(child.pid, sig); else child.kill(sig);
  const e = await within(exit, 8000, 'srt-pas-sorti-apres-8s');
  await sleep(1000);
  const left = (await pidsMatching(mark)).length;
  killPids(await pidsMatching(mark)); killGroup(child.pid); child.stdout.destroy(); child.stderr.destroy();
  const result: Result = required ? (started === 'started' && left === 0 ? 'pass' : 'fail') : 'finding';
  record(id, title, cmdString(settings, treeCmd(mark)), result, `${started} procs_avant=${before} sortie=${e} procs_restants=${left}`);
}
await scenario('T-06-g-TERM', 'SIGTERM au groupe (detached) : plus aucun descendant', 'SIGTERM', true, true);
await scenario('T-06-g-KILL', 'SIGKILL au groupe (detached) : plus aucun descendant', 'SIGKILL', true, true);
await scenario('T-06-s-TERM', 'SIGTERM a srt seul (constat : ce qui reste)', 'SIGTERM', false, false);
await scenario('T-06-s-KILL', 'SIGKILL a srt seul (constat : ce qui reste)', 'SIGKILL', false, false);

// I-6 : delai maximal tenu par l'orchestrateur, mort du groupe, verification.
{
  const mark = `benchTimeout${randomUUID().replaceAll('-', '')}`;
  const t0 = performance.now();
  const r = await runSrt({ settings, argv: treeCmd(mark), cwd: w.work, env: baseEnv(w), timeoutMs: 4000 });
  await sleep(1000);
  const left = (await pidsMatching(mark)).length;
  killPids(await pidsMatching(mark));
  record('I-6', 'timeout 4 s : arbre sh + 2 sleep + node tue, plus aucun descendant', cmdString(settings, treeCmd(mark)), r.timedOut && left === 0 ? 'pass' : 'fail', `timedOut=${r.timedOut} ms=${Math.round(performance.now() - t0)} restants=${left}`);
}

// T-06b : un enfant setsid echappe au groupe. macOS : residu documente. Linux : l'espace PID de bubblewrap doit le fermer.
{
  const mark = `benchEsc${randomUUID().replaceAll('-', '')}`;
  const inner = `require("child_process").spawn("node",["-e","setInterval(()=>{},1000)","${mark}"],{detached:true,stdio:"ignore"}).unref();console.log("ok");setInterval(()=>{},1000)`;
  const argv = ['node', '-e', inner];
  const child = spawn(srtBin, srtArgv(settings, argv), { cwd: w.work, env: baseEnv(w), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const started = await within(new Promise<string>((r) => child.stdout.once('data', () => r('started'))), 15_000, 'pas-de-sortie');
  await sleep(700);
  const before = (await pidsMatching(mark)).length;
  killGroup(child.pid);
  await sleep(1000);
  const left = (await pidsMatching(mark)).length;
  killPids(await pidsMatching(mark));
  const result: Result = left === 0 ? 'pass' : osName === 'macos' ? 'residual' : 'fail';
  record('T-06b', `enfant setsid apres kill du groupe${osName === 'macos' ? ' (macOS : survivant = residu documente)' : ' (Linux : doit etre 0, PID namespace)'}`, cmdString(settings, argv), started === 'started' ? result : 'fail', `${started} avant=${before} apres_kill_groupe=${left}`);
}
process.exit(0);
