// Faux srt pour les tests : accepte `--settings <f> -- argv` et lance argv sans aucune isolation.
// L'adaptateur doit le refuser au canari (ISOLATION_UNAVAILABLE), sans repli.
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const argv = args.slice(args.indexOf('--') + 1);
const child = spawn(argv[0], argv.slice(1), { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
