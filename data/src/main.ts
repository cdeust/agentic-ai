import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DataOperations } from './application/operations.js';
import type { MemoryRepository, RunRepository } from './domain/ports.js';
import { InMemoryMemoryRepository, InMemoryRunRepository } from './infrastructure/in-memory.js';
import { migrate } from './infrastructure/migrate.js';
import { connectPostgres } from './infrastructure/pg-pool.js';
import { PostgresMemoryRepository, PostgresRunRepository } from './infrastructure/postgres.js';
import { SystemClock, UuidGenerator } from './infrastructure/system.js';
import { createDataApi } from './presentation/http-api.js';

export interface DataDependencies {
  runs: RunRepository;
  memory: MemoryRepository;
}

/** Composition root. All wiring of the data component happens here. */
export function compose(deps: DataDependencies) {
  const operations = new DataOperations(deps.runs, deps.memory);
  return { operations, createServer: () => createDataApi(operations) };
}

export function composeInMemory() {
  const ids = new UuidGenerator();
  return compose({
    runs: new InMemoryRunRepository(ids, new SystemClock()),
    memory: new InMemoryMemoryRepository(ids),
  });
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  const port = Number(process.env['PORT'] ?? 8082);
  let app: ReturnType<typeof compose>;
  if (url === undefined) {
    console.warn('DATABASE_URL is not set: using the in-memory backend (non-persistent).');
    app = composeInMemory();
  } else {
    const connection = connectPostgres(url);
    const migrations = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');
    console.warn(`applied migrations: ${(await migrate(connection, migrations)).join(', ') || 'none'}`);
    app = compose({
      runs: new PostgresRunRepository(connection),
      memory: new PostgresMemoryRepository(connection),
    });
  }
  app.createServer().listen(port, () => console.warn(`data listening on :${port}`));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
