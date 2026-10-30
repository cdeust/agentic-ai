// T-23 (broker adversarial). Le constat BROKER-FOREIGN est remplace par T-43.
import { baseEnv, brief, cmdString, makeWorld, randomKey, record, runSrtJson, sandboxed, writeProfile, type Result } from '../lib/common.ts';
import { startBroker, startUpstream, type Sanitize } from '../lib/fake-upstream.ts';

const w = makeWorld('broker');
const key = randomKey();
const up = await startUpstream();
const client = sandboxed('broker-client.mjs');
type Reply = { status?: number; error?: string; echoHeader?: string | null; body?: string };
type Out = { env: string[]; messages: Reply; getModels: Reply; postOther: Reply; getMessages: Reply; upstreamDirect: Reply; internet: Reply; otherBroker?: Reply; reflect: Reply };
const clear = ['env', '-u', 'NO_PROXY', '-u', 'no_proxy', 'NODE_USE_ENV_PROXY=1', 'ANTHROPIC_API_KEY=aucune-cle-ici'];

async function adversary(sanitize: Sanitize, withOther = false) {
  const b = await startBroker({ upstreamPort: up.port, key, sanitize });
  const other = withOther ? await startBroker({ upstreamPort: up.port, key }) : undefined;
  const settings = writeProfile(w, `broker-${sanitize}`, { allowedDomains: [`127.0.0.1:${b.port}`], allowRead: [w.work, sandboxed('x').replace(/x$/, '')] });
  const argv = [...clear, 'node', client, String(b.port), String(up.port), ...(other ? [String(other.port)] : [])];
  const r = await runSrtJson<Out>({ settings, argv, cwd: w.work, env: baseEnv(w), timeoutMs: 60_000 });
  return { b, other, r, cmd: cmdString(settings, argv) };
}
const leaks = (r: Reply | undefined): boolean => !!r && ((r.echoHeader ?? '').includes(key) || (r.body ?? '').includes(key));
const refusedReply = (r: Reply | undefined): boolean => !!r && (r.error !== undefined || r.status === 403 || r.status === 502);

// Run principal : sanitize=full
{
  const { b, other, r, cmd } = await adversary('full', true);
  const j = r.json;
  if (!j) record('T-23', 'broker adversarial', cmd, 'fail', brief(r.run));
  else {
    const upMsgs = up.log.filter((l) => l.path === '/v1/messages' && l.method === 'POST');
    const injected = upMsgs.some((l) => l.key === key);
    const bodyHasReal = upMsgs.some((l) => l.body.includes(key));
    const checks: Record<string, boolean> = {
      a_env_sans_cle: !j.env.join('\n').includes(key),
      e_cle_injectee_par_broker: injected,
      e_client_envoyait_sentinelle: b.clientKeys.includes('fake_value_x'),
      e_corps_sans_cle: !bodyHasReal,
      get_models_403: j.getModels.status === 403,
      post_hors_messages_403: j.postOther.status === 403,
      get_messages_403: j.getMessages.status === 403,
      amont_direct_refuse: refusedReply(j.upstreamDirect),
      internet_refuse: refusedReply(j.internet),
      broker_d_une_autre_task_refuse: refusedReply(j.otherBroker),
      reflexion_sans_fuite: !leaks(j.reflect) && j.reflect.status === 200,
    };
    const bad = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    record('T-23', 'broker par task, client hostile sous srt : cle absente, 403 hors /v1/messages, amont et internet refuses, autre broker refuse', cmd, bad.length ? 'fail' : 'pass',
      `verifs=${JSON.stringify(checks)} non_tenues=[${bad}] reponses=${JSON.stringify({ messages: j.messages, getModels: j.getModels, upstreamDirect: j.upstreamDirect, internet: j.internet, otherBroker: j.otherBroker })}`);
    record('T-23-ordinaire', 'POST /v1/messages ordinaire traverse le broker (200)', cmd, j.messages.status === 200 ? 'pass' : 'fail', JSON.stringify(j.messages));
  }
  // BROKER-FOREIGN (constat de revue) est remplace par T-43 (tests/t43.ts), qui joue le natif etranger contre le broker a autorisation.
  b.close(); other?.close();
}
// Reflexion : trois variantes du retrait de cle dans la reponse (E-05c).
for (const [sanitize, expectLeak] of [['none', true], ['keep-length', false], ['full', false]] as Array<[Sanitize, boolean]>) {
  const { b, r, cmd } = await adversary(sanitize);
  const refl = r.json?.reflect;
  const leaked = leaks(refl);
  const result: Result = !refl ? 'fail' : leaked === expectLeak ? 'pass' : 'fail';
  record(`T-23d-${sanitize}`, sanitize === 'none' ? 'amont reflechissant, broker sans retrait (temoin : la fuite DOIT apparaitre)' : `amont reflechissant, retrait ${sanitize} : aucune fuite`, cmd, result, `fuite=${leaked} reponse=${JSON.stringify(refl)}`);
  b.close();
}
up.close();
process.exit(0);
