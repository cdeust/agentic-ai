import {
  DATA_OPS,
  type DataOpName,
  type MemoryItem,
  type RunEventType,
  type RunStatus,
} from '@agentic-ai/contracts';
import { DataUnavailableError, type MemoryStore, type RunRegistry } from '../domain/ports.js';

export type Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** Talks to the data component's typed HTTP API. The only way this service reaches storage. */
export class HttpDataClient implements RunRegistry, MemoryStore {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: Fetch = fetch as unknown as Fetch,
  ) {}

  private async call(op: DataOpName, args: Record<string, unknown>): Promise<unknown> {
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/ops/${op}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(args),
      });
    } catch (error) {
      throw new DataUnavailableError(`data call ${op} failed: ${String(error)}`);
    }
    const body = await response.text();
    if (!response.ok)
      throw new DataUnavailableError(`data call ${op} rejected with ${response.status}: ${body}`);
    const parsed = DATA_OPS[op].output.safeParse(JSON.parse(body));
    if (!parsed.success) throw new DataUnavailableError(`data call ${op} returned an invalid body`);
    return parsed.data;
  }

  async create(tool: string, input: unknown): Promise<{ id: string }> {
    const run = (await this.call('runs.create', { service: 'memory', tool, input })) as { id: string };
    return { id: run.id };
  }

  async appendEvent(runId: string, type: RunEventType, payload: Record<string, unknown>): Promise<void> {
    await this.call('runs.appendEvent', { run_id: runId, type, payload });
  }

  async complete(runId: string, status: Exclude<RunStatus, 'running'>, result: unknown): Promise<void> {
    await this.call('runs.complete', { run_id: runId, status, result });
  }

  async insert(content: string, tags: string[]): Promise<{ id: string }> {
    return (await this.call('memory.insert', { content, tags })) as { id: string };
  }

  async search(query: string, limit: number): Promise<MemoryItem[]> {
    return (await this.call('memory.search', { query, limit })) as MemoryItem[];
  }
}
