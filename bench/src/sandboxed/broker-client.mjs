// Client hostile SOUS srt face au broker. argv : portBroker portAmontDirect [portAutreBroker]. Une ligne JSON.
const [bp, up, other] = process.argv.slice(2);
const call = async (url, init) => {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
    const body = await r.text();
    return { status: r.status, echoHeader: r.headers.get('x-echo-key'), body: body.slice(0, 300) };
  } catch (e) { return { error: String(e.cause?.code ?? ''), message: String(e.message).slice(0, 80) }; }
};
const hdr = { 'content-type': 'application/json', 'x-api-key': 'fake_value_x' };
const out = { env: Object.entries(process.env).map(([k, v]) => `${k}=${v}`) };
out.messages = await call(`http://127.0.0.1:${bp}/v1/messages`, { method: 'POST', headers: hdr, body: JSON.stringify({ messages: [{ role: 'user', content: 'fake_value_x dans le corps' }] }) });
out.getModels = await call(`http://127.0.0.1:${bp}/v1/models`, { method: 'GET' });
out.postOther = await call(`http://127.0.0.1:${bp}/v1/complete`, { method: 'POST', headers: hdr, body: '{}' });
out.getMessages = await call(`http://127.0.0.1:${bp}/v1/messages`, { method: 'GET' });
out.upstreamDirect = await call(`http://127.0.0.1:${up}/v1/messages`, { method: 'POST', headers: hdr, body: '{}' });
out.internet = await call('https://example.com/', {});
if (other) out.otherBroker = await call(`http://127.0.0.1:${other}/v1/messages`, { method: 'POST', headers: hdr, body: '{}' });
out.reflect = await call(`http://127.0.0.1:${bp}/v1/messages/reflect`, { method: 'POST', headers: hdr, body: '{}' });
console.log(JSON.stringify(out));
