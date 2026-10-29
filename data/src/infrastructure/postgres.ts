import type { MemoryItem, Run, RunEvent, RunEventType, RunStatus } from '@agentic-ai/contracts';
import { InvalidOperationError, NotFoundError } from '../domain/errors.js';
import type { MemoryRepository, MemorySearch, NewMemory, NewRun, RunRepository } from '../domain/ports.js';

/** Minimal query surface the adapters need. The pg pool adapter lives in pg-pool.ts. */
export interface SqlExecutor {
  query(text: string, params: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  /** Runs `work` on one connection inside BEGIN/COMMIT, ROLLBACK on error. */
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toRun(row: Record<string, unknown>): Run {
  const run: Run = {
    id: String(row['id']),
    service: String(row['service']),
    tool: String(row['tool']),
    input: row['input'],
    status: row['status'] as RunStatus,
    created_at: iso(row['created_at']),
  };
  if (row['result'] !== null && row['result'] !== undefined) run.result = row['result'];
  if (row['completed_at'] !== null && row['completed_at'] !== undefined) {
    run.completed_at = iso(row['completed_at']);
  }
  return run;
}

function toEvent(row: Record<string, unknown>): RunEvent {
  return {
    seq: Number(row['seq']),
    run_id: String(row['run_id']),
    type: row['type'] as RunEventType,
    payload: (row['payload'] ?? {}) as Record<string, unknown>,
    at: iso(row['at']),
  };
}

const RUN_COLUMNS = 'id, service, tool, input, status, result, created_at, completed_at';

export class PostgresRunRepository implements RunRepository {
  constructor(private readonly sql: SqlExecutor) {}

  async create(run: NewRun): Promise<Run> {
    const { rows } = await this.sql.query(
      `INSERT INTO runs (service, tool, input, status) VALUES ($1, $2, $3::jsonb, 'running') RETURNING ${RUN_COLUMNS}`,
      [run.service, run.tool, JSON.stringify(run.input ?? null)],
    );
    return toRun(first(rows, 'run', 'new'));
  }

  async appendEvent(runId: string, type: RunEventType, payload: Record<string, unknown>): Promise<RunEvent> {
    const { rows } = await this.sql.query(
      `INSERT INTO run_events (run_id, seq, type, payload)
       SELECT $1::uuid, COALESCE(MAX(seq) + 1, 0), $2, $3::jsonb FROM run_events WHERE run_id = $1::uuid
       RETURNING run_id, seq, type, payload, at`,
      [runId, type, JSON.stringify(payload)],
    );
    return toEvent(first(rows, 'run', runId));
  }

  async complete(runId: string, status: Exclude<RunStatus, 'running'>, result: unknown): Promise<Run> {
    const { rows } = await this.sql.query(
      `UPDATE runs SET status = $2, result = $3::jsonb, completed_at = now()
       WHERE id = $1::uuid AND status = 'running' RETURNING ${RUN_COLUMNS}`,
      [runId, status, JSON.stringify(result ?? null)],
    );
    if (rows.length === 0) {
      await this.get(runId);
      throw new InvalidOperationError(`run ${runId} is not running`);
    }
    return toRun(first(rows, 'run', runId));
  }

  async get(runId: string): Promise<Run> {
    const { rows } = await this.sql.query(`SELECT ${RUN_COLUMNS} FROM runs WHERE id = $1::uuid`, [runId]);
    return toRun(first(rows, 'run', runId));
  }

  async events(runId: string): Promise<RunEvent[]> {
    await this.get(runId);
    const { rows } = await this.sql.query(
      'SELECT run_id, seq, type, payload, at FROM run_events WHERE run_id = $1::uuid ORDER BY seq',
      [runId],
    );
    return rows.map(toEvent);
  }
}

export class PostgresMemoryRepository implements MemoryRepository {
  constructor(private readonly sql: SqlExecutor) {}

  async insert(memory: NewMemory): Promise<{ id: string }> {
    const vector = memory.embedding === undefined ? null : `[${memory.embedding.join(',')}]`;
    const { rows } = await this.sql.query(
      'INSERT INTO memory.memories (content, tags, embedding) VALUES ($1, $2::text[], $3::vector) RETURNING id',
      [memory.content, memory.tags, vector],
    );
    return { id: String(first(rows, 'memory', 'new')['id']) };
  }

  async search(search: MemorySearch): Promise<MemoryItem[]> {
    const { rows } =
      search.embedding === undefined
        ? await this.sql.query(
            `SELECT id, content, tags, 1.0 AS score FROM memory.memories
             WHERE content ILIKE '%' || replace(replace(replace($1, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%'
             ORDER BY created_at DESC LIMIT $2`,
            [search.query, search.limit],
          )
        : await this.sql.query(
            `SELECT id, content, tags, 1 - (embedding <=> $1::vector) AS score FROM memory.memories
             WHERE embedding IS NOT NULL ORDER BY embedding <=> $1::vector LIMIT $2`,
            [`[${search.embedding.join(',')}]`, search.limit],
          );
    return rows.map((row) => ({
      id: String(row['id']),
      content: String(row['content']),
      tags: row['tags'] as string[],
      score: Number(row['score']),
    }));
  }
}

function first(rows: Record<string, unknown>[], what: string, id: string): Record<string, unknown> {
  const row = rows[0];
  if (row === undefined) throw new NotFoundError(what, id);
  return row;
}
