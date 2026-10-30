import type { DataOpName, MemoryItem, RunEventType, RunStatus } from '@architect-os/contracts';
import type { DataPort, RunRegistry } from '../domain/ports.js';

export interface RecordedRun {
  id: string;
  tool: string;
  input: unknown;
  events: { type: RunEventType; payload: Record<string, unknown> }[];
  status?: Exclude<RunStatus, 'running'>;
  result?: unknown;
}

/** In-memory RunRegistry for unit tests of this service (the real registry lives in data). */
export class InMemoryRunRegistry implements RunRegistry {
  readonly runs = new Map<string, RecordedRun>();
  private counter = 0;

  async create(tool: string, input: unknown): Promise<{ id: string }> {
    const id = `run-${(this.counter += 1)}`;
    this.runs.set(id, { id, tool, input, events: [] });
    return { id };
  }

  async appendEvent(runId: string, type: RunEventType, payload: Record<string, unknown>): Promise<void> {
    this.get(runId).events.push({ type, payload });
  }

  async complete(runId: string, status: Exclude<RunStatus, 'running'>, result: unknown): Promise<void> {
    Object.assign(this.get(runId), { status, result });
  }

  get(runId: string): RecordedRun {
    const run = this.runs.get(runId);
    if (run === undefined) throw new Error(`unknown run ${runId}`);
    return run;
  }
}

/** In-memory DataPort for the memory operations the internal tools use (the real store lives in data). */
export class InMemoryDataPort implements DataPort {
  private readonly items: MemoryItem[] = [];

  async call(op: DataOpName, input: unknown): Promise<unknown> {
    if (op === 'memory.insert') {
      const { content, tags } = input as { content: string; tags: string[] };
      const id = `mem-${this.items.length + 1}`;
      this.items.push({ id, content, tags, score: 1 });
      return { id };
    }
    if (op === 'memory.search') {
      const { query, limit } = input as { query: string; limit: number };
      return this.items.filter((m) => m.content.toLowerCase().includes(query.toLowerCase())).slice(0, limit);
    }
    throw new Error(`InMemoryDataPort does not serve ${op}`);
  }
}
