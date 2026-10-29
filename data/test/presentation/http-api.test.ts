import type { AddressInfo } from 'node:net';
import { DATA_OP_NAMES } from '@agentic-ai/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { composeInMemory } from '../../src/main.js';

const servers: { close(): unknown }[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

async function start() {
  const server = composeInMemory().createServer();
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, { method: 'POST', body: JSON.stringify(body) });
  return { base, post };
}

describe('data HTTP API', () => {
  it('serves health', async () => {
    const { base } = await start();
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
  });

  it('serves every typed operation and nothing else', async () => {
    const { post } = await start();
    for (const op of DATA_OP_NAMES) expect((await post(`/v1/ops/${op}`, {})).status).not.toBe(404);
    expect((await post('/v1/ops/sql', { text: 'select 1' })).status).toBe(404);
    expect((await post('/v1/query', { text: 'select 1' })).status).toBe(404);
  });

  it('maps domain errors to HTTP statuses with a code', async () => {
    const { post } = await start();
    const created = await post('/v1/ops/runs.create', { service: 'memory', tool: 'recall', input: {} });
    expect(created.status).toBe(200);
    const missing = await post('/v1/ops/runs.get', { run_id: '00000000-0000-4000-8000-000000000000' });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: 'NOT_FOUND' });
    expect((await post('/v1/ops/runs.create', { service: 1 })).status).toBe(400);
    const run = (await (await post('/v1/ops/runs.create', { service: 'a', tool: 'b', input: 1 })).json()) as {
      id: string;
    };
    await post('/v1/ops/runs.complete', { run_id: run.id, status: 'ok', result: null });
    expect((await post('/v1/ops/runs.complete', { run_id: run.id, status: 'ok', result: null })).status).toBe(
      409,
    );
  });
});
