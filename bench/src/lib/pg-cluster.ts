// Postgres 17 jetable pour T-45 : un cluster dans un dossier temporaire, socket Unix seule (aucun port TCP), supprime a la fin.
// Aucune installation : les binaires viennent de PG_BIN ou d'un emplacement connu. Rien n'est ecrit hors du dossier temporaire.
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const exe = promisify(execFile);
// LC_ALL=C : sur macOS, un postmaster sans locale valide devient multithread au demarrage et s'arrete (FATAL, constate au premier essai).
const run = (f: string, a: string[]) => exe(f, a, { env: { PATH: process.env['PATH'] ?? '', LC_ALL: 'C', LANG: 'C' } });
const CANDIDATES = ['/usr/lib/postgresql/17/bin', '/opt/homebrew/opt/postgresql@17/bin', '/usr/local/opt/postgresql@17/bin', '/opt/homebrew/bin'];

export function findPgBin(): string | undefined {
  const dirs = [process.env['PG_BIN'], ...CANDIDATES].filter((d): d is string => !!d);
  return dirs.find((d) => existsSync(path.join(d, 'initdb')) && existsSync(path.join(d, 'pg_ctl')));
}

export interface Cluster {
  dir: string;
  host: string;
  port: number;
  version: string;
  stop: () => Promise<void>;
}
export async function startCluster(bin: string): Promise<Cluster> {
  // /tmp explicite : le chemin du socket Unix est limite (~104 octets) et le tmpdir de macOS est long.
  const dir = mkdtempSync('/tmp/pgbench-');
  const data = path.join(dir, 'data');
  const port = 54000 + Math.floor(Math.random() * 1000);
  const version = (await run(path.join(bin, 'postgres'), ['--version'])).stdout.trim();
  await run(path.join(bin, 'initdb'), ['-D', data, '-A', 'trust', '-U', 'bench', '--encoding=UTF8', '--locale=C', '--no-sync']);
  await run(path.join(bin, 'pg_ctl'), ['-D', data, '-w', '-t', '60', '-l', path.join(dir, 'pg.log'), '-o', `-c listen_addresses= -c unix_socket_directories=${dir} -c port=${port} -c fsync=off -c max_connections=250`, 'start']);
  return {
    dir,
    host: dir,
    port,
    version,
    stop: async () => {
      await run(path.join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop']).catch(() => undefined);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
