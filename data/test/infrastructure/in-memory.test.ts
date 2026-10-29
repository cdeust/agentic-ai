import { describe, expect, it } from 'vitest';
import { InMemoryMemoryRepository, InMemoryRunRepository } from '../../src/infrastructure/in-memory.js';
import { SystemClock, UuidGenerator } from '../../src/infrastructure/system.js';
import { memoryRepositoryContract, runRepositoryContract } from '../contracts/repositories.js';

runRepositoryContract('in-memory', () => new InMemoryRunRepository(new UuidGenerator(), new SystemClock()));
memoryRepositoryContract('in-memory', () => new InMemoryMemoryRepository(new UuidGenerator()));

describe('InMemoryMemoryRepository vector search', () => {
  it('ranks by cosine similarity when an embedding is given', async () => {
    const repo = new InMemoryMemoryRepository(new UuidGenerator());
    await repo.insert({ content: 'near', tags: [], embedding: [1, 0, 0] });
    await repo.insert({ content: 'far', tags: [], embedding: [0, 1, 0] });
    const found = await repo.search({ query: '', embedding: [1, 0.1, 0], limit: 2 });
    expect(found.map((m) => m.content)).toEqual(['near', 'far']);
  });
});
