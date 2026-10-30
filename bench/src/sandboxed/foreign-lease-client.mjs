// Processus natif etranger (AUCUNE sandbox, meme uid). argv : port, scheme (https|http), JSON des en-tetes. Une ligne JSON.
import http from 'node:http';
import https from 'node:https';
const [port, scheme, hdrJson] = process.argv.slice(2);
const mod = scheme === 'https' ? https : http;
const req = mod.request({ host: '127.0.0.1', port: Number(port), path: '/v1/messages', method: 'POST', headers: { 'content-type': 'application/json', ...JSON.parse(hdrJson) }, rejectUnauthorized: false, timeout: 8000 }, (r) => {
  let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => console.log(JSON.stringify({ status: r.statusCode, body: b.slice(0, 120) })));
});
req.on('error', (e) => console.log(JSON.stringify({ error: e.code ?? e.message })));
req.on('timeout', () => { req.destroy(); });
req.end(JSON.stringify({ messages: [{ role: 'user', content: 'processus etranger' }] }));
