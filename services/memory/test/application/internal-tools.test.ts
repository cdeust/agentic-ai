import { describe, expect, it } from 'vitest';
import { InternalToolService } from '../../src/application/internal-tools.js';
import { InMemoryDataPort } from '../../src/infrastructure/in-memory.js';

describe('InternalToolService', () => {
  const tools = () => new InternalToolService(new InMemoryDataPort(), 'memory');

  it('runs the data operation of each internal tool, with the tool defaults applied', async () => {
    const service = tools();
    const stored = await service.call('memory_insert', { content: 'release is on Friday' });
    expect(stored).toMatchObject({ ok: true, value: { id: expect.any(String) } });
    expect(await service.call('memory_search', { query: 'friday' })).toMatchObject({
      ok: true,
      value: [{ content: 'release is on Friday', tags: [] }],
    });
  });

  it('refuses invalid input, unknown tools and tools of another owner', async () => {
    expect(await tools().call('memory_insert', { content: '' })).toMatchObject({ ok: false, status: 400 });
    expect(await tools().call('sql', {})).toMatchObject({ ok: false, status: 404 });
    expect(
      await new InternalToolService(new InMemoryDataPort(), 'billing').call('memory_search', { query: 'q' }),
    ).toMatchObject({
      ok: false,
      status: 404,
    });
  });
});
