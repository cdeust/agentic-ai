import { EMBEDDING_DIMENSION } from '@agentic-ai/contracts';
import { describe, expect, it } from 'vitest';
import type { DataStore } from '../../src/domain/ports.js';

const UNKNOWN_RUN = '00000000-0000-4000-8000-000000000000';
const axis = (i: number) => Array.from({ length: EMBEDDING_DIMENSION }, (_, j) => (j === i ? 1 : 0));

type Make = () => Promise<DataStore> | DataStore;

const createRun = async (store: DataStore, input: unknown = {}) =>
  (await store.execute('runs.create', { service: 'memory', tool: 'recall', input })) as { id: string };

/** Behavioural contract every DataStore adapter must satisfy (in-memory and SQL alike). */
export function dataStoreContract(name: string, make: Make): void {
  runLifecycleContract(name, make);
  runFailuresContract(name, make);
  memoryContract(name, make);
}

function runLifecycleContract(name: string, make: Make): void {
  describe(`DataStore contract, run lifecycle: ${name}`, () => {
    it('creates a running run and reads it back', async () => {
      const store = await make();
      const run = await createRun(store, { query: 'q' });
      expect(run).toMatchObject({
        service: 'memory',
        tool: 'recall',
        status: 'running',
        input: { query: 'q' },
      });
      expect(await store.execute('runs.get', { run_id: run.id })).toMatchObject({
        id: run.id,
        status: 'running',
      });
    });

    it('orders events by a per-run sequence starting at 0', async () => {
      const store = await make();
      const { id } = await createRun(store);
      await store.execute('runs.appendEvent', { run_id: id, type: 'run.created', payload: {} });
      await store.execute('runs.appendEvent', {
        run_id: id,
        type: 'worker.started',
        payload: { image: 'x' },
      });
      const events = (await store.execute('runs.events', { run_id: id })) as { seq: number; type: string }[];
      expect(events.map((e) => [e.seq, e.type])).toEqual([
        [0, 'run.created'],
        [1, 'worker.started'],
      ]);
      expect(events[1]).toMatchObject({ payload: { image: 'x' } });
    });
  });
}

function runFailuresContract(name: string, make: Make): void {
  describe(`DataStore contract, named failures: ${name}`, () => {
    it('completes a run once and refuses a second completion with INVALID_OPERATION', async () => {
      const store = await make();
      const { id } = await createRun(store);
      const done = await store.execute('runs.complete', {
        run_id: id,
        status: 'ok',
        result: { memory_id: 'm' },
      });
      expect(done).toMatchObject({
        status: 'ok',
        result: { memory_id: 'm' },
        completed_at: expect.any(String),
      });
      await expect(
        store.execute('runs.complete', { run_id: id, status: 'failed', result: null }),
      ).rejects.toMatchObject({ code: 'INVALID_OPERATION' });
    });

    it('reports an unknown run as NOT_FOUND on every run operation', async () => {
      const store = await make();
      const run_id = UNKNOWN_RUN;
      await expect(store.execute('runs.get', { run_id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(store.execute('runs.events', { run_id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        store.execute('runs.appendEvent', { run_id, type: 'run.created', payload: {} }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(
        store.execute('runs.complete', { run_id, status: 'ok', result: null }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });
}

function memoryContract(name: string, make: Make): void {
  describe(`DataStore contract, memory: ${name}`, () => {
    it('finds inserted memories by text, without non-matching ones, within the limit', async () => {
      const store = await make();
      const tag = `t${Date.now()}`;
      const { id } = (await store.execute('memory.insert', {
        content: `The deploy key ${tag} rotates monthly`,
        tags: ['ops'],
      })) as { id: string };
      await store.execute('memory.insert', { content: `alpha ${tag} two`, tags: [] });
      const found = (await store.execute('memory.search', { query: `key ${tag}`, limit: 5 })) as {
        id: string;
        tags: string[];
      }[];
      expect(found.map((m) => m.id)).toEqual([id]);
      expect(found[0]).toMatchObject({ tags: ['ops'] });
      await store.execute('memory.insert', { content: `alpha ${tag} one`, tags: [] });
      expect(await store.execute('memory.search', { query: `alpha ${tag}`, limit: 1 })).toHaveLength(1);
    });

    it('ranks by cosine similarity when an embedding is given', async () => {
      const store = await make();
      await store.execute('memory.insert', { content: 'far', tags: [], embedding: axis(1) });
      await store.execute('memory.insert', { content: 'near', tags: [], embedding: axis(0) });
      const found = (await store.execute('memory.search', { query: '', embedding: axis(0), limit: 2 })) as {
        content: string;
        score: number;
      }[];
      expect(found[0]).toMatchObject({ content: 'near', score: 1 });
    });
  });
}
