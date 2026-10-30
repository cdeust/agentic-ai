import assert from 'node:assert/strict';
import type { AuditLog, Authenticator, QuotaPolicy, ServiceClient } from '../../src/domain/ports.js';
import {
  InMemoryAuditLog,
  InMemoryAuthenticator,
  InMemoryQuota,
  InMemoryServiceClient,
} from '../../src/infrastructure/in-memory.js';
import { McpServiceClient } from '../../src/infrastructure/mcp-service-client.js';
import { JsonLinesAuditLog } from '../../src/infrastructure/stdout-audit-log.js';
import {
  Given,
  Then,
  When,
  assertMatches,
  attempt,
  refusedWith,
  required,
  slot,
  type Attempt,
  type GatewayWorld,
} from './helpers.js';

class AdapterScenario {
  authenticator: Authenticator | undefined;
  quota: QuotaPolicy | undefined;
  clock = 0;
  audit: { log: AuditLog; read(): unknown[] } | undefined;
  services: ServiceClient | undefined;
  outcome: Attempt | undefined;
}

const scenario = (world: GatewayWorld) => slot(world, 'adapters', () => new AdapterScenario());
const fixedClock = { now: () => new Date('2026-01-01T00:00:00Z') };

// --- Authenticator ---

Given(
  'the {string} authenticator accepting token {string} for subject {string}',
  function (adapter: string, token: string, subject: string) {
    assert.equal(adapter, 'in-memory', `unknown Authenticator adapter: ${adapter}`);
    scenario(this).authenticator = new InMemoryAuthenticator(new Map([[token, { subject }]]));
  },
);

Then(
  'authenticating with token {string} resolves to the identity {string}',
  async function (token: string, identity: string) {
    const authenticator = required(scenario(this).authenticator, 'an authenticator');
    assert.deepEqual(await authenticator.authenticate({ token }), JSON.parse(identity));
  },
);

Then('authenticating without a token is refused with code {string}', async function (code: string) {
  const authenticator = required(scenario(this).authenticator, 'an authenticator');
  refusedWith(await attempt(() => authenticator.authenticate({})), code);
});

Then(
  'authenticating with token {string} is refused with code {string}',
  async function (token: string, code: string) {
    const authenticator = required(scenario(this).authenticator, 'an authenticator');
    refusedWith(await attempt(() => authenticator.authenticate({ token })), code);
  },
);

// --- QuotaPolicy ---

Given('the {string} quota policy with a limit of {int} calls', function (adapter: string, limit: number) {
  assert.equal(adapter, 'in-memory', `unknown QuotaPolicy adapter: ${adapter}`);
  scenario(this).quota = new InMemoryQuota(limit, 60_000, fixedClock);
});

Given(
  'an in-memory quota policy with a limit of {int} call per {int} ms on a manual clock',
  function (limit: number, windowMs: number) {
    const s = scenario(this);
    s.clock = 0;
    s.quota = new InMemoryQuota(limit, windowMs, { now: () => new Date(s.clock) });
  },
);

When('the quota clock moves to {int} ms', function (ms: number) {
  scenario(this).clock = ms;
});

When(
  'subject {string} consumes {string} {int} times',
  async function (subject: string, tool: string, times: number) {
    const quota = required(scenario(this).quota, 'a quota policy');
    for (let i = 0; i < times; i += 1) await quota.consume({ subject }, tool);
  },
);

Then(
  'subject {string} consuming {string} is refused with code {string}',
  async function (subject: string, tool: string, code: string) {
    const quota = required(scenario(this).quota, 'a quota policy');
    refusedWith(await attempt(() => quota.consume({ subject }, tool)), code);
  },
);

Then('subject {string} can consume {string}', async function (subject: string, tool: string) {
  const quota = required(scenario(this).quota, 'a quota policy');
  await quota.consume({ subject }, tool);
});

// --- AuditLog ---

Given('the {string} audit log', function (adapter: string) {
  const s = scenario(this);
  if (adapter === 'in-memory') {
    const log = new InMemoryAuditLog();
    s.audit = { log, read: () => log.entries };
  } else if (adapter === 'json lines') {
    const lines: string[] = [];
    s.audit = {
      log: new JsonLinesAuditLog((line) => lines.push(line)),
      read: () => lines.map((l) => JSON.parse(l) as unknown),
    };
  } else {
    assert.fail(`unknown AuditLog adapter: ${adapter}`);
  }
});

When('the audit log records the entry {string}', async function (entry: string) {
  const { log } = required(scenario(this).audit, 'an audit log');
  const base = { at: '2026-01-01T00:00:00.000Z', subject: 's', owner: 'memory', duration_ms: 1 } as const;
  await log.record({ ...base, ...JSON.parse(entry) });
});

Then('the audit log reads back {string}', function (expected: string) {
  const { read } = required(scenario(this).audit, 'an audit log');
  assertMatches(read(), JSON.parse(expected));
});

// --- ServiceClient ---

Given(
  'the {string} service client where {string} answers {string}',
  function (adapter: string, route: string, structured: string) {
    const body = JSON.parse(structured) as Record<string, unknown>;
    const s = scenario(this);
    if (adapter === 'in-memory') {
      s.services = new InMemoryServiceClient(
        new Map([[route, async () => ({ structured: body, text: structured, isError: false })]]),
      );
    } else if (adapter === 'mcp') {
      const service = route.split('/')[0] ?? '';
      s.services = new McpServiceClient(
        new Map([
          [
            service,
            {
              callTool: async () => ({
                content: [{ type: 'text', text: structured }],
                structuredContent: body,
              }),
            } as never,
          ],
        ]),
      );
    } else {
      assert.fail(`unknown ServiceClient adapter: ${adapter}`);
    }
  },
);

Given(
  'an MCP service client whose {string} client fails with {string}',
  function (service: string, message: string) {
    scenario(this).services = new McpServiceClient(
      new Map([[service, { callTool: async () => Promise.reject(new Error(message)) } as never]]),
    );
  },
);

Given(
  'an MCP service client whose {string} client answers an error with the text {string}',
  function (service: string, text: string) {
    scenario(this).services = new McpServiceClient(
      new Map([
        [service, { callTool: async () => ({ content: [{ type: 'text', text }], isError: true }) } as never],
      ]),
    );
  },
);

When(
  'the service client invokes {string} tool {string} with arguments {string}',
  async function (service: string, tool: string, args: string) {
    const s = scenario(this);
    const services = required(s.services, 'a service client');
    s.outcome = await attempt(() => services.invoke(service, tool, JSON.parse(args)));
  },
);

Then('the service client response matches {string}', function (expected: string) {
  const { outcome } = scenario(this);
  assert.ok(outcome && !outcome.failed, 'the invocation must have succeeded');
  assertMatches(outcome.value, JSON.parse(expected));
});

Then('the service client invocation is refused with code {string}', function (code: string) {
  refusedWith(scenario(this).outcome, code);
});

Then('the service client invocation is rejected with a message containing {string}', function (part: string) {
  const { outcome } = scenario(this);
  assert.ok(outcome?.failed, 'the invocation must have been rejected');
  assert.ok((outcome.error as Error).message.includes(part), `message does not contain ${part}`);
});
