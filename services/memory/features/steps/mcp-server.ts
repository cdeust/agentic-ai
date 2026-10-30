import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { InMemoryDataPort, InMemoryRunRegistry } from '../../src/infrastructure/in-memory.js';
import { InProcessContainerRunner } from '../../src/infrastructure/in-process-runner.js';
import { compose, DEFAULT_LIMITS } from '../../src/main.js';
import { Given, Then, When, assertMatches, required, slot, type MemoryWorld } from './helpers.js';

class McpScenario {
  client: Client | undefined;
  tools: string[] = [];
  result: Awaited<ReturnType<Client['callTool']>> | undefined;
}

const scenario = (world: MemoryWorld) => slot(world, 'memory-mcp', () => new McpScenario());

Given('a memory MCP client over a worker that prints {string}', async function (stdout: string) {
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
  scenario(this).client = client;
});

When('the memory MCP client lists the tools', async function () {
  const s = scenario(this);
  s.tools = (await required(s.client, 'a memory MCP client').listTools()).tools.map((t) => t.name).sort();
});

When(
  'the memory MCP client calls {string} with arguments {string}',
  async function (name: string, args: string) {
    const s = scenario(this);
    s.result = await required(s.client, 'a memory MCP client').callTool({
      name,
      arguments: JSON.parse(args),
    });
  },
);

Then('the memory tool names are {string}', function (names: string) {
  assert.deepEqual(scenario(this).tools, names.split(', '));
});

Then('the memory structured content matches {string}', function (expected: string) {
  assertMatches(
    required(scenario(this).result, 'a tool call result').structuredContent,
    JSON.parse(expected),
  );
});
