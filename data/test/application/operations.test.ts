import { EMBEDDING_DIMENSION } from '@agentic-ai/contracts';
import { describe, expect, it } from 'vitest';
import { DataOperations } from '../../src/application/operations.js';
import { InMemoryDataStore } from '../../src/infrastructure/in-memory.js';

const operations = () => new DataOperations(new InMemoryDataStore());

describe('DataOperations', () => {
  it('runs the lifecycle create, appendEvent, complete', async () => {
    const ops = operations();
    const run = (await ops.execute('runs.create', { service: 'memory', tool: 'recall', input: {} })) as {
      id: string;
    };
    await ops.execute('runs.appendEvent', { run_id: run.id, type: 'run.created' });
    await ops.execute('runs.complete', { run_id: run.id, status: 'ok', result: { a: 1 } });
    expect(await ops.execute('runs.events', { run_id: run.id })).toHaveLength(1);
    expect(await ops.execute('runs.get', { run_id: run.id })).toMatchObject({ status: 'ok' });
  });

  it('rejects input that does not match the contract schema with INVALID_INPUT', async () => {
    await expect(operations().execute('runs.create', { service: 1 })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await expect(
      operations().execute('runs.complete', { run_id: 'not-a-uuid', status: 'ok', result: null }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(
      operations().execute('memory.insert', { content: 'x', embedding: [1, 2] }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('accepts an embedding of the contract dimension', async () => {
    const embedding = Array.from({ length: EMBEDDING_DIMENSION }, () => 0.5);
    await expect(operations().execute('memory.insert', { content: 'x', embedding })).resolves.toHaveProperty(
      'id',
    );
  });

  it('refuses a store answer that breaks the output contract', async () => {
    const lying = new DataOperations({ execute: async () => ({ nope: true }) });
    await expect(lying.execute('memory.insert', { content: 'x' })).rejects.toThrow('outside its contract');
  });

  it('knows exactly the typed operations and no raw SQL operation', () => {
    const ops = operations();
    expect(ops.has('runs.create')).toBe(true);
    expect(ops.has('sql')).toBe(false);
    expect(ops.has('query')).toBe(false);
  });

  it('inserts and searches memory', async () => {
    const ops = operations();
    await ops.execute('memory.insert', { content: 'hello world' });
    expect(await ops.execute('memory.search', { query: 'hello' })).toHaveLength(1);
  });
});
