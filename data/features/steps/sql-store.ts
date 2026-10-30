import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from '../../src/infrastructure/migrate.js';
import { loadStatementTable, SqlDataStore, type SqlExecutor } from '../../src/infrastructure/sql-store.js';
import { MIGRATIONS_DIR, SQL_DIR } from '../../src/main.js';
import { Given, RecordingExecutor, Then, When, scenario } from './helpers.js';

type Table = { statements: Record<string, unknown>[] };

// Named rewrites of operations.json, one per row of the "rejects a table" Examples.
const editTable = (change: (table: Table) => void) => (source: string) => {
  const table = JSON.parse(source) as Table;
  change(table);
  return JSON.stringify(table);
};
const REWRITES: Record<string, (source: string) => string> = {
  'drop the first statement': editTable((t) => void t.statements.splice(0, 1)),
  'rename the first operation to sql.raw': editTable((t) => void (t.statements[0]!['op'] = 'sql.raw')),
  'append the placeholder $4': (source) => `${source} -- $4`,
  'add the unknown field cache': editTable((t) => void (t.statements[0]!['cache'] = true)),
  'point the first statement at nope.sql': editTable((t) => void (t.statements[0]!['file'] = 'nope.sql')),
  'replace the content by an opening brace': () => '{',
};

const RUN_ROW = {
  id: 'r',
  service: 's',
  tool: 't',
  input: {},
  status: 'running',
  result: null,
  created_at: new Date(0),
};

// --- statement table (sql/operations.json) ---

When('I load the committed statement table', function () {
  this.state['table'] = loadStatementTable(SQL_DIR);
});

Then('the table has {int} distinct operations', function (count: number) {
  const table = this.state['table'] as ReturnType<typeof loadStatementTable>;
  assert.equal(new Set(table.statements.map((s) => s.op)).size, count);
});

Then('every statement of the table has a non-empty text', function () {
  const table = this.state['table'] as ReturnType<typeof loadStatementTable>;
  assert.equal(
    table.statements.every((s) => s.text.length > 0),
    true,
  );
});

When('I copy the sql directory and rewrite {string} as {string}', function (file: string, rewrite: string) {
  const dir = mkdtempSync(join(tmpdir(), 'sql-table-'));
  this.cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(SQL_DIR, dir, { recursive: true });
  const change = REWRITES[rewrite];
  assert.ok(change, `unknown rewrite: ${rewrite}`);
  writeFileSync(join(dir, file), change(readFileSync(join(dir, file), 'utf8')));
  this.state['brokenDir'] = dir;
});

Then('loading the statement table from the copy fails', function () {
  assert.throws(() => loadStatementTable(this.state['brokenDir'] as string));
});

// --- SqlDataStore without a database ---

Given('a SQL data store over a recording executor answering the run row', function () {
  const data = scenario(this);
  data.recording = new RecordingExecutor(() => [RUN_ROW]);
  data.executor = new SqlDataStore(data.recording, loadStatementTable(SQL_DIR));
});

Given('a SQL data store over a recording executor answering no row', function () {
  const data = scenario(this);
  data.recording = new RecordingExecutor();
  data.executor = new SqlDataStore(data.recording, loadStatementTable(SQL_DIR));
});

Given(
  'a SQL data store over a recording executor failing with SQLSTATE {string} and message {string}',
  function (code: string, message: string) {
    const data = scenario(this);
    data.recording = new RecordingExecutor(() => {
      throw Object.assign(new Error(message), { code });
    });
    data.executor = new SqlDataStore(data.recording, loadStatementTable(SQL_DIR));
  },
);

Then('the recorded statement {int} does not contain {string}', function (index: number, fragment: string) {
  assert.ok(!scenario(this).calls[index]?.text.includes(fragment));
});

Then('the recorded statement {int} contains {string}', function (index: number, fragment: string) {
  const call = scenario(this).calls[index];
  assert.ok(call?.text.includes(fragment), `statement ${index} does not contain ${fragment}`);
});

Then('the recorded statement {int} has the parameters:', function (index: number, expected: string) {
  assert.deepEqual(scenario(this).calls[index]?.params, JSON.parse(expected));
});

Then('the recorded statement {int} has the parameters {string}', function (index: number, expected: string) {
  assert.deepEqual(scenario(this).calls[index]?.params, JSON.parse(expected));
});

// The answer as JSON, so an absent field and an undefined one are the same (vitest toEqual semantics).
Then('the answer as JSON equals:', function (expected: string) {
  assert.deepEqual(JSON.parse(JSON.stringify(scenario(this).answer)), JSON.parse(expected));
});

// --- migrate ---

When('I migrate twice from the committed migrations directory with an in-memory ledger', async function () {
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
  this.state['migrations'] = {
    first: await migrate(sql, MIGRATIONS_DIR),
    second: await migrate(sql, MIGRATIONS_DIR),
    statements,
  };
});

Then('the first migration applies {string}', function (names: string) {
  const { first } = this.state['migrations'] as { first: string[] };
  assert.deepEqual(first, names.split(', '));
});

Then('the second migration applies nothing', function () {
  const { second } = this.state['migrations'] as { second: string[] };
  assert.deepEqual(second, []);
});

Then('the migration statements include {string}', function (fragment: string) {
  const { statements } = this.state['migrations'] as { statements: string[] };
  assert.equal(
    statements.some((s) => s.includes(fragment)),
    true,
  );
});
