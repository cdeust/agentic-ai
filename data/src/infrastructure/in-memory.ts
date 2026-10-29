import type { MemoryItem, Run, RunEvent, RunEventType, RunStatus } from '@agentic-ai/contracts';
import { InvalidOperationError, NotFoundError } from '../domain/errors.js';
import type {
  Clock,
  IdGenerator,
  MemoryRepository,
  MemorySearch,
  NewMemory,
  NewRun,
  RunRepository,
} from '../domain/ports.js';

export class InMemoryRunRepository implements RunRepository {
  private readonly runs = new Map<string, Run>();
  private readonly eventLog = new Map<string, RunEvent[]>();

  constructor(
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async create(run: NewRun): Promise<Run> {
    const created: Run = {
      id: this.ids.next(),
      service: run.service,
      tool: run.tool,
      input: run.input,
      status: 'running',
      created_at: this.clock.now(),
    };
    this.runs.set(created.id, created);
    this.eventLog.set(created.id, []);
    return { ...created };
  }

  async appendEvent(runId: string, type: RunEventType, payload: Record<string, unknown>): Promise<RunEvent> {
    const log = this.eventLog.get(runId);
    if (log === undefined) throw new NotFoundError('run', runId);
    const event: RunEvent = { seq: log.length, run_id: runId, type, payload, at: this.clock.now() };
    log.push(event);
    return { ...event };
  }

  async complete(runId: string, status: Exclude<RunStatus, 'running'>, result: unknown): Promise<Run> {
    const run = this.runs.get(runId);
    if (run === undefined) throw new NotFoundError('run', runId);
    if (run.status !== 'running') throw new InvalidOperationError(`run ${runId} is already ${run.status}`);
    const completed: Run = { ...run, status, result, completed_at: this.clock.now() };
    this.runs.set(runId, completed);
    return { ...completed };
  }

  async get(runId: string): Promise<Run> {
    const run = this.runs.get(runId);
    if (run === undefined) throw new NotFoundError('run', runId);
    return { ...run };
  }

  async events(runId: string): Promise<RunEvent[]> {
    const log = this.eventLog.get(runId);
    if (log === undefined) throw new NotFoundError('run', runId);
    return log.map((event) => ({ ...event }));
  }
}

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

export class InMemoryMemoryRepository implements MemoryRepository {
  private readonly items: StoredMemory[] = [];

  constructor(private readonly ids: IdGenerator) {}

  async insert(memory: NewMemory): Promise<{ id: string }> {
    const id = this.ids.next();
    this.items.push({
      id,
      content: memory.content,
      tags: memory.tags,
      score: 0,
      embedding: memory.embedding,
    });
    return { id };
  }

  async search(search: MemorySearch): Promise<MemoryItem[]> {
    const needle = search.query.toLowerCase();
    const scored: MemoryItem[] = [];
    for (const item of this.items) {
      const { embedding, ...rest } = item;
      if (search.embedding !== undefined && embedding !== undefined) {
        scored.push({ ...rest, score: cosine(search.embedding, embedding) });
      } else if (search.embedding === undefined && item.content.toLowerCase().includes(needle)) {
        scored.push({ ...rest, score: 1 });
      }
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, search.limit);
  }
}
