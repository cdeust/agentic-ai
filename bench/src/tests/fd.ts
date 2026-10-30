// T-07 : un descripteur d'ecoute herite (fd 3, fd 0) ne permet pas a la sandbox de servir au nom de l'hote.
import net from 'node:net';
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { baseEnv, killGroup, makeWorld, record, sleep, srtArgv, srtBin, writeProfile } from '../lib/common.ts';

const w = makeWorld('fd');
const settings = writeProfile(w, 'fd', {});
async function variant(id: string, title: string, slot: 0 | 3) {
  const srv = net.createServer();
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const port = (srv.address() as AddressInfo).port;
  const script = `const net=require('net');const s=net.createServer(c=>{c.end('servi-depuis-sandbox\\n')});s.on('error',e=>{console.log('enfant erreur',e.code);process.exit(3)});s.listen({fd:${slot}},()=>console.log('enfant ecoute fd${slot}'));setTimeout(()=>process.exit(0),4000)`;
  const stdio: unknown[] = slot === 0 ? [(srv as unknown as { _handle: unknown })._handle, 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe', (srv as unknown as { _handle: unknown })._handle];
  const child = spawn(srtBin, srtArgv(settings, ['node', '-e', script]), { cwd: w.work, env: baseEnv(w), stdio: stdio as never, detached: true });
  let out = '';
  child.stdout?.on('data', (d: Buffer) => (out += d));
  child.stderr?.on('data', (d: Buffer) => (out += d));
  await sleep(2000);
  const answer = await new Promise<string>((resolve) => {
    const c = net.connect(port, '127.0.0.1');
    let d = '';
    c.on('data', (x) => (d += x));
    c.setTimeout(1500, () => c.destroy());
    c.on('close', () => resolve(d));
    c.on('error', () => resolve(d));
  });
  killGroup(child.pid); srv.close();
  record(id, title, `srt -- node -e <listen({fd:${slot}})>`, answer.includes('servi-depuis-sandbox') ? 'fail' : 'pass', `reponse recue par le client=${JSON.stringify(answer)} ; sortie enfant=${out.trim().slice(0, 300)}`);
}
await variant('T-07-fd3', 'fd 3 herite (socket d\'ecoute de l\'hote) : non utilisable par la sandbox', 3);
await variant('T-07-fd0', 'fd 0 = socket d\'ecoute de l\'hote : non utilisable par la sandbox', 0);
process.exit(0);
