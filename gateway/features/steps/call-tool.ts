import assert from 'node:assert/strict';
import { CallTool } from '../../src/application/call-tool.js';
import { GatewayError } from '../../src/domain/errors.js';
import type { QuotaPolicy, ServiceClient } from '../../src/domain/ports.js';
import { InMemoryAuditLog, InMemoryAuthenticator } from '../../src/infrastructure/in-memory.js';
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

const clock = { now: () => new Date('2026-01-01T00:00:00Z') };
const auth = new InMemoryAuthenticator(new Map([['t', { subject: 'alice' }]]));
const answer = { structured: { status: 'ok' }, text: '{}', isError: false };

class CallToolScenario {
  readonly calls: string[] = [];
  readonly audit = new InMemoryAuditLog();
  tool: CallTool | undefined;
  outcome: Attempt | undefined;

  recordingQuota(): QuotaPolicy {
    return { consume: async () => void this.calls.push('quota') };
  }
  recordingServices(): ServiceClient {
    return {
      invoke: async (service, tool) => {
        this.calls.push(`invoke:${service}/${tool}`);
        return answer;
      },
    };
  }
  build(quota: QuotaPolicy, services: ServiceClient): void {
    this.tool = new CallTool(auth, quota, services, this.audit, clock);
  }
}

const scenario = (world: GatewayWorld) => slot(world, 'call-tool', () => new CallToolScenario());

Given('a CallTool with a recording quota and a recording service client', function () {
  const s = scenario(this);
  s.build(s.recordingQuota(), s.recordingServices());
});

Given('a CallTool whose quota is exhausted and a recording service client', function () {
  const s = scenario(this);
  s.build(
    {
      consume: async () => {
        throw new GatewayError('QUOTA_EXCEEDED', 'quota exceeded');
      },
    },
    s.recordingServices(),
  );
});

Given('a CallTool with a recording quota and a service client that is unavailable', function () {
  const s = scenario(this);
  s.build(s.recordingQuota(), {
    invoke: async () => {
      throw new GatewayError('SERVICE_UNAVAILABLE', 'down');
    },
  });
});

async function call(world: GatewayWorld, tool: string, args: string, presented: { token?: string }) {
  const s = scenario(world);
  const callTool = required(s.tool, 'a CallTool');
  s.outcome = await attempt(() => callTool.execute({ tool, args: JSON.parse(args), presented }));
}

When(
  'the tool {string} is called with arguments {string} and token {string}',
  async function (tool: string, args: string, token: string) {
    await call(this, tool, args, { token });
  },
);

When(
  'the tool {string} is called with arguments {string} and no token',
  async function (tool: string, args: string) {
    await call(this, tool, args, {});
  },
);

Then('the call returns the service answer', function () {
  const { outcome } = scenario(this);
  assert.ok(outcome && !outcome.failed, 'the call must have succeeded');
  assert.equal(outcome.value, answer);
});

Then('the call is refused with code {string}', function (code: string) {
  refusedWith(scenario(this).outcome, code);
});

Then('the recorded calls are {string}', function (expected: string) {
  assert.deepEqual(scenario(this).calls, expected.split(', '));
});

Then('no call was recorded', function () {
  assert.deepEqual(scenario(this).calls, []);
});

Then('the audit entries match {string}', function (expected: string) {
  assertMatches(scenario(this).audit.entries, JSON.parse(expected));
});

Then('the first audit entry matches {string}', function (expected: string) {
  assertMatches(scenario(this).audit.entries[0], JSON.parse(expected));
});
