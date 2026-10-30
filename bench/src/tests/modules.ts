// E-01 (MCP standard sous srt), T-38 (module workflow, egress nul), T-39 (module joint par la gateway native en stdio).
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { baseEnv, benchRoot, killGroup, killPids, makeWorld, pidsMatching, record, sandboxed, sleep, srtBin, srtArgv, tsxImport, writeProfile } from '../lib/common.ts';

const w = makeWorld('modules');
const serverFile = sandboxed('module-server.ts');
// Profil du module workflow : egress nul, ni ~ ni socket Postgres. Lecture : le travail et le code du banc (node_modules).
const settings = writeProfile(w, 'workflow-egress-none', { allowRead: [w.work, benchRoot] });

let tcpConns = 0;
const tcpSrv = net.createServer((c) => { tcpConns++; c.end('hote\n'); });
await new Promise<void>((r) => tcpSrv.listen(0, '127.0.0.1', () => r()));
const tcpPort = (tcpSrv.address() as AddressInfo).port;
const pgDir = path.join(w.root, 'pgsock');
mkdirSync(pgDir);
const pgPath = path.join(pgDir, '.s.PGSQL.5432');
let pgConns = 0;
const pgSrv = net.createServer((c) => { pgConns++; c.end('pg\n'); });
await new Promise<void>((r) => pgSrv.listen(pgPath, () => r()));

async function gatewayConnect(tag: string) {
  const argv = ['node', ...tsxImport, serverFile, `--task=${tag}`];
  const transport = new StdioClientTransport({
    command: srtBin,
    args: srtArgv(settings, argv),
    cwd: w.work,
    env: { ...getDefaultEnvironment(), ...baseEnv(w), NODE_USE_ENV_PROXY: '1' },
    stderr: 'pipe',
  });
  let err = '';
  transport.stderr?.on('data', (d: Buffer) => (err += d));
  const client = new Client({ name: 'bench-gateway', version: '0.0.0' });
  const t0 = performance.now();
  await client.connect(transport);
  return { client, transport, err: () => err, initMs: Math.round(performance.now() - t0), cmd: `srt --settings workflow-egress-none.srt.json -- ${argv.join(' ')}` };
}
const textOf = (r: unknown): string => ((r as { content: Array<{ text: string }> }).content[0] as { text: string }).text;

// ---- E-01 + T-38 ----
const tag38 = `m38-${randomUUID()}`;
try {
  const g = await gatewayConnect(tag38);
  const tools = (await g.client.listTools()).tools.map((t) => t.name);
  const e = textOf(await g.client.callTool({ name: 'echo', arguments: { text: 'bonjour' } }));
  const N = 1000; const t1 = performance.now(); let bad = 0;
  for (let i = 0; i < N; i++) if (textOf(await g.client.callTool({ name: 'echo', arguments: { text: `m${i}` } })) !== `m${i}`) bad++;
  const rt = Math.round(performance.now() - t1);
  const payloads: string[] = []; let payloadOk = true;
  for (const size of [1 << 16, 1 << 20, 8 << 20]) {
    const t = performance.now();
    const r = textOf(await g.client.callTool({ name: 'echo', arguments: { text: 'x'.repeat(size) } }));
    payloadOk &&= r.length === size; payloads.push(`${size}o ok=${r.length === size} ${Math.round(performance.now() - t)}ms`);
  }
  record('E-01', 'MCP standard : client officiel -> srt -> serveur stdio ; 1000 allers-retours, charges 64 Kio, 1 Mio, 8 Mio', g.cmd,
    e === 'bonjour' && bad === 0 && payloadOk && tools.includes('echo') ? 'pass' : 'fail',
    `initialize_ms=${g.initMs} tools=${tools.join(',')} roundtrips=${N} mismatches=${bad} total_ms=${rt} ${payloads.join(' ; ')}`);

  const probe = JSON.parse(textOf(await g.client.callTool({ name: 'probe', arguments: { tcpPort, unixPath: pgPath, canary: path.join(w.home, '.ssh', 'id_test'), home: w.home } }))) as Record<string, string>;
  const refusedFetch = (v: string | undefined): boolean => typeof v === 'string' && !v.startsWith('HTTP-2');
  const checks = {
    tcp_direct: probe['tcp_direct'] !== 'CONNECTE',
    unix_pg: probe['unix_pg'] !== 'CONNECTE',
    fetch_external: refusedFetch(probe['fetch_external']),
    fetch_host_loopback: refusedFetch(probe['fetch_host_loopback']),
    read_ssh: probe['read_ssh'] !== 'LU',
    // Linux masque ~ par un tmpfs : la liste peut reussir mais ne montre rien de sensible ; macOS refuse (EPERM).
    list_home: !/\.ssh|\.zshrc/.test(probe['list_home'] ?? '.ssh'),
    host_tcp_untouched: tcpConns === 0,
    host_pg_untouched: pgConns === 0,
    tools_call_works: e === 'bonjour',
  };
  const ok = Object.values(checks).every(Boolean);
  record('T-38', 'module workflow stdio, profil egress nul : sortie refusee, ni socket Postgres ni ~, tools/call fonctionne', g.cmd, ok ? 'pass' : 'fail',
    `sonde=${JSON.stringify(probe)} verifs=${JSON.stringify(checks)} connexions_vues_par_l_hote tcp=${tcpConns} pg=${pgConns}`);
  await g.client.close();
  await sleep(1000);
  const left = await pidsMatching(tag38);
  killPids(left);
  record('T-38-close', 'fermeture du client stdio par la gateway : plus aucun processus du module', 'pgrep -f <tag>', left.length === 0 ? 'pass' : 'fail', `restants=${left.length}`);
} catch (err) {
  record('T-38', 'module workflow stdio, profil egress nul', 'srt + module', 'fail', `EXCEPTION ${(err as Error).message}`);
}

// ---- T-39 ----
const tag39 = `m39-${randomUUID()}`;
try {
  const g = await gatewayConnect(tag39);
  const echo = textOf(await g.client.callTool({ name: 'echo', arguments: { text: 'via-stdio' } }));
  const l = JSON.parse(textOf(await g.client.callTool({ name: 'listen_http', arguments: {} }))) as { listening: boolean; port?: number; error?: string };
  let hostReach = 'non-tente';
  if (l.listening && l.port) {
    hostReach = await new Promise<string>((resolve) => {
      const c = net.connect(l.port as number, '127.0.0.1');
      c.setTimeout(2000, () => { c.destroy(); resolve('TIMEOUT'); });
      c.on('connect', () => { c.destroy(); resolve('CONNECTE'); });
      c.on('error', (e: NodeJS.ErrnoException) => resolve(e.code ?? e.message));
    });
  }
  record('T-39a', 'module sous srt joint par la gateway native en stdio : tools/call fonctionne, aucun port', g.cmd, echo === 'via-stdio' ? 'pass' : 'fail', `echo=${echo}`);
  record('T-39b', 'module qui devrait ecouter en HTTP : la gateway native ne peut pas le joindre (T-07)', g.cmd,
    hostReach !== 'CONNECTE' ? 'pass' : 'fail', `listen dans la sandbox=${JSON.stringify(l)} ; connexion de l'hote au port=${hostReach} (macOS : listen refuse ; Linux : ecoute possible dans le netns propre mais injoignable)`);

  // Pont natif minimal : un HTTP natif (gateway) relaie vers le module par stdio.
  const bridge = http.createServer((q, r) => {
    let b = ''; q.on('data', (d: Buffer) => (b += d));
    q.on('end', () => {
      void (async () => {
        try {
          const { name, arguments: args } = JSON.parse(b) as { name: string; arguments: Record<string, unknown> };
          const res = await g.client.callTool({ name, arguments: args });
          r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify(res));
        } catch (e) { r.writeHead(500); r.end(String(e)); }
      })();
    });
  });
  await new Promise<void>((r) => bridge.listen(0, '127.0.0.1', () => r()));
  const bp = (bridge.address() as AddressInfo).port;
  const resp = await fetch(`http://127.0.0.1:${bp}/`, { method: 'POST', body: JSON.stringify({ name: 'echo', arguments: { text: 'via-pont-http' } }) });
  const viaBridge = textOf(await resp.json());
  record('T-39c', 'pont natif HTTP->stdio : un client HTTP atteint le module sandboxe par la gateway', `POST 127.0.0.1:${bp} -> stdio -> ${g.cmd.slice(0, 80)}`, viaBridge === 'via-pont-http' ? 'pass' : 'fail', `reponse=${viaBridge}`);
  bridge.close();
  await g.client.close();
  await sleep(800);
  killPids(await pidsMatching(tag39));
} catch (err) {
  record('T-39', 'module via gateway stdio', 'srt + module', 'fail', `EXCEPTION ${(err as Error).message}`);
}
tcpSrv.close(); pgSrv.close();
void killGroup;
process.exit(0);
