import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  InMemoryAuditLog,
  InMemoryAuthenticator,
  InMemoryQuota,
  InMemoryServiceClient,
} from '../../src/infrastructure/in-memory.js';
import { compose, routes } from '../../src/main.js';
import { Given, Then, When, assertMatches, required, slot, type GatewayWorld } from './helpers.js';

const clock = { now: () => new Date('2026-01-01T00:00:00Z') };
const okResult = {
  status: 'ok',
  data: { memory_id: 'm1' },
  evidence: [],
  run_id: 'r1',
  cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
};

type CallResult = Awaited<ReturnType<Client['callTool']>>;

class GatewayScenario {
  client: Client | undefined;
  audit = new InMemoryAuditLog();
  tools: string[] = [];
  result: CallResult | undefined;
  routes: unknown;
}

const scenario = (world: GatewayWorld) => slot(world, 'gateway-mcp', () => new GatewayScenario());

/** A gateway over in-memory transports (real MCP framing); `token` is attached to every client message. */
async function connect(s: GatewayScenario, token: string | undefined, quota: number): Promise<void> {
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
    audit: s.audit,
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
  s.client = client;
}

Given('a connected gateway client with token {string}', async function (token: string) {
  await connect(scenario(this), token, 5);
});

Given('a connected gateway client without a token', async function () {
  await connect(scenario(this), undefined, 5);
});

Given(
  'a connected gateway client with token {string} and a quota of {int} call',
  async function (token: string, quota: number) {
    await connect(scenario(this), token, quota);
  },
);

When('the gateway client lists the tools', async function () {
  const s = scenario(this);
  const client = required(s.client, 'a gateway client');
  s.tools = (await client.listTools()).tools.map((t) => t.name).sort();
});

When(
  'the gateway client calls {string} with arguments {string}',
  async function (name: string, args: string) {
    const s = scenario(this);
    const client = required(s.client, 'a gateway client');
    s.result = await client.callTool({ name, arguments: JSON.parse(args) });
  },
);

When('the gateway routes are derived', function () {
  scenario(this).routes = routes();
});

Then('the gateway tool names are {string}', function (names: string) {
  assert.deepEqual(scenario(this).tools, names.split(', '));
});

const lastResult = (s: GatewayScenario) => required(s.result, 'a tool call result');

Then('the gateway structured content matches {string}', function (expected: string) {
  assertMatches(lastResult(scenario(this)).structuredContent, JSON.parse(expected));
});

Then('the gateway audit entries match {string}', function (expected: string) {
  assertMatches(scenario(this).audit.entries, JSON.parse(expected));
});

Then('the gateway answer is an error containing {string}', function (code: string) {
  const result = lastResult(scenario(this));
  assert.equal(result.isError, true);
  assert.ok(JSON.stringify(result.content).includes(code), `the answer does not contain ${code}`);
});

Then('the gateway answer contains {string}', function (code: string) {
  assert.ok(
    JSON.stringify(lastResult(scenario(this)).content).includes(code),
    `the answer does not contain ${code}`,
  );
});

Then('the gateway routes are {string}', function (expected: string) {
  assert.deepEqual(scenario(this).routes, JSON.parse(expected));
});
