import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, SQL_DIR } from '../../src/main.js';
import { migrate } from '../../src/infrastructure/migrate.js';
import { connectPostgres } from '../../src/infrastructure/pg-pool.js';
import { loadStatementTable, SqlDataStore, type SqlExecutor } from '../../src/infrastructure/sql-store.js';
import { dataStoreContract } from '../contracts/data-store.js';

class RecordingExecutor implements SqlExecutor {
  readonly calls: { text: string; params: readonly unknown[] }[] = [];
  constructor(private readonly answer: () => Record<string, unknown>[] = () => []) {}
  async query(text: string, params: readonly unknown[]) {
    this.calls.push({ text, params });
    return { rows: this.answer() };
  }
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    return work(this);
  }
}

describe('statement table (sql/operations.json)', () => {
  const temps: string[] = [];
  afterEach(() => temps.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  /** A copy of the real sql/ directory with one file rewritten. */
  function broken(file: string, rewrite: (text: string) => string): string {
    const dir = mkdtempSync(join(tmpdir(), 'sql-table-'));
    temps.push(dir);
    cpSync(SQL_DIR, dir, { recursive: true });
    writeFileSync(join(dir, file), rewrite(readFileSync(join(dir, file), 'utf8')));
    return dir;
  }
  const edit = (change: (table: { statements: Record<string, unknown>[] }) => void) => (text: string) => {
    const table = JSON.parse(text) as { statements: Record<string, unknown>[] };
    change(table);
    return JSON.stringify(table);
  };

  it('loads the committed table: every contract operation has a statement and its SQL file', () => {
    const table = loadStatementTable(SQL_DIR);
    expect(new Set(table.statements.map((s) => s.op)).size).toBe(7);
    expect(table.statements.every((s) => s.text.length > 0)).toBe(true);
  });

  it.each([
    ['an operation without a statement', 'operations.json', edit((t) => t.statements.splice(0, 1))],
    [
      'an operation the contracts do not know',
      'operations.json',
      edit((t) => void (t.statements[0]!['op'] = 'sql.raw')),
    ],
    ['a parameter list shorter than the placeholders', 'runs.create.sql', (s: string) => `${s} -- $4`],
    ['an unknown field', 'operations.json', edit((t) => void (t.statements[0]!['cache'] = true))],
    [
      'a SQL file that does not exist',
      'operations.json',
      edit((t) => void (t.statements[0]!['file'] = 'nope.sql')),
    ],
    ['not JSON', 'operations.json', () => '{'],
  ])('rejects a table with %s', (_name, file, rewrite) => {
    expect(() => loadStatementTable(broken(file, rewrite))).toThrow();
  });
});

describe('SqlDataStore (no database)', () => {
  const table = loadStatementTable(SQL_DIR);
  const run = {
    id: 'r',
    service: 's',
    tool: 't',
    input: {},
    status: 'running',
    result: null,
    created_at: new Date(0),
  };

  it('binds every value as a parameter, never into the SQL text', async () => {
    const sql = new RecordingExecutor(() => [run]);
    const created = await new SqlDataStore(sql, table).execute('runs.create', {
      service: "s'; DROP TABLE runs;--",
      tool: 't',
      input: { a: 1 },
    });
    expect(sql.calls[0]?.text).not.toContain('DROP');
    expect(sql.calls[0]?.params).toEqual(["s'; DROP TABLE runs;--", 't', '{"a":1}']);
    expect(created).toEqual({ ...run, result: undefined, created_at: '1970-01-01T00:00:00.000Z' });
  });

  it('chooses the vector statement only when an embedding is given', async () => {
    const sql = new RecordingExecutor();
    const store = new SqlDataStore(sql, table);
    await store.execute('memory.search', { query: '100%_x', limit: 3 });
    await store.execute('memory.search', { query: '', embedding: [1, 2], limit: 2 });
    expect(sql.calls[0]).toMatchObject({ params: ['100%_x', 3], text: expect.stringContaining('ILIKE') });
    expect(sql.calls[1]).toMatchObject({ params: ['[1,2]', 2], text: expect.stringContaining('<=>') });
  });

  it('maps declared SQLSTATEs to named failures and an empty answer to NOT_FOUND', async () => {
    const failing = new RecordingExecutor(() => {
      throw Object.assign(new Error('violates foreign key constraint "run_events_run_id_fkey"'), {
        code: '23503',
      });
    });
    await expect(
      new SqlDataStore(failing, table).execute('runs.appendEvent', {
        run_id: 'r',
        type: 'run.created',
        payload: {},
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'runs.appendEvent: not found' });
    await expect(
      new SqlDataStore(new RecordingExecutor(), table).execute('runs.get', { run_id: 'r' }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
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
    expect(await migrate(sql, MIGRATIONS_DIR)).toEqual([
      '0001_runs.sql',
      '0002_memory.sql',
      '0003_runs_immutable.sql',
    ]);
    expect(await migrate(sql, MIGRATIONS_DIR)).toEqual([]);
    expect(statements.some((s) => s.includes('CREATE EXTENSION IF NOT EXISTS vector'))).toBe(true);
  });
});

// Real database: set TEST_DATABASE_URL to a disposable Postgres with pgvector to run the same contract on SQL.
const url = process.env['TEST_DATABASE_URL'];
describe.skipIf(url === undefined)('SqlDataStore (real database)', () => {
  const connection = url === undefined ? undefined : connectPostgres(url);
  const ready =
    connection === undefined ? Promise.resolve() : migrate(connection, MIGRATIONS_DIR).then(() => undefined);
  dataStoreContract('postgres', async () => {
    await ready;
    if (connection === undefined) throw new Error('TEST_DATABASE_URL is required');
    return new SqlDataStore(connection, loadStatementTable(SQL_DIR));
  });
});
