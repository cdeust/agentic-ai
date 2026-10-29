import { randomUUID } from 'node:crypto';
import type { DataOpInput, DataOpName, MemoryItem, Run, RunEvent } from '@agentic-ai/contracts';
import { DataError } from '../domain/errors.js';
import type { DataStore } from '../domain/ports.js';

interface StoredMemory extends MemoryItem {
  embedding?: number[] | undefined;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** In-memory DataStore: the same operations and named failures as the SQL store, kept in this process. */
export class InMemoryDataStore implements DataStore {
  private readonly runs = new Map<string, Run>();
  private readonly eventLog = new Map<string, RunEvent[]>();
  private readonly memories: StoredMemory[] = [];

  private run(runId: string): Run {
    const run = this.runs.get(runId);
    if (run === undefined) throw new DataError('NOT_FOUND', `run ${runId} not found`);
    return run;
  }

  private readonly handlers: { [Op in DataOpName]: (input: DataOpInput<Op>) => unknown } = {
    'runs.create': ({ service, tool, input }) => {
      const run: Run = { id: randomUUID(), service, tool, input, status: 'running', created_at: now() };
      this.runs.set(run.id, run);
      this.eventLog.set(run.id, []);
      return { ...run };
    },
    'runs.appendEvent': ({ run_id, type, payload }) => {
      const log = this.eventLog.get(this.run(run_id).id) ?? [];
      const event: RunEvent = { seq: log.length, run_id, type, payload, at: now() };
      log.push(event);
      return { ...event };
    },
    'runs.complete': ({ run_id, status, result }) => {
      const run = this.run(run_id);
      if (run.status !== 'running')
        throw new DataError('INVALID_OPERATION', `run ${run_id} is already ${run.status}`);
      const completed: Run = { ...run, status, result, completed_at: now() };
      this.runs.set(run_id, completed);
      return { ...completed };
    },
    'runs.get': ({ run_id }) => ({ ...this.run(run_id) }),
    'runs.events': ({ run_id }) => (this.eventLog.get(this.run(run_id).id) ?? []).map((e) => ({ ...e })),
    'memory.insert': ({ content, tags, embedding }) => {
      const id = randomUUID();
      this.memories.push({ id, content, tags, score: 0, embedding });
      return { id };
    },
    'memory.search': ({ query, embedding: wanted, limit }) => {
      const needle = query.toLowerCase();
      const scored: MemoryItem[] = [];
      for (const { embedding, ...item } of this.memories) {
        if (wanted !== undefined && embedding !== undefined)
          scored.push({ ...item, score: cosine(wanted, embedding) });
        else if (wanted === undefined && item.content.toLowerCase().includes(needle))
          scored.push({ ...item, score: 1 });
      }
      return scored.sort((a, b) => b.score - a.score).slice(0, limit);
    },
  };

  async execute<Op extends DataOpName>(op: Op, input: DataOpInput<Op>): Promise<unknown> {
    return (this.handlers[op] as (input: DataOpInput<Op>) => unknown)(input);
  }
}

function now(): string {
  return new Date().toISOString();
}
