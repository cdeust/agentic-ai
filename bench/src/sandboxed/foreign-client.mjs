// Processus natif etranger : AUCUNE sandbox. argv : port du broker. Une ligne JSON.
const bp = process.argv[2];
const call = async (method) => {
  try { const r = await fetch(`http://127.0.0.1:${bp}/v1/messages`, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? JSON.stringify({ messages: [{ role: 'user', content: 'processus etranger' }] }) : undefined }); return { status: r.status, body: (await r.text()).slice(0, 100) }; }
  catch (e) { return { error: String(e.cause?.code ?? e.message) }; }
};
console.log(JSON.stringify({ post: await call('POST'), get: await call('GET') }));
