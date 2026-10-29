import { describe, expect, it } from 'vitest';
import { DataUnavailableError } from '../../src/domain/ports.js';
import { HttpDataClient, type Fetch } from '../../src/infrastructure/data-client.js';

const reply =
  (status: number, body: unknown): Fetch =>
  async () => ({
    ok: status < 400,
    status,
    text: async () => JSON.stringify(body),
  });

describe('HttpDataClient', () => {
  it('posts typed operations to /v1/ops and validates the answer', async () => {
    const seen: { url: string; body: unknown }[] = [];
    const client = new HttpDataClient('http://data:8082', async (url, init) => {
      seen.push({ url, body: JSON.parse(init.body) });
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            id: 'r1',
            service: 'memory',
            tool: 'recall',
            input: {},
            status: 'running',
            created_at: 'now',
          }),
      };
    });
    expect(await client.create('recall', { query: 'q' })).toEqual({ id: 'r1' });
    expect(seen[0]).toEqual({
      url: 'http://data:8082/v1/ops/runs.create',
      body: { service: 'memory', tool: 'recall', input: { query: 'q' } },
    });
  });

  it('maps rejections, transport errors and malformed answers to DataUnavailableError', async () => {
    await expect(
      new HttpDataClient('http://d', reply(404, { code: 'NOT_FOUND' })).appendEvent('x', 'run.created', {}),
    ).rejects.toBeInstanceOf(DataUnavailableError);
    const down = new HttpDataClient('http://d', async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(down.search('q', 1)).rejects.toBeInstanceOf(DataUnavailableError);
    await expect(
      new HttpDataClient('http://d', reply(200, { nope: true })).search('q', 1),
    ).rejects.toBeInstanceOf(DataUnavailableError);
  });
});
