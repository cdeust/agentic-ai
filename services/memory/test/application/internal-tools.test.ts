import { expect, it } from 'vitest';
import { InternalToolService } from '../../src/application/internal-tools.js';
import { InMemoryMemoryStore } from '../../src/infrastructure/in-memory.js';

it('stores and searches through the MemoryStore port', async () => {
  const tools = new InternalToolService(new InMemoryMemoryStore());
  const { id } = await tools.insert('release is on Friday', ['plan']);
  expect((await tools.search('friday', 5)).map((m) => m.id)).toEqual([id]);
});
