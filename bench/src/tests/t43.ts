// T-43 (§11.2, I-11) : un processus natif etranger, meme uid, hors sandbox, joint le listener d'une task sans autorisation valide.
// Remplace le constat BROKER-FOREIGN (broker sans autorisation : 200). Le broker lease-less reste joue ici comme TEMOIN.
import { execFile, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { baseEnv, benchRoot, killGroup, makeWorld, randomKey, record, sleep, srtArgv, srtBin, sandboxed, writeProfile } from '../lib/common.ts';
import { startBroker, startUpstream } from '../lib/fake-upstream.ts';
import { makePki, newLease, startLeaseBroker, startRecordingUpstream } from '../lib/lease-broker.ts';

const w = makeWorld('t43');
const key = randomKey();
const leaseA = newLease();
const leaseB = newLease();
mkdirSync(path.join(w.root, 'pki'), { recursive: true });
const pki = await makePki(path.join(w.root, 'pki'));
const up = await startRecordingUpstream();
const A = await startLeaseBroker({ upstreamPort: up.port, key, lease: leaseA, pki });
const B = await startLeaseBroker({ upstreamPort: up.port, key, lease: leaseB, pki });
type Reply = { status?: number; body?: string; error?: string };
async function foreign(port: number, hdr: Record<string, string>, scheme: 'https' | 'http' = 'https'): Promise<Reply> {
  const r = await promisify(execFile)(process.execPath, [sandboxed('foreign-lease-client.mjs'), String(port), scheme, JSON.stringify(hdr)], { cwd: benchRoot, env: { PATH: process.env['PATH'] ?? '' }, timeout: 30_000 }).catch((e: Error) => ({ stdout: JSON.stringify({ error: `ECHEC ${e.message}` }), stderr: '' }));
  try { return JSON.parse(r.stdout.trim().split('\n').pop() ?? '') as Reply; } catch { return { error: `illisible ${r.stdout.slice(0, 80)}` }; }
}

// T-43a : sans autorisation, sentinelle, autorisation d'une autre task (dans x-api-key, puis dans Authorization), x-api-key vide, GET.
const before = up.log.length;
const cases: Array<[string, Record<string, string>]> = [
  ['sans-en-tete', {}],
  ['sentinelle', { 'x-api-key': 'fake_value_00000000-0000-0000-0000-000000000000' }],
  ['cle-vide', { 'x-api-key': '' }],
  ['autorisation-de-B', { 'x-api-key': leaseB }],
  ['autorisation-de-B-en-Authorization', { authorization: `Bearer ${leaseB}` }],
  ['autorisation-de-B-prefixe-A', { 'x-api-key': leaseB.slice(0, 32) + leaseA.slice(32) }],
  ['prefixe-de-A', { 'x-api-key': leaseA.slice(0, 63) }],
  ['la-vraie-cle-amont', { 'x-api-key': key }],
];
const replies = new Map<string, Reply>();
for (const [n, h] of cases) replies.set(n, await foreign(A.port, h));
const all401 = [...replies.values()].every((r) => r.status === 401);
const noUp = up.log.length === before;
record('T-43a', 'natif etranger vers le listener de la task A : sans autorisation, sentinelle, autorisation de B, prefixes, cle amont : 401 chaque fois, rien a l\'amont', 'node foreign-lease-client.mjs <port> (sans srt)', all401 && noUp ? 'pass' : 'fail',
  `reponses=${JSON.stringify([...replies].map(([n, r]) => [n, r.status ?? r.error]))} requetes_amont_ajoutees=${up.log.length - before} decisions_A=${JSON.stringify(A.decisions.map((d) => d.reason).filter((x, i, a) => a.indexOf(x) === i))}`);

// T-43b : rejeu croise (l'autorisation de A sur le listener de B), et l'autorisation de A apres fermeture du listener de A.
const cross = await foreign(B.port, { 'x-api-key': leaseA });
const okOwn = await foreign(A.port, { 'x-api-key': leaseA });
const upAfterOk = up.log.length;
A.close();
await sleep(300);
const afterClose = await foreign(A.port, { 'x-api-key': leaseA });
record('T-43b', 'rejeu : l\'autorisation de la task A sur le listener de la task B refuse (401) ; temoin positif : A sur A passe (200) ; apres fermeture du listener de A, plus de reponse', 'node foreign-lease-client.mjs', cross.status === 401 && okOwn.status === 200 && upAfterOk === before + 1 && afterClose.error !== undefined ? 'pass' : 'fail',
  `A_sur_B=${JSON.stringify(cross)} A_sur_A=${okOwn.status} apres_fermeture=${JSON.stringify(afterClose)} requetes_amont_depuis_le_debut=${up.log.length}`);

// T-43c : temoin, l'ancien comportement (BROKER-FOREIGN) : un broker sans autorisation sert l'etranger.
{
  const legacyUp = await startUpstream();
  const legacy = await startBroker({ upstreamPort: legacyUp.port, key });
  const r = await foreign(legacy.port, {}, 'http');
  record('T-43-temoin', 'TEMOIN : broker sans autorisation (ancien comportement, constat BROKER-FOREIGN) : l\'etranger obtient 200 et la cle part a l\'amont', 'node foreign-lease-client.mjs <port> http', r.status === 200 && legacyUp.log.some((l) => l.key === key) ? 'pass' : 'fail',
    `reponse=${JSON.stringify(r)} cle_arrivee_a_l_amont=${legacyUp.log.some((l) => l.key === key)} (le temoin DOIT reussir : sinon T-43a ne prouve rien)`);
  legacy.close(); legacyUp.close();
}

// T-43d : constat, hors perimetre de l'autorisation. Un natif de meme uid lit l'environnement du processus srt, ou la gateway pose l'autorisation.
{
  const leaseC = newLease();
  const C = await startLeaseBroker({ upstreamPort: up.port, key, lease: leaseC, pki });
  const profile = writeProfile(w, 't43d', { allowedDomains: [], allowRead: [w.work] });
  const child = spawn(srtBin, srtArgv(profile, ['sleep', '20']), { cwd: w.work, env: baseEnv(w, { ANTHROPIC_API_KEY: leaseC }), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  await sleep(2500);
  let seen = 'non lisible';
  let via = '';
  if (process.platform === 'linux') {
    via = `/proc/${child.pid}/environ`;
    try { seen = readFileSync(via, 'latin1'); } catch (e) { seen = `ECHEC ${(e as NodeJS.ErrnoException).code}`; }
  } else {
    via = `ps -Eww -p ${child.pid}`;
    seen = await promisify(execFile)('ps', ['-Eww', '-p', String(child.pid)], { timeout: 10_000 }).then((r) => r.stdout, (e: Error) => `ECHEC ${e.message.slice(0, 80)}`);
  }
  const m = seen.match(/ANTHROPIC_API_KEY=([0-9a-f]{64})/);
  const stolen = m?.[1] === leaseC;
  let replay: Reply = { error: 'sans objet' };
  const n0 = up.log.length;
  if (stolen) replay = await foreign(C.port, { 'x-api-key': leaseC });
  killGroup(child.pid);
  record('T-43d', 'CONSTAT : un natif de meme uid lit l\'autorisation dans l\'environnement du processus srt (gateway) et la rejoue', via, 'finding',
    `lecture_par=${via} autorisation_lue=${stolen} rejeu_status=${replay.status ?? replay.error} requetes_amont_ajoutees=${up.log.length - n0}. ` +
    (stolen && replay.status === 200 ? 'CONSTAT : l\'autorisation protege contre un processus qui ne la connait pas, pas contre un processus de meme uid qui lit l\'environnement du processus srt. Decision du proprietaire (hors perimetre du document : §11.1 modele de confiance).' : 'Lecture impossible : pas de rejeu possible par cette voie.'));
  C.close();
}
B.close(); up.close();
process.exit(0);
