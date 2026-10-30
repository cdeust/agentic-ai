// T-03 (loopback hote), U (socket Unix hote), I-2 (aucune connexion sortante de l'executor).
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { baseEnv, brief, cmdString, makeWorld, osName, record, runSrtJson, sandboxed, writeProfile, type Result } from '../lib/common.ts';

const w = makeWorld('net');
let conns = 0;
const hostSrv = http.createServer((q, r) => r.end(`hote-atteint ${q.url}`));
hostSrv.on('connection', () => conns++);
await new Promise<void>((r) => hostSrv.listen(0, '127.0.0.1', () => r()));
const port = (hostSrv.address() as AddressInfo).port;
const sockPath = path.join(w.root, 'host.sock');
let unixConns = 0;
const unixSrv = net.createServer((c) => { unixConns++; c.end('hote\n'); });
await new Promise<void>((r) => unixSrv.listen(sockPath, () => r()));

const probe = sandboxed('net-probe.mjs');
type Out = { reached?: boolean; error?: string; status?: number };
async function run(id: string, title: string, prof: Parameters<typeof writeProfile>[2], mode: string, arg: string, argvPrefix: string[], expectReached: boolean, residualWhenReached = false) {
  const settings = writeProfile(w, id, { allowRead: [w.work, path.dirname(probe)], ...prof });
  const argv = [...argvPrefix, 'node', probe, mode, arg];
  const before = conns + unixConns;
  const { run, json } = await runSrtJson<Out>({ settings, argv, cwd: w.work, env: baseEnv(w), timeoutMs: 30_000 });
  const reached = json?.reached === true;
  let result: Result = reached === expectReached ? 'pass' : 'fail';
  if (result === 'fail' && reached && residualWhenReached) result = 'residual';
  if (!json) result = 'fail';
  record(id, title, cmdString(settings, argv), result, `sonde=${JSON.stringify(json)} connexions_vues_par_l_hote=${conns + unixConns - before}\n${json ? '' : brief(run)}`);
  return { reached, result, hostSaw: conns + unixConns - before };
}
const clear = ['env', '-u', 'NO_PROXY', '-u', 'no_proxy', 'NODE_USE_ENV_PROXY=1'];
const a = await run('T-03a', 'reseau nul, connexion directe au loopback hote : refusee', {}, 'direct', String(port), [], false);
const b = await run('T-03b', 'reseau nul, via proxy (NO_PROXY vide) : refuse par la liste', {}, 'proxy', String(port), clear, false);
await run('T-03c', 'liste 127.0.0.1:port, connexion directe : refusee', { allowedDomains: [`127.0.0.1:${port}`] }, 'direct', String(port), [], false);
await run('T-03d', 'liste, NODE_USE_ENV_PROXY sans vider NO_PROXY : refusee', { allowedDomains: [`127.0.0.1:${port}`] }, 'proxy', String(port), ['env', 'NODE_USE_ENV_PROXY=1'], false);
await run('T-03e', 'liste 127.0.0.1:port, via proxy (NO_PROXY vide) : atteint', { allowedDomains: [`127.0.0.1:${port}`] }, 'proxy', String(port), clear, true);
// f : documente. macOS : allowLocalBinding ouvre tout le loopback sans proxy (residu). Linux : ignore, netns propre (README).
await run('T-03f', `allowLocalBinding, connexion directe (${osName === 'macos' ? 'macOS : atteint = residu documente' : 'Linux : ignore, doit etre refuse'})`, { allowLocalBinding: true }, 'direct', String(port), [], osName !== 'macos', osName === 'macos');
const u = await run('T-03U', 'reseau nul, socket Unix de l\'hote : refuse', {}, 'unix', sockPath, [], false);

const i2ok = !a.reached && !b.reached && !u.reached && a.hostSaw === 0 && u.hostSaw === 0;
record('I-2', 'aucune connexion sortante de l\'executor (direct, proxy, Unix, loopback)', 'T-03a + T-03b + T-03U', i2ok ? 'pass' : 'fail', `a.reached=${a.reached} b.reached=${b.reached} unix.reached=${u.reached} a.hostSaw=${a.hostSaw} u.hostSaw=${u.hostSaw}`);
hostSrv.close(); unixSrv.close(); process.exit(0);
