import { execFile, execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const BINARIES = ['initdb', 'pg_ctl', 'createdb'] as const;
const WATCHDOG = fileURLToPath(new URL('./pg-watchdog.mjs', import.meta.url));

export interface Server {
  readonly dir: string;
  readonly socketDir: string;
  readonly bin: (name: string) => string;
  readonly user: string;
}

// macOS: without a locale, postmaster becomes multithreaded at startup and `pg_ctl start` fails ("set LC_ALL").
// Every PostgreSQL binary runs with LC_ALL=C on top of the inherited environment.
export const PG_ENV: NodeJS.ProcessEnv = { ...process.env, LC_ALL: 'C' };

/** PG_BIN, else the directory of the pg_ctl found on PATH. Never skips: a missing server fails the scenario. */
function binaryDirectory(): string {
  const fromEnv = process.env['PG_BIN'];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    const candidate = join(dir, 'pg_ctl');
    if (dir !== '' && existsSync(candidate)) return dirname(realpathSync(candidate));
  }
  throw new Error(
    'A @postgres scenario needs a PostgreSQL 17 with pgvector: set PG_BIN to its bin directory or put pg_ctl on PATH. Neither is available.',
  );
}

/**
 * Starts a disposable server and binds its lifetime to `owner` (default: this process): a detached watchdog stops
 * the server and removes its directory as soon as `owner` is gone, however it died (SIGKILL included).
 */
export async function startServer(owner: number = process.pid): Promise<Server> {
  const binDir = binaryDirectory();
  const bin = (name: string) => join(binDir, name);
  for (const name of BINARIES) {
    if (!existsSync(bin(name))) throw new Error(`@postgres: ${bin(name)} not found (PG_BIN=${binDir})`);
  }
  const dir = mkdtempSync(join(tmpdir(), 'aos-pg-'));
  const data = join(dir, 'data');
  const user = userInfo().username;
  try {
    // Local connections only, trusted: no TCP socket is ever opened (listen_addresses='').
    await run(bin('initdb'), ['-D', data, '-U', user, '--auth=trust', '-E', 'UTF8', '--no-locale'], {
      env: PG_ENV,
    });
    await run(
      bin('pg_ctl'),
      [
        '-D',
        data,
        '-w',
        '-l',
        join(dir, 'postgres.log'),
        '-o',
        `-c listen_addresses='' -c unix_socket_directories='${dir}' -c fsync=off`,
        'start',
      ],
      { env: PG_ENV },
    );
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  spawn(process.execPath, [WATCHDOG, String(owner), bin('pg_ctl'), data, dir], {
    detached: true,
    stdio: 'ignore',
    env: PG_ENV,
  }).unref();
  return { dir, socketDir: dir, bin, user };
}

export function stopServerSync(server: Server): void {
  try {
    execFileSync(server.bin('pg_ctl'), ['-D', join(server.dir, 'data'), '-m', 'immediate', '-w', 'stop'], {
      env: PG_ENV,
    });
  } catch {
    // already stopped
  }
  rmSync(server.dir, { recursive: true, force: true });
}
