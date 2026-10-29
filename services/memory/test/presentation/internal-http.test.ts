import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { InternalToolService } from '../../src/application/internal-tools.js';
import { InMemoryMemoryStore } from '../../src/infrastructure/in-memory.js';
import { createInternalToolsHost } from '../../src/presentation/internal-http.js';
import { HttpInternalTools } from '../../worker/internal-tools.js';

const servers: ReturnType<typeof createInternalToolsHost>[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

async function start() {
  const server = createInternalToolsHost(new InternalToolService(new InMemoryMemoryStore()));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('internal tools endpoint', () => {
  it('serves the worker HttpInternalTools adapter end to end', async () => {
    const tools = new HttpInternalTools(await start());
    const { id } = await tools.insert('the cache TTL is 60s', ['cache']);
    expect((await tools.search('cache ttl', 3)).map((m) => m.id)).toEqual([id]);
  });

  it('rejects malformed bodies and unknown paths', async () => {
    const base = await start();
    const bad = await fetch(`${base}/internal/memory.search`, {
      method: 'POST',
      body: JSON.stringify({ limit: 'x' }),
    });
    expect(bad.status).toBe(400);
    expect((await fetch(`${base}/internal/sql`, { method: 'POST', body: '{}' })).status).toBe(404);
  });
});
