import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { After, AfterAll, Before } from '@cucumber/cucumber';
import { PG_ENV, startServer, stopServerSync, type Server } from './pg-server.js';
import type { ArchitectWorld } from './world.js';

// Before / After / AfterAll with { tags, timeout }: lib/support_code_library_builder/types.d.ts.
// The tag on Before is a hook tag (which scenarios the hook wraps), not a run filter.
// The server itself, and the watchdog that stops it if this process is killed before AfterAll: ./pg-server.ts.

const run = promisify(execFile);

let started: Promise<Server> | undefined;
let databases = 0;

Before({ tags: '@postgres', timeout: 120_000 }, async function (this: ArchitectWorld) {
  started ??= startServer();
  const server = await started;
  const name = `scenario_${process.pid}_${++databases}`;
  await run(server.bin('createdb'), ['-h', server.socketDir, '-U', server.user, name], { env: PG_ENV });
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
