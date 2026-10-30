import assert from 'node:assert/strict';
import { DataOperations } from '../../src/application/operations.js';
import { InMemoryDataStore } from '../../src/infrastructure/in-memory.js';
import { migrate } from '../../src/infrastructure/migrate.js';
import { connectPostgres } from '../../src/infrastructure/pg-pool.js';
import { loadStatementTable, SqlDataStore } from '../../src/infrastructure/sql-store.js';
import { MIGRATIONS_DIR, SQL_DIR } from '../../src/main.js';
import { Given, Then, When, assertMatches, json, scenario, text } from './helpers.js';

// --- the executor under test: a DataStore adapter or the DataOperations use cases (both expose execute) ---

Given('the {word} data store', async function (adapter: string) {
  const data = scenario(this);
  if (adapter === 'in-memory') {
    data.executor = new InMemoryDataStore();
  } else if (adapter === 'postgres') {
    // databaseUrl is a fresh database made by the @postgres Before hook (features/support/postgres.ts).
    assert.notEqual(this.databaseUrl, '', 'the @postgres hook must have created a database');
    const connection = connectPostgres(this.databaseUrl);
    this.cleanups.push(() => connection.end());
    await migrate(connection, MIGRATIONS_DIR);
    data.executor = new SqlDataStore(connection, loadStatementTable(SQL_DIR));
  } else {
    assert.fail(`unknown data store adapter: ${adapter}`);
  }
});

Given('data operations over an in-memory store', function () {
  const data = scenario(this);
  const operations = new DataOperations(new InMemoryDataStore());
  data.executor = operations;
  this.state['operations'] = operations;
});

Given('data operations over a store that always answers {string}', function (answer: string) {
  scenario(this).executor = new DataOperations({ execute: async () => JSON.parse(answer) });
});

Given('a unique tag', function () {
  scenario(this).vars['tag'] = `t${Date.now()}`;
});

// --- executing an operation ---

When('I execute {string} with the input {string}', async function (op: string, input: string) {
  const data = scenario(this);
  data.answer = await data.store.execute(op, json(data, input));
});

When('I execute {string} with:', async function (op: string, input: string) {
  const data = scenario(this);
  data.answer = await data.store.execute(op, json(data, input));
});

When(
  'I execute {string} with the input {string} and it is refused',
  async function (op: string, input: string) {
    const data = scenario(this);
    data.failure = await data.store.execute(op, json(data, input)).then(
      () => assert.fail(`${op} was expected to be refused`),
      (error: unknown) => error,
    );
  },
);

When('I keep the answer id as {string}', function (name: string) {
  const data = scenario(this);
  data.vars[name] = (data.answer as { id: string }).id;
});

// --- the answer ---

Then('the answer matches {string}', function (expected: string) {
  const data = scenario(this);
  assertMatches(data.answer, json(data, expected));
});

Then('the answer has a string field {string}', function (field: string) {
  assert.equal(typeof (scenario(this).answer as Record<string, unknown>)[field], 'string');
});

Then('the answer has the field {string}', function (field: string) {
  assert.ok(Object.hasOwn(scenario(this).answer as object, field));
});

Then('the answer has {int} items', function (count: number) {
  assert.equal((scenario(this).answer as unknown[]).length, count);
});

Then('item {int} of the answer matches {string}', function (index: number, expected: string) {
  const data = scenario(this);
  assertMatches((data.answer as unknown[])[index], json(data, expected));
});

Then('the answer ids are {string}', function (ids: string) {
  const data = scenario(this);
  assert.deepEqual(
    (data.answer as { id: string }[]).map((m) => m.id),
    text(data, ids).split(', '),
  );
});

Then('the answer lists events {string}', function (events: string) {
  const answer = scenario(this).answer as { seq: number; type: string }[];
  assert.deepEqual(
    answer.map((e) => `${e.seq} ${e.type}`),
    events.split(', '),
  );
});

// --- a refused operation ---

Then('the failure code is {string}', function (code: string) {
  assertMatches(scenario(this).failure, { code });
});

Then('the failure matches {string}', function (expected: string) {
  assertMatches(scenario(this).failure, JSON.parse(expected));
});

Then('the failure message contains {string}', function (fragment: string) {
  const failure = scenario(this).failure;
  assert.ok(failure instanceof Error, 'the failure is an Error');
  assert.ok(failure.message.includes(fragment), `"${failure.message}" does not contain "${fragment}"`);
});

// --- DataOperations catalogue ---

Then('the operations know {string}', function (op: string) {
  assert.equal((this.state['operations'] as DataOperations).has(op), true);
});

Then('the operations do not know {string}', function (op: string) {
  assert.equal((this.state['operations'] as DataOperations).has(op), false);
});
