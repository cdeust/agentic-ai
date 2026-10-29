import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { compose, DEFAULT_LIMITS } from '../../src/main.js';
import { InMemoryDataPort, InMemoryRunRegistry } from '../../src/infrastructure/in-memory.js';
import { InProcessContainerRunner } from '../../src/infrastructure/in-process-runner.js';

const cost = { input_tokens: 1, output_tokens: 1, usd: 0 };

async function connect(stdout: string) {
  const app = compose({
    registry: new InMemoryRunRegistry(),
    data: new InMemoryDataPort(),
    runner: new InProcessContainerRunner(async () => ({ exitCode: 0, stdout })),
    limits: DEFAULT_LIMITS,
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await app.createServer().connect(serverSide);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientSide);
  return client;
}

describe('memory MCP server', () => {
  it('exposes the intent tools it owns', async () => {
    const client = await connect('{}');
    expect((await client.listTools()).tools.map((t) => t.name).sort()).toEqual(['recall', 'remember']);
  });

  it('answers a remember call with a structured Result', async () => {
    const stdout = JSON.stringify({ status: 'ok', data: { memory_id: 'm1' }, evidence: [], cost });
    const result = await (await connect(stdout)).callTool({ name: 'remember', arguments: { content: 'x' } });
    expect(result.structuredContent).toMatchObject({ status: 'ok', data: { memory_id: 'm1' } });
  });
});
