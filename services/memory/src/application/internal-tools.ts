import type { MemoryItem } from '@agentic-ai/contracts';
import type { MemoryStore } from '../domain/ports.js';

/** Tools the worker's agent may call back into. Served only on the exec network. */
export class InternalToolService {
  constructor(private readonly store: MemoryStore) {}

  search(query: string, limit: number): Promise<MemoryItem[]> {
    return this.store.search(query, limit);
  }

  insert(content: string, tags: string[]): Promise<{ id: string }> {
    return this.store.insert(content, tags);
  }
}
