import type { MemoryItem } from '@agentic-ai/contracts';
import type { InternalTools } from './agent-port.js';

type Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/** Calls the memory service's internal endpoint (POST /internal/memory.search | memory.insert). */
export class HttpInternalTools implements InternalTools {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: Fetch = fetch as unknown as Fetch,
  ) {}

  private async post<T>(operation: string, body: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}/internal/${operation}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`internal tool ${operation} failed with HTTP ${response.status}`);
    return (await response.json()) as T;
  }

  search(query: string, limit: number): Promise<MemoryItem[]> {
    return this.post('memory.search', { query, limit });
  }

  insert(content: string, tags: string[]): Promise<{ id: string }> {
    return this.post('memory.insert', { content, tags });
  }
}

/** In-memory adapter of the InternalTools port. */
export class InMemoryInternalTools implements InternalTools {
  readonly items: MemoryItem[] = [];

  async search(query: string, limit: number): Promise<MemoryItem[]> {
    return this.items.filter((m) => m.content.toLowerCase().includes(query.toLowerCase())).slice(0, limit);
  }

  async insert(content: string, tags: string[]): Promise<{ id: string }> {
    const id = `w-${this.items.length + 1}`;
    this.items.push({ id, content, tags, score: 1 });
    return { id };
  }
}
