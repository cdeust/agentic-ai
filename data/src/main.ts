import { fileURLToPath, pathToFileURL } from 'node:url';
import { DataOperations } from './application/operations.js';
import type { DataStore } from './domain/ports.js';
import { InMemoryDataStore } from './infrastructure/in-memory.js';
import { migrate } from './infrastructure/migrate.js';
import { connectPostgres } from './infrastructure/pg-pool.js';
import { loadStatementTable, SqlDataStore } from './infrastructure/sql-store.js';
import { createDataApi } from './presentation/http-api.js';

/** The package root (data/) from src/main.ts under vitest and from dist/src/main.js in the image. */
const ROOT = new URL(import.meta.url.includes('/dist/') ? '../../' : '../', import.meta.url);
export const SQL_DIR = fileURLToPath(new URL('sql/', ROOT));
export const MIGRATIONS_DIR = fileURLToPath(new URL('migrations/', ROOT));

/** Composition root. All wiring of the data component happens here. */
export function compose(store: DataStore) {
  const operations = new DataOperations(store);
  return { operations, createServer: () => createDataApi(operations) };
}

export function composeInMemory() {
  return compose(new InMemoryDataStore());
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  const port = Number(process.env['PORT'] ?? 8082);
  let app: ReturnType<typeof compose>;
  if (url === undefined) {
    console.warn('DATABASE_URL is not set: using the in-memory backend (non-persistent).');
    app = composeInMemory();
  } else {
    const table = loadStatementTable(SQL_DIR);
    const connection = connectPostgres(url);
    console.warn(`applied migrations: ${(await migrate(connection, MIGRATIONS_DIR)).join(', ') || 'none'}`);
    app = compose(new SqlDataStore(connection, table));
  }
  app.createServer().listen(port, () => console.warn(`data listening on :${port}`));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
