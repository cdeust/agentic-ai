import { describe, expect, it } from 'vitest';
import { InvalidOperationError, NotFoundError } from '../../src/domain/errors.js';
import type { MemoryRepository, RunRepository } from '../../src/domain/ports.js';

/** Behavioural contract every RunRepository adapter must satisfy (in-memory and Postgres alike). */
export function runRepositoryContract(
  name: string,
  make: () => Promise<RunRepository> | RunRepository,
): void {
  describe(`RunRepository contract: ${name}`, () => {
    it('creates a running run', async () => {
      const repo = await make();
      const run = await repo.create({ service: 'memory', tool: 'recall', input: { query: 'q' } });
      expect(run).toMatchObject({
        service: 'memory',
        tool: 'recall',
        status: 'running',
        input: { query: 'q' },
      });
      expect(await repo.get(run.id)).toMatchObject({ id: run.id, status: 'running' });
    });

    it('orders events by a per-run sequence starting at 0', async () => {
      const repo = await make();
      const run = await repo.create({ service: 'memory', tool: 'recall', input: {} });
      await repo.appendEvent(run.id, 'run.created', {});
      await repo.appendEvent(run.id, 'worker.started', { image: 'x' });
      const events = await repo.events(run.id);
      expect(events.map((e) => [e.seq, e.type])).toEqual([
        [0, 'run.created'],
        [1, 'worker.started'],
      ]);
      expect(events[1]?.payload).toEqual({ image: 'x' });
    });

    it('completes a run once and rejects a second completion', async () => {
      const repo = await make();
      const run = await repo.create({ service: 'memory', tool: 'remember', input: {} });
      const done = await repo.complete(run.id, 'ok', { memory_id: 'm' });
      expect(done).toMatchObject({ status: 'ok', result: { memory_id: 'm' } });
      expect(done.completed_at).toBeTypeOf('string');
      await expect(repo.complete(run.id, 'failed', null)).rejects.toBeInstanceOf(InvalidOperationError);
    });

    it('reports unknown runs', async () => {
      const repo = await make();
      const unknown = '00000000-0000-4000-8000-000000000000';
      await expect(repo.get(unknown)).rejects.toBeInstanceOf(NotFoundError);
      await expect(repo.events(unknown)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
}

/** Behavioural contract every MemoryRepository adapter must satisfy. */
export function memoryRepositoryContract(
  name: string,
  make: () => Promise<MemoryRepository> | MemoryRepository,
): void {
  describe(`MemoryRepository contract: ${name}`, () => {
    it('finds inserted memories by text', async () => {
      const repo = await make();
      const { id } = await repo.insert({ content: 'The deploy key rotates monthly', tags: ['ops'] });
      const found = await repo.search({ query: 'deploy key', limit: 5 });
      expect(found.map((m) => m.id)).toContain(id);
      expect(found[0]).toMatchObject({ content: 'The deploy key rotates monthly', tags: ['ops'] });
    });

    it('does not return non-matching memories and honours the limit', async () => {
      const repo = await make();
      await repo.insert({ content: 'alpha one', tags: [] });
      await repo.insert({ content: 'alpha two', tags: [] });
      await repo.insert({ content: 'beta', tags: [] });
      const found = await repo.search({ query: 'alpha', limit: 1 });
      expect(found).toHaveLength(1);
      expect(found[0]?.content).toContain('alpha');
    });
  });
}
