import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SqlExecutor } from './sql-store.js';

const MIGRATION_FILE = /^(\d{4})_[a-z0-9_]+\.sql$/;

/** Applies migrations/NNNN_name.sql in order, once each, recorded in schema_migrations. */
export async function migrate(sql: SqlExecutor, directory: string): Promise<string[]> {
  await sql.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    [],
  );
  const applied = new Set(
    (await sql.query('SELECT version FROM schema_migrations', [])).rows.map((r) => String(r['version'])),
  );
  const files = (await readdir(directory)).filter((f) => MIGRATION_FILE.test(f)).sort();
  const done: string[] = [];
  for (const file of files) {
    const version = file.slice(0, 4);
    if (applied.has(version)) continue;
    const statements = await readFile(join(directory, file), 'utf8');
    await sql.transaction(async (tx) => {
      await tx.query(statements, []);
      await tx.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    });
    done.push(file);
  }
  return done;
}
