// T-42 (docs/design/platform-v3-srt.md §11.2) : autorisation de task posee HORS sandbox par srt (mask + tlsTerminate + broker.localhost).
// Le worker sous srt ne voit qu'une sentinelle ; le proxy srt pose l'autorisation a la sortie vers broker.localhost ; le broker la compare,
// puis construit lui-meme la requete amont avec la cle reelle dans le seul x-api-key. Le test etablit aussi ce qui fuit reellement.
import { lookup } from 'node:dns/promises';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { baseEnv, brief, cmdString, makeWorld, randomKey, record, runSrtJson, sandboxed, writeProfile, type Result } from '../lib/common.ts';
import { makePki, newLease, placements, recoverable, startLeaseBroker, startRecordingUpstream, startSink } from '../lib/lease-broker.ts';

const w = makeWorld('t42');
const key = randomKey();
const lease = newLease();
const dns = await lookup('broker.localhost', { all: true }).then((a) => JSON.stringify(a), (e: Error) => `ECHEC ${e.message}`);
mkdirSync(path.join(w.root, 'pki'), { recursive: true });
const pki = await makePki(path.join(w.root, 'pki'));
const up = await startRecordingUpstream();
const broker = await startLeaseBroker({ upstreamPort: up.port, key, lease, pki });
const evilTls = await startSink(pki);
const evilPlain = await startSink(undefined);
const bp = broker.port;

const profile = writeProfile(w, 't42', {
  allowedDomains: [`broker.localhost:${bp}`, `evil.localhost:${evilTls.port}`, `evil.localhost:${evilPlain.port}`],
  allowRead: [w.work, path.dirname(sandboxed('x'))],
  tlsTerminate: {},
  credentials: { envVars: [{ name: 'ANTHROPIC_API_KEY', mode: 'mask', injectHosts: ['broker.localhost'] }] },
});
// L'autorisation n'existe que dans l'environnement du processus srt (hote) ; NODE_EXTRA_CA_CERTS fait approuver le certificat du broker par le proxy.
const argv = ['env', '-u', 'NO_PROXY', '-u', 'no_proxy', 'NODE_USE_ENV_PROXY=1', 'node', sandboxed('lease-worker.mjs'), JSON.stringify({ brokerPort: bp, evilPort: evilPlain.port, evilTlsPort: evilTls.port })];
const env = baseEnv(w, { ANTHROPIC_API_KEY: lease, NODE_EXTRA_CA_CERTS: pki.certPath });
type Call = { name: string; status?: number; error?: string; message?: string; headers?: Record<string, string>; body?: string };
type Out = { sentinel: string | null; env: string[]; dump: string; files: string; filesRead: number; calls: Call[] };
const { run, json } = await runSrtJson<Out>({ settings: profile, argv, cwd: w.work, env, timeoutMs: 240_000 });
const cmd = cmdString(profile, argv);
const ctx = `broker.localhost=${dns} ; ${pki.opensslVersion}`;

if (!json) {
  record('T-42', 'autorisation de task par mask + tlsTerminate + broker.localhost : le worker n\'a pas rendu de resultat', cmd, 'fail', `${ctx}\n${brief(run)}\nFIN stderr: ${run.stderr.slice(-1500)}`);
} else {
  const call = (n: string): Call => json.calls.find((c) => c.name === n) ?? { name: n, error: 'ABSENT' };
  const received = (c: Call): string => `${JSON.stringify(c.headers ?? {})}${c.body ?? ''}${c.error ?? ''}`;
  const everythingSeen = JSON.stringify(json);
  const dec = (reason: string): number => broker.decisions.filter((d) => d.reason === reason).length;
  const forwardedToUp = up.log.filter((l) => l.url.startsWith('/v1/messages'));

  // T-42a : temoin positif (le mask a bien eu lieu) et invisibilite de l'autorisation pour le worker.
  const sentinelOk = !!json.sentinel && json.sentinel !== lease && json.sentinel.startsWith('fake_value');
  const invisible = !json.env.join('\n').includes(lease) && !json.dump.includes(lease) && !json.files.includes(lease) && !run.stdout.includes(lease) && !run.stderr.includes(lease);
  record('T-42a', 'le worker ne lit pas l\'autorisation : env = sentinelle, ni /proc, ni ps, ni fichiers lisibles, ni sortie', cmd, sentinelOk && invisible ? 'pass' : 'fail',
    `${ctx} ; sentinelle=${sentinelOk ? 'fake_value_*' : String(json.sentinel)} ; autorisation_visible=${!invisible} ; taille_dump=${json.dump.length} fichiers_lus=${json.filesRead} octets=${json.files.length}`);

  // T-42b : la requete ordinaire aboutit, l'amont recoit la cle reelle dans le seul x-api-key.
  const ok = call('ok');
  const first = forwardedToUp[0];
  const placedKey = first ? placements(first, key) : [];
  record('T-42b', 'POST /v1/messages ordinaire : sentinelle -> autorisation (proxy srt) -> broker -> cle reelle dans x-api-key seul', cmd,
    ok.status === 200 && JSON.stringify(placedKey) === '["header:x-api-key"]' ? 'pass' : 'fail',
    `${ctx} ; reponse=${ok.status ?? ok.error} ${ok.message ?? ''} ; decisions_broker=${JSON.stringify(broker.decisions.slice(0, 3))} ; cle_placee_a_l_amont=${JSON.stringify(placedKey)}`);

  // T-42c : T-04 e rejoue. Le proxy srt remplace la sentinelle partout (corps compris) : le broker doit refuser, rien ne part a l'amont.
  const misplaced = ['body', 'header-extra', 'authorization', 'authorization-et-cle'].map(call);
  const refusedAll = misplaced.every((c) => c.status === 403);
  record('T-42c', 'sentinelle placee dans le corps, un autre en-tete ou Authorization : srt la remplace par l\'autorisation, le broker refuse (LEASE_OUT_OF_PLACE)', cmd,
    refusedAll && dec('LEASE_OUT_OF_PLACE') === 4 ? 'pass' : 'fail',
    `statuts=${JSON.stringify(misplaced.map((c) => [c.name, c.status ?? c.error]))} decisions_LEASE_OUT_OF_PLACE=${dec('LEASE_OUT_OF_PLACE')} (attendu 4) ; ` +
    `PREUVE T-04 e : srt substitue dans le corps et les autres en-tetes (le broker les a recus avec l'autorisation) ; la protection est le refus du broker, pas srt`);

  // T-42d : requete a l'amont : l'autorisation n'y apparait nulle part, la cle reelle n'y est que dans x-api-key.
  const leaseAtUp = up.log.flatMap((l) => placements(l, lease));
  const keyAtUp = up.log.flatMap((l) => placements(l, key));
  const authAtUp = up.log.filter((l) => l.rawHeaders.some((h, i) => i % 2 === 0 && ['authorization', 'proxy-authorization'].includes(h.toLowerCase())));
  const q = forwardedToUp.find((l) => l.url.includes('?k='));
  const sentinelInQuery = !!q && q.url.includes(encodeURIComponent(json.sentinel ?? '\u0000'));
  record('T-42d', 'a l\'amont : jamais l\'autorisation (corps, url, en-tete), cle reelle seulement dans x-api-key, aucun Authorization transmis', cmd,
    leaseAtUp.length === 0 && keyAtUp.every((p) => p === 'header:x-api-key') && authAtUp.length === 0 ? 'pass' : 'fail',
    `requetes_amont=${up.log.length} autorisation_a_l_amont=${JSON.stringify(leaseAtUp)} cle_a_l_amont=${JSON.stringify([...new Set(keyAtUp)])} authorization_a_l_amont=${authAtUp.length} ; ` +
    `sentinelle_dans_l_url_transmise=${sentinelInQuery} (srt ne substitue pas la requete ; sans effet, la sentinelle n'est pas un secret)`);

  // T-42e : T-04 f/j rejoues. Un autre hote autorise ne recoit que la sentinelle.
  const sinks = [...evilTls.log, ...evilPlain.log];
  const sinkKeys = sinks.map((l) => l.rawHeaders[l.rawHeaders.findIndex((h) => h.toLowerCase() === 'x-api-key') + 1]);
  const sinkLeak = sinks.some((l) => placements(l, lease).length > 0);
  record('T-42e', 'sentinelle envoyee a un autre hote autorise (HTTPS termine, HTTP clair) et au broker en clair : jamais l\'autorisation', cmd,
    sinks.length === 2 && !sinkLeak && sinkKeys.every((k) => k === json.sentinel) ? 'pass' : 'fail',
    `requetes_recues_par_les_puits=${sinks.length} (attendu 2) x-api-key_recu=${JSON.stringify(sinkKeys.map((k) => (k === json.sentinel ? 'sentinelle' : k)))} fuite_autorisation=${sinkLeak} ; broker_en_clair=${JSON.stringify(call('broker-en-clair'))}`);

  // T-42f : un appelant sans x-api-key : refus avant tout.
  record('T-42f', 'requete sans x-api-key valide : 401, rien a l\'amont', cmd, call('sans-cle').status === 401 && dec('LEASE_INVALID') >= 1 ? 'pass' : 'fail', `reponse=${JSON.stringify(call('sans-cle'))}`);

  // T-42g : l'autorisation ne revient jamais au worker (reponses, erreurs comprises).
  record('T-42g', 'l\'autorisation n\'apparait dans aucune reponse recue par le worker', cmd, everythingSeen.includes(lease) ? 'fail' : 'pass', `taille_observee=${everythingSeen.length}`);

  // T-42h : ce qui fuit REELLEMENT quand l'amont reflete la cle reelle. La garantie porte sur ce qui est TRANSMIS a l'amont (T-42d) ;
  // le retrait dans la reponse est une defense supplementaire et ne couvre que la chaine litterale.
  const expected: Record<string, boolean> = { plain: false, 'two-chunks': false, base64: true, hex: true, 'sse-split': true };
  for (const [v, mayLeak] of Object.entries(expected)) {
    const c = call(`reflect-${v}`);
    const how = recoverable(received(c), key);
    const leaked = how.length > 0;
    const result: Result = !leaked ? 'pass' : mayLeak ? 'residual' : 'fail';
    record(`T-42h-${v}`, `amont reflechissant (${v}), retrait litteral bufferise : ${leaked ? 'FUITE' : 'pas de fuite'}`, cmd, c.status === undefined && !leaked && mayLeak ? 'fail' : result,
      `statut=${c.status ?? c.error} recuperable_par_le_worker=${JSON.stringify(how)} ; ` +
      (leaked ? `FUITE via ${how.join('+')} : la cle reelle ATTEINT le worker. Residu connu (§11.2) : le retrait ne couvre que le litteral ; la frontiere est la requete amont et l'hote fixe` : 'aucune forme reconstructible'));
  }
}
broker.close(); up.close(); evilTls.close(); evilPlain.close();
process.exit(0);
