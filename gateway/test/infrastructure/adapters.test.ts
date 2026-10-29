import { describe, expect, it } from 'vitest';
import {
  InMemoryAuditLog,
  InMemoryAuthenticator,
  InMemoryQuota,
  InMemoryServiceClient,
} from '../../src/infrastructure/in-memory.js';
import { McpServiceClient } from '../../src/infrastructure/mcp-service-client.js';
import { JsonLinesAuditLog } from '../../src/infrastructure/stdout-audit-log.js';
import {
  auditLogContract,
  authenticatorContract,
  quotaContract,
  serviceClientContract,
} from '../contracts/ports.js';

const clock = { now: () => new Date('2026-01-01T00:00:00Z') };

authenticatorContract(
  'in-memory',
  () => new InMemoryAuthenticator(new Map([['t-1', { subject: 'alice' }]])),
  {
    token: 't-1',
    subject: 'alice',
  },
);
quotaContract('in-memory', () => new InMemoryQuota(2, 60_000, clock), 2);
auditLogContract('in-memory', () => {
  const log = new InMemoryAuditLog();
  return { log, read: () => log.entries };
});
auditLogContract('json lines', () => {
  const lines: string[] = [];
  return {
    log: new JsonLinesAuditLog((line) => lines.push(line)),
    read: () => lines.map((l) => JSON.parse(l) as unknown),
  };
});
serviceClientContract(
  'in-memory',
  () =>
    new InMemoryServiceClient(
      new Map([
        ['memory/recall', async () => ({ structured: { ok: true }, text: '{"ok":true}', isError: false })],
      ]),
    ),
);
serviceClientContract(
  'mcp',
  () =>
    new McpServiceClient(
      new Map([
        [
          'memory',
          {
            callTool: async () => ({
              content: [{ type: 'text', text: '{"ok":true}' }],
              structuredContent: { ok: true },
            }),
          } as never,
        ],
      ]),
    ),
);

describe('InMemoryQuota window', () => {
  it('resets after the window elapses', async () => {
    let now = 0;
    const quota = new InMemoryQuota(1, 1000, { now: () => new Date(now) });
    await quota.consume({ subject: 'a' }, 't');
    now = 1001;
    await quota.consume({ subject: 'a' }, 't');
  });
});

describe('McpServiceClient failures', () => {
  it('wraps transport errors and keeps the service error flag', async () => {
    const broken = new McpServiceClient(
      new Map([['memory', { callTool: async () => Promise.reject(new Error('down')) } as never]]),
    );
    await expect(broken.invoke('memory', 'recall', {})).rejects.toThrow('down');
    const erroring = new McpServiceClient(
      new Map([
        [
          'memory',
          { callTool: async () => ({ content: [{ type: 'text', text: 'boom' }], isError: true }) } as never,
        ],
      ]),
    );
    expect(await erroring.invoke('memory', 'recall', {})).toMatchObject({ isError: true, text: 'boom' });
  });
});
