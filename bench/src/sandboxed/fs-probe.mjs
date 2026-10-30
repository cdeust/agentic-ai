// Sonde filesystem SOUS srt. argv[2] = JSON [{k, op, p}] ; sortie : une ligne JSON {k: "OK"|code}.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const ops = JSON.parse(process.argv[2]);
const res = {};
for (const { k, op, p } of ops) {
  try {
    if (op === 'read') { const d = fs.readFileSync(p, 'utf8'); res[k] = d.includes('CANA' + 'RY-') ? 'LU-CANARI' : 'OK'; }
    else if (op === 'readdir') { const names = fs.readdirSync(p); res[k] = names.length ? 'LISTE:' + names.join(',') : 'VIDE'; }
    else if (op === 'write') { fs.writeFileSync(p, 'x'); res[k] = 'OK'; }
    else if (op === 'mkdirwrite') { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'x'); res[k] = 'OK'; }
    else if (op === 'import') { await import(pathToFileURL(p).href); res[k] = 'OK'; }
  } catch (e) { res[k] = e.code ?? String(e.message).slice(0, 60); }
}
console.log(JSON.stringify(res));
