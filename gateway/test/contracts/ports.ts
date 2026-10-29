import { describe, expect, it } from 'vitest';
import type { AuditLog, Authenticator, QuotaPolicy, ServiceClient } from '../../src/domain/ports.js';

/** Contract of the Authenticator port: `valid` is a token the adapter accepts for `subject`. */
export function authenticatorContract(
  name: string,
  make: () => Authenticator,
  valid: { token: string; subject: string },
): void {
  describe(`Authenticator contract: ${name}`, () => {
    it('resolves a valid token to its identity', async () => {
      expect(await make().authenticate({ token: valid.token })).toEqual({ subject: valid.subject });
    });
    it('rejects a missing or unknown token with UNAUTHORIZED', async () => {
      await expect(make().authenticate({})).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      await expect(make().authenticate({ token: 'nope' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });
  });
}

/** Contract of the QuotaPolicy port: the adapter allows exactly `limit` calls per identity and tool, then refuses. */
export function quotaContract(name: string, make: () => QuotaPolicy, limit: number): void {
  describe(`QuotaPolicy contract: ${name}`, () => {
    it('allows up to the limit then throws QUOTA_EXCEEDED', async () => {
      const quota = make();
      for (let i = 0; i < limit; i += 1) await quota.consume({ subject: 'a' }, 'recall');
      await expect(quota.consume({ subject: 'a' }, 'recall')).rejects.toMatchObject({
        code: 'QUOTA_EXCEEDED',
      });
    });
    it('counts per identity and per tool', async () => {
      const quota = make();
      for (let i = 0; i < limit; i += 1) await quota.consume({ subject: 'a' }, 'recall');
      await quota.consume({ subject: 'b' }, 'recall');
      await quota.consume({ subject: 'a' }, 'remember');
    });
  });
}

/** Contract of the AuditLog port: `read` returns what was recorded, in order. */
export function auditLogContract(name: string, make: () => { log: AuditLog; read(): unknown[] }): void {
  describe(`AuditLog contract: ${name}`, () => {
    it('records entries in order without loss', async () => {
      const { log, read } = make();
      const base = { at: '2026-01-01T00:00:00.000Z', subject: 's', owner: 'memory', duration_ms: 1 } as const;
      await log.record({ ...base, tool: 'recall', outcome: 'ok' });
      await log.record({ ...base, tool: 'remember', outcome: 'error', error_code: 'QUOTA_EXCEEDED' });
      expect(read()).toMatchObject([{ tool: 'recall' }, { tool: 'remember', error_code: 'QUOTA_EXCEEDED' }]);
    });
  });
}

/** Contract of the ServiceClient port: `make` yields a client where "memory/recall" answers `{ ok: true }` and nothing else exists. */
export function serviceClientContract(name: string, make: () => ServiceClient): void {
  describe(`ServiceClient contract: ${name}`, () => {
    it('routes to the owner and returns its answer untouched', async () => {
      const response = await make().invoke('memory', 'recall', { query: 'q' });
      expect(response).toMatchObject({ isError: false, structured: { ok: true } });
    });
    it('throws SERVICE_UNAVAILABLE for a service it cannot reach', async () => {
      await expect(make().invoke('ghost', 'recall', {})).rejects.toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
      });
    });
  });
}
