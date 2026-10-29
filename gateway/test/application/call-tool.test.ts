import { describe, expect, it } from 'vitest';
import { CallTool } from '../../src/application/call-tool.js';
import { GatewayError } from '../../src/domain/errors.js';
import type { QuotaPolicy, ServiceClient } from '../../src/domain/ports.js';
import { InMemoryAuditLog, InMemoryAuthenticator } from '../../src/infrastructure/in-memory.js';

const clock = { now: () => new Date('2026-01-01T00:00:00Z') };
const auth = new InMemoryAuthenticator(new Map([['t', { subject: 'alice' }]]));
const answer = { structured: { status: 'ok' }, text: '{}', isError: false };

function setup(overrides: { quota?: QuotaPolicy; services?: ServiceClient } = {}) {
  const calls: string[] = [];
  const quota: QuotaPolicy = overrides.quota ?? { consume: async () => void calls.push('quota') };
  const services: ServiceClient = overrides.services ?? {
    invoke: async (service, tool) => {
      calls.push(`invoke:${service}/${tool}`);
      return answer;
    },
  };
  const audit = new InMemoryAuditLog();
  return { calls, audit, tool: new CallTool(auth, quota, services, audit, clock) };
}

describe('CallTool', () => {
  it('routes every contract tool to its owner (the catalogue is packages/contracts TOOLS)', async () => {
    const { tool, calls } = setup();
    await tool.execute({ tool: 'remember', args: { content: 'c' }, presented: { token: 't' } });
    expect(calls).toEqual(['quota', 'invoke:memory/remember']);
  });

  it('authenticates, applies the quota, routes to the owner and journals the call', async () => {
    const { tool, calls, audit } = setup();
    expect(await tool.execute({ tool: 'recall', args: { query: 'q' }, presented: { token: 't' } })).toBe(
      answer,
    );
    expect(calls).toEqual(['quota', 'invoke:memory/recall']);
    expect(audit.entries).toMatchObject([
      { subject: 'alice', tool: 'recall', owner: 'memory', outcome: 'ok' },
    ]);
  });

  it('refuses an unknown tool before touching auth or services', async () => {
    const { tool, calls, audit } = setup();
    await expect(tool.execute({ tool: 'nope', args: {}, presented: { token: 't' } })).rejects.toMatchObject({
      code: 'UNKNOWN_TOOL',
    });
    expect(calls).toEqual([]);
    expect(audit.entries).toMatchObject([
      { tool: 'nope', owner: null, outcome: 'error', error_code: 'UNKNOWN_TOOL' },
    ]);
  });

  it('refuses an unauthenticated call without consuming quota or routing, and journals it', async () => {
    const { tool, calls, audit } = setup();
    await expect(tool.execute({ tool: 'recall', args: {}, presented: {} })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(calls).toEqual([]);
    expect(audit.entries).toMatchObject([
      { subject: 'anonymous', outcome: 'error', error_code: 'UNAUTHORIZED' },
    ]);
  });
});

describe('CallTool refusals and failures', () => {
  it('does not route when the quota is exhausted', async () => {
    const { tool, calls, audit } = setup({
      quota: {
        consume: async () => {
          throw new GatewayError('QUOTA_EXCEEDED', 'quota exceeded');
        },
      },
    });
    await expect(tool.execute({ tool: 'recall', args: {}, presented: { token: 't' } })).rejects.toMatchObject(
      { code: 'QUOTA_EXCEEDED' },
    );
    expect(calls).toEqual([]);
    expect(audit.entries[0]).toMatchObject({ subject: 'alice', error_code: 'QUOTA_EXCEEDED' });
  });

  it('journals a service outage', async () => {
    const { tool, audit } = setup({
      services: {
        invoke: async () => {
          throw new GatewayError('SERVICE_UNAVAILABLE', 'down');
        },
      },
    });
    await expect(tool.execute({ tool: 'recall', args: {}, presented: { token: 't' } })).rejects.toMatchObject(
      { code: 'SERVICE_UNAVAILABLE' },
    );
    expect(audit.entries[0]).toMatchObject({ outcome: 'error', error_code: 'SERVICE_UNAVAILABLE' });
  });
});
