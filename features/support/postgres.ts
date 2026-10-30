import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { After, AfterAll, Before } from '@cucumber/cucumber';
import type { ArchitectWorld } from './world.js';

// Before / After / AfterAll with { tags, timeout }: lib/support_code_library_builder/types.d.ts.
// The tag on Before is a hook tag (which scenarios the hook wraps), not a run filter.

const run = promisify(execFile);
const BINARIES = ['initdb', 'pg_ctl', 'createdb'] as const;

interface Server {
  readonly dir: string;
  readonly socketDir: string;
  readonly bin: (name: string) => string;
  readonly user: string;
}

let started: Promise<Server> | undefined;
let databases = 0;

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

async function startServer(): Promise<Server> {
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
    await run(bin('initdb'), ['-D', data, '-U', user, '--auth=trust', '-E', 'UTF8']);
    await run(bin('pg_ctl'), [
      '-D',
      data,
      '-w',
      '-l',
      join(dir, 'postgres.log'),
      '-o',
      `-c listen_addresses='' -c unix_socket_directories='${dir}' -c fsync=off`,
      'start',
    ]);
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return { dir, socketDir: dir, bin, user };
}

function stopServerSync(server: Server): void {
  try {
    execFileSync(server.bin('pg_ctl'), ['-D', join(server.dir, 'data'), '-m', 'immediate', '-w', 'stop']);
  } catch {
    // already stopped
  }
  rmSync(server.dir, { recursive: true, force: true });
}

Before({ tags: '@postgres', timeout: 120_000 }, async function (this: ArchitectWorld) {
  started ??= startServer();
  const server = await started;
  const name = `scenario_${process.pid}_${++databases}`;
  await run(server.bin('createdb'), ['-h', server.socketDir, '-U', server.user, name]);
  this.databaseUrl = `postgresql://${encodeURIComponent(server.user)}@/${name}?host=${encodeURIComponent(server.socketDir)}`;
});

After({ timeout: 30_000 }, async function (this: ArchitectWorld) {
  for (const cleanup of this.cleanups.splice(0).reverse()) await cleanup();
});

AfterAll({ timeout: 60_000 }, async () => {
  if (started === undefined) return;
  const server = await started.catch(() => undefined);
  if (server !== undefined) stopServerSync(server);
});
