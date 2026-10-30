// FD-PIPES (§4.8 point 5) : test d'HOTE de l'obligation « fd 0 a 2 uniquement des tubes ». Le helper de lancement du banc (assertStdioPipes, utilise par runSrt)
// refuse de lancer une sandbox avec un autre type de descripteur. T-07-fd0 (fd.ts) reste inchange et visible : il documente le comportement BRUT de srt.
import { execFile } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { StdioRefused, baseEnv, makeWorld, pidsMatching, record, runSrt, sleep, writeProfile } from '../lib/common.ts';

const w = makeWorld('fdpipes');
const settings = writeProfile(w, 'fdpipes', {});
const mark = `fdpipes-${process.pid}`;
const listener = async () => {
  const srv = net.createServer((c) => c.end('servi-par-l-hote\n'));
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  return { srv, port: (srv.address() as AddressInfo).port, handle: (srv as unknown as { _handle: { fd: number } })._handle };
};
const script = `const net=require('net');const s=net.createServer(c=>c.end('servi-depuis-sandbox\\n'));s.listen({fd:0},()=>console.log('${mark}'));setTimeout(()=>process.exit(0),2500)`;
async function attempt(id: string, title: string, mk: (l: Awaited<ReturnType<typeof listener>>) => unknown[], expectRefused: boolean) {
  const l = await listener();
  let refused = false;
  let msg = '';
  let spawned = false;
  try {
    const p = runSrt({ settings, argv: ['node', '-e', script, mark], cwd: w.work, env: baseEnv(w), stdio: mk(l) as never, timeoutMs: 8000 });
    spawned = true; // runSrt ne retourne la promesse qu'apres la garde synchrone
    await p;
  } catch (e) {
    if (e instanceof StdioRefused) { refused = true; msg = e.message; } else throw e;
  }
  await sleep(300);
  const alive = (await pidsMatching(mark)).length;
  const answer = await new Promise<string>((resolve) => {
    const c = net.connect(l.port, '127.0.0.1');
    let d = '';
    c.on('data', (x) => (d += x));
    c.setTimeout(800, () => c.destroy());
    c.on('close', () => resolve(d));
    c.on('error', () => resolve(d));
  });
  l.srv.close();
  const ok = expectRefused ? refused && alive === 0 && !answer.includes('servi-depuis-sandbox') : !refused && spawned;
  record(id, title, 'runSrt(stdio) avec garde assertStdioPipes', ok ? 'pass' : 'fail', `refuse=${refused} (${msg || 'sans objet'}) processus_enfant_vivants=${alive} reponse_du_client_hote=${JSON.stringify(answer)}`);
}
await attempt('FD-PIPES-a', 'cas T-07-fd0 : socket d\'ecoute de l\'hote (handle) en fd 0 : le helper refuse, aucun enfant lance', (l) => [l.handle, 'pipe', 'pipe'], true);
await attempt('FD-PIPES-b', 'socket d\'ecoute de l\'hote passe en fd numerique 0 : refuse', (l) => [l.handle.fd, 'pipe', 'pipe'], true);
await attempt('FD-PIPES-c', "'inherit' pour fd 0 (type du descripteur du parent inconnu) : refuse", () => ['inherit', 'pipe', 'pipe'], true);
await attempt('FD-PIPES-d', 'socket d\'ecoute en fd 1 ou 2 : refuse', (l) => ['ignore', l.handle, 'pipe'], true);
{
  // Fichier ordinaire en fd 2 : refuse. FIFO en fd numerique : autorise (un tube, c'est le contrat).
  const fifo = path.join(w.root, 'fifo');
  await promisify(execFile)('mkfifo', [fifo]);
  const fd = openSync(fifo, 'r+');
  const file = openSync(path.join(w.root, 'plain'), 'w');
  let fileRefused = false;
  try { await runSrt({ settings, argv: ['node', '-e', '0'], cwd: w.work, env: baseEnv(w), stdio: ['ignore', 'pipe', file], timeoutMs: 5000 }); } catch (e) { fileRefused = e instanceof StdioRefused; }
  let fifoOk = false;
  try { const r = await runSrt({ settings, argv: ['node', '-e', 'console.log("ok")'], cwd: w.work, env: baseEnv(w), stdio: ['ignore', fd, 'pipe'], timeoutMs: 20_000 }); fifoOk = r.code === 0; } catch { fifoOk = false; }
  closeSync(fd); closeSync(file);
  record('FD-PIPES-e', 'fichier ordinaire en fd 2 : refuse ; FIFO en fd numerique 1 : autorise et la sandbox s\'execute', 'runSrt(stdio)', fileRefused && fifoOk ? 'pass' : 'fail', `fichier_refuse=${fileRefused} fifo_execute=${fifoOk}`);
}
{
  const r = await runSrt({ settings, argv: ['node', '-e', 'console.log("tubes-ok")'], cwd: w.work, env: baseEnv(w), timeoutMs: 20_000 });
  record('FD-PIPES-f', 'temoin positif : lancement par tubes (pipe) autorise, la sandbox s\'execute', 'runSrt(stdio par defaut)', r.stdout.includes('tubes-ok') ? 'pass' : 'fail', `exit=${r.code} stdout=${r.stdout.trim()}`);
  // fd 3 (hors 0 a 2) : le helper ne l'interdit pas ; T-07-fd3 (fd.ts) prouve que srt le contient. Note, pas de test ici.
}
process.exit(0);
