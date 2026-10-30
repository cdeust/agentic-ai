import { DATA_OPS, type DataOpName, type RunEventType, type RunStatus } from '@architect-os/contracts';
import { ServiceError, type DataPort, type RunRegistry } from '../domain/ports.js';

export type Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** Talks to the data component's typed HTTP API. The only way this service reaches storage. */
export class HttpDataClient implements RunRegistry, DataPort {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: Fetch = fetch as unknown as Fetch,
  ) {}

  async call(op: DataOpName, args: unknown): Promise<unknown> {
    const unavailable = (detail: string) => new ServiceError('DATA_UNAVAILABLE', `data call ${op} ${detail}`);
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/ops/${op}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(args),
      });
    } catch (error) {
      throw unavailable(`failed: ${String(error)}`);
    }
    const body = await response.text();
    if (!response.ok) throw unavailable(`rejected with ${response.status}: ${body}`);
    const parsed = DATA_OPS[op].output.safeParse(JSON.parse(body));
    if (!parsed.success) throw unavailable('returned an invalid body');
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
}
