import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import {
  InMemoryAuditLog,
  InMemoryAuthenticator,
  InMemoryQuota,
  InMemoryServiceClient,
} from '../../src/infrastructure/in-memory.js';
import { compose, routes } from '../../src/main.js';

const clock = { now: () => new Date('2026-01-01T00:00:00Z') };
const okResult = {
  status: 'ok',
  data: { memory_id: 'm1' },
  evidence: [],
  run_id: 'r1',
  cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
};

async function connect(token: string | undefined, quota = 5) {
  const audit = new InMemoryAuditLog();
  const app = compose({
    auth: new InMemoryAuthenticator(new Map([['good', { subject: 'alice' }]])),
    quota: new InMemoryQuota(quota, 60_000, clock),
    services: new InMemoryServiceClient(
      new Map([
        [
          'memory/remember',
          async () => ({ structured: okResult, text: JSON.stringify(okResult), isError: false }),
        ],
      ]),
    ),
    audit,
    clock,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  if (token !== undefined) {
    const send = clientSide.send.bind(clientSide);
    clientSide.send = (message, options) =>
      send(message, { ...options, authInfo: { token, clientId: 'test', scopes: [] } });
  }
  await app.createServer().connect(serverSide);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientSide);
  return { client, audit };
}

describe('gateway MCP server', () => {
  it('lists the catalogue', async () => {
    const { client } = await connect('good');
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(['recall', 'remember']);
  });

  it('forwards a call to the owner and returns its structured Result', async () => {
    const { client, audit } = await connect('good');
    const result = await client.callTool({ name: 'remember', arguments: { content: 'x' } });
    expect(result.structuredContent).toMatchObject({ status: 'ok', run_id: 'r1' });
    expect(audit.entries).toMatchObject([{ outcome: 'ok', tool: 'remember' }]);
  });

  it.each([
    ['no token', undefined, 'UNAUTHORIZED'],
    ['a bad token', 'bad', 'UNAUTHORIZED'],
  ])('answers %s with a named error', async (_name, token, code) => {
    const { client } = await connect(token);
    const result = await client.callTool({ name: 'remember', arguments: { content: 'x' } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain(code);
  });

  it('answers QUOTA_EXCEEDED once the quota is used', async () => {
    const { client } = await connect('good', 1);
    await client.callTool({ name: 'remember', arguments: { content: 'x' } });
    const second = await client.callTool({ name: 'remember', arguments: { content: 'x' } });
    expect(second.isError).toBe(true);
    expect(JSON.stringify(second.content)).toContain('QUOTA_EXCEEDED');
  });

  it('answers SERVICE_UNAVAILABLE when no handler owns the tool', async () => {
    const { client } = await connect('good');
    const result = await client.callTool({ name: 'recall', arguments: { query: 'q' } });
    expect(JSON.stringify(result.content)).toContain('SERVICE_UNAVAILABLE');
  });
});

describe('gateway routes', () => {
  it('derives one route per owning service, with the URL variable compose.yaml sets', () => {
    expect(routes()).toEqual([{ service: 'memory', urlVariable: 'MEMORY_URL' }]);
  });
});
