// Sonde d'alias de chemins SOUS srt. argv[2] = JSON [{k, op, p, to?}] executees dans l'ordre ; sortie : une ligne JSON {k: "OK"|code}.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
const ops = JSON.parse(process.argv[2]);
const res = {};
for (const { k, op, p, to } of ops) {
  try {
    if (op === 'write') { fs.writeFileSync(p, 'hostile\n'); res[k] = 'OK'; }
    else if (op === 'append') { fs.appendFileSync(p, 'hostile\n'); res[k] = 'OK'; }
    else if (op === 'mkdirwrite') { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'hostile\n'); res[k] = 'OK'; }
    else if (op === 'mkdirp') { fs.mkdirSync(p, { recursive: true }); res[k] = 'OK'; }
    else if (op === 'symlink') { fs.symlinkSync(to, p); res[k] = 'OK'; }
    else if (op === 'link') { fs.linkSync(to, p); res[k] = 'OK'; }
    else if (op === 'rename') { fs.renameSync(p, to); res[k] = 'OK'; }
    else if (op === 'unlink') { fs.unlinkSync(p); res[k] = 'OK'; }
    else if (op === 'rm') { fs.rmSync(p, { recursive: true }); res[k] = 'OK'; }
    else if (op === 'fds') {
      const dir = fs.existsSync('/proc/self/fd') ? '/proc/self/fd' : '/dev/fd';
      const out = [];
      for (const n of fs.readdirSync(dir)) { try { const st = fs.fstatSync(Number(n)); out.push(`${n}:${st.isFIFO() ? 'fifo' : st.isSocket() ? 'socket' : st.isCharacterDevice() ? 'chr' : st.isFile() ? 'file' : st.isDirectory() ? 'dir' : 'autre'}`); } catch { /* fd de la lecture du repertoire */ } }
      res[k] = out.sort().join(',');
    }
    else if (op === 'connect') {
      res[k] = await new Promise((r) => { const c = net.connect({ host: p, port: Number(to) }); c.setTimeout(3000, () => { c.destroy(); r('TIMEOUT'); }); c.on('connect', () => { c.destroy(); r('CONNECTE'); }); c.on('error', (e) => r(e.code ?? e.message)); });
    }
    else if (op === 'listen') {
      res[k] = await new Promise((r) => { const s = net.createServer(); s.on('error', (e) => r(e.code ?? e.message)); s.listen(0, '127.0.0.1', () => { s.close(); r('OK'); }); });
    }
  } catch (e) { res[k] = e.code ?? String(e.message).slice(0, 60); }
}
console.log(JSON.stringify(res));
