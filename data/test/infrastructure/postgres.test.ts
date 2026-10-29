import { describe, expect, it } from 'vitest';
import { connectPostgres } from '../../src/infrastructure/pg-pool.js';
import { migrate } from '../../src/infrastructure/migrate.js';
import {
  PostgresMemoryRepository,
  PostgresRunRepository,
  type SqlExecutor,
} from '../../src/infrastructure/postgres.js';
import { fileURLToPath } from 'node:url';
import { memoryRepositoryContract, runRepositoryContract } from '../contracts/repositories.js';

const MIGRATIONS = fileURLToPath(new URL('../../migrations', import.meta.url));

class RecordingExecutor implements SqlExecutor {
  readonly calls: { text: string; params: readonly unknown[] }[] = [];
  constructor(private readonly rows: Record<string, unknown>[] = []) {}
  async query(text: string, params: readonly unknown[]) {
    this.calls.push({ text, params });
    return { rows: this.rows };
  }
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    return work(this);
  }
}

describe('Postgres adapters (SQL shape, no database)', () => {
  it('uses only parameterised statements for runs', async () => {
    const sql = new RecordingExecutor([
      { id: 'r', service: 's', tool: 't', input: {}, status: 'running', created_at: new Date(0) },
    ]);
    await new PostgresRunRepository(sql).create({ service: "s'; DROP TABLE runs;--", tool: 't', input: {} });
    expect(sql.calls[0]?.text).not.toContain('DROP');
    expect(sql.calls[0]?.params).toContain("s'; DROP TABLE runs;--");
  });

  it('escapes LIKE wildcards in text search and keeps the query as a parameter', async () => {
    const sql = new RecordingExecutor();
    await new PostgresMemoryRepository(sql).search({ query: '100%_x', limit: 3 });
    expect(sql.calls[0]?.params).toEqual(['100%_x', 3]);
    expect(sql.calls[0]?.text).toContain('ILIKE');
  });

  it('uses the pgvector cosine operator for embedding search', async () => {
    const sql = new RecordingExecutor();
    await new PostgresMemoryRepository(sql).search({ query: '', embedding: [1, 2], limit: 2 });
    expect(sql.calls[0]?.text).toContain('<=>');
    expect(sql.calls[0]?.params[0]).toBe('[1,2]');
  });
});

describe('migrate', () => {
  it('applies each versioned migration once, in order', async () => {
    const applied = new Set<string>();
    const statements: string[] = [];
    const sql: SqlExecutor = {
      async query(text, params) {
        statements.push(text);
        if (text.startsWith('INSERT INTO schema_migrations')) applied.add(String(params[0]));
        if (text.startsWith('SELECT version')) return { rows: [...applied].map((version) => ({ version })) };
        return { rows: [] };
      },
      transaction: (work) => work(sql),
    };
    expect(await migrate(sql, MIGRATIONS)).toEqual(['0001_runs.sql', '0002_memory.sql']);
    expect(await migrate(sql, MIGRATIONS)).toEqual([]);
    expect(statements.some((s) => s.includes('CREATE EXTENSION IF NOT EXISTS vector'))).toBe(true);
  });
});

// Real database: set TEST_DATABASE_URL to a disposable pgvector Postgres to run the shared port contracts against it.
const url = process.env['TEST_DATABASE_URL'];
describe.skipIf(url === undefined)('Postgres adapters (real database)', () => {
  const connection = url === undefined ? undefined : connectPostgres(url);
  const ready =
    connection === undefined ? Promise.resolve() : migrate(connection, MIGRATIONS).then(() => undefined);
  const sql = (): SqlExecutor => {
    if (connection === undefined) throw new Error('TEST_DATABASE_URL is required');
    return connection;
  };
  runRepositoryContract('postgres', async () => {
    await ready;
    return new PostgresRunRepository(sql());
  });
  memoryRepositoryContract('postgres', async () => {
    await ready;
    return new PostgresMemoryRepository(sql());
  });
});
