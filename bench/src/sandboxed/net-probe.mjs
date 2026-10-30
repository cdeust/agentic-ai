// Sonde reseau executee SOUS srt. Une ligne JSON sur stdout.
import net from 'node:net';
const [mode, arg] = process.argv.slice(2);
const out = (o) => { console.log(JSON.stringify(o)); process.exit(0); };
setTimeout(() => out({ mode, reached: false, error: 'TIMEOUT' }), 8000).unref();
if (mode === 'direct') {
  const c = net.connect(Number(arg), '127.0.0.1');
  let d = '';
  c.on('connect', () => c.write('GET /direct HTTP/1.0\r\n\r\n'));
  c.on('data', (x) => (d += x));
  c.on('close', () => out({ mode, reached: d.includes('hote-atteint'), data: d.slice(-60) }));
  c.on('error', (e) => out({ mode, reached: false, error: e.code ?? e.message }));
} else if (mode === 'proxy') {
  fetch(`http://127.0.0.1:${arg}/proxy`).then(async (r) => out({ mode, reached: (await r.text()).includes('hote-atteint'), status: r.status }))
    .catch((e) => out({ mode, reached: false, error: e.cause?.code ?? e.message }));
} else if (mode === 'unix') {
  const c = net.connect(arg);
  let d = '';
  c.on('data', (x) => (d += x));
  c.on('close', () => out({ mode, reached: d.includes('hote'), data: d }));
  c.on('error', (e) => out({ mode, reached: false, error: e.code ?? e.message }));
}
