// Canari (platform-v3-srt.md, §6), exécuté sous srt par l'adaptateur. Deux essais qui doivent échouer :
// lire un fichier placé en denyRead, joindre un port que l'hôte écoute sur le loopback, hors allowlist.
// Une seule ligne JSON sur stdout ; l'adaptateur refuse de démarrer si l'un des deux réussit.
import { readFileSync } from 'node:fs';
import { connect } from 'node:net';

const [file, port] = process.argv.slice(2);

let read = 'denied';
try {
  readFileSync(file);
  read = 'allowed';
} catch {
  /* refus attendu */
}

const reach = await new Promise((resolve) => {
  const socket = connect({ host: '127.0.0.1', port: Number(port) });
  const timer = setTimeout(() => {
    socket.destroy();
    resolve('denied');
  }, 3000);
  socket.once('connect', () => {
    clearTimeout(timer);
    socket.destroy();
    resolve('allowed');
  });
  socket.once('error', () => {
    clearTimeout(timer);
    resolve('denied');
  });
});

process.stdout.write(`${JSON.stringify({ read, connect: reach })}\n`);
