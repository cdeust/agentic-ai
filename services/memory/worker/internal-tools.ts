import type { InternalToolName } from '@architect-os/contracts';
import type { InternalTools } from './agent-port.js';

type Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Calls the memory service's internal endpoint: POST /internal/<tool>. */
export class HttpInternalTools implements InternalTools {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: Fetch = fetch as unknown as Fetch,
  ) {}

  async call(tool: InternalToolName, args: Record<string, unknown>): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}/internal/${tool}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!response.ok) throw new Error(`internal tool ${tool} failed with HTTP ${response.status}`);
    return response.json();
  }
}
