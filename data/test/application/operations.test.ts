import { describe, expect, it } from 'vitest';
import { DataOperations } from '../../src/application/operations.js';
import { InvalidInputError } from '../../src/domain/errors.js';
import { EMBEDDING_DIMENSION } from '../../src/domain/ports.js';
import { InMemoryMemoryRepository, InMemoryRunRepository } from '../../src/infrastructure/in-memory.js';
import { SystemClock, UuidGenerator } from '../../src/infrastructure/system.js';

function operations() {
  const ids = new UuidGenerator();
  return new DataOperations(
    new InMemoryRunRepository(ids, new SystemClock()),
    new InMemoryMemoryRepository(ids),
  );
}

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

  it('rejects input that does not match the contract schema', async () => {
    await expect(operations().execute('runs.create', { service: 1 })).rejects.toBeInstanceOf(
      InvalidInputError,
    );
    await expect(
      operations().execute('runs.complete', { run_id: 'x', status: 'running', result: null }),
    ).rejects.toBeInstanceOf(InvalidInputError);
  });

  it('rejects an embedding of the wrong dimension', async () => {
    await expect(operations().execute('memory.insert', { content: 'x', embedding: [1, 2] })).rejects.toThrow(
      `${EMBEDDING_DIMENSION} dimensions`,
    );
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
