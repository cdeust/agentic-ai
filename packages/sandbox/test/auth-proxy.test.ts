import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commandCredential, startAuthProxy, usageOf, type AuthProxy } from '../src/auth-proxy.js';

/** Faux amont : enregistre méthode, chemin et en-têtes, répond en SSE avec un `usage`. */
interface Seen {
  method?: string;
  url?: string;
  headers?: IncomingHttpHeaders;
  body?: string;
}
const SSE = [
  'event: message_start',
  'data: {"type":"message_start","message":{"model":"claude-test","content":[],"usage":{"input_tokens":12,"cache_read_input_tokens":3,"output_tokens":1}}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"SECRET-CONTENT"}}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","usage":{"output_tokens":7}}',
  '',
].join('\n');

describe('auth proxy (host side, fake upstream, fake credential)', () => {
  let upstream: Server;
  let seen: Seen[];
  let proxy: AuthProxy;
  let dir: string;
  const TOKEN = 'session-token-for-tests';
  const call = (path: string, init: RequestInit = {}, token = TOKEN) =>
    fetch(`http://127.0.0.1:${proxy.port}${path}`, {
      method: 'POST',
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
    });

  beforeEach(async () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'aos-proxy-')));
    seen = [];
    upstream = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, headers: req.headers, body });
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(SSE);
      });
    });
    await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done));
    proxy = await startAuthProxy({
      upstream: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
      routes: ['^/v1/messages(/count_tokens)?(\\?[^#]*)?$'],
      betas: ['oauth-2025-04-20'],
      sessionToken: TOKEN,
      credential: async () => ({ accessToken: 'host-credential' }),
      usageLog: join(dir, 'usage.jsonl'),
    });
  });
  afterEach(async () => {
    await proxy.close();
    await new Promise<void>((done) => upstream.close(() => done()));
    rmSync(dir, { recursive: true, force: true });
  });

  it('relays POST /v1/messages with the host credential in place of the session token', async () => {
    const res = await call('/v1/messages?beta=true', {
      body: '{"model":"m"}',
      headers: { 'anthropic-beta': 'x-1', 'x-api-key': 'leak' },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(SSE);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe('/v1/messages?beta=true');
    expect(seen[0]?.body).toBe('{"model":"m"}');
    expect(seen[0]?.headers?.['authorization']).toBe('Bearer host-credential');
    expect(seen[0]?.headers?.['x-api-key']).toBeUndefined();
    expect(seen[0]?.headers?.['anthropic-beta']).toBe('x-1,oauth-2025-04-20');
  });

  it('logs one usage line per response: model, tokens, time, never content nor credential', async () => {
    await (await call('/v1/messages', { body: '{}' })).text();
    const log = readFileSync(join(dir, 'usage.jsonl'), 'utf8');
    const record = JSON.parse(log.trim()) as Record<string, unknown>;
    expect(record).toMatchObject({
      status: 200,
      model: 'claude-test',
      input_tokens: 12,
      cache_read_input_tokens: 3,
      output_tokens: 7,
    });
    expect(typeof record['at']).toBe('string');
    expect(log).not.toContain('SECRET-CONTENT');
    expect(log).not.toContain('host-credential');
    expect(log).not.toContain(TOKEN);
  });

  it('refuses without the session token (401), and forwards nothing', async () => {
    expect((await call('/v1/messages', { body: '{}' }, 'wrong')).status).toBe(401);
    expect(
      (await fetch(`http://127.0.0.1:${proxy.port}/v1/messages`, { method: 'POST', body: '{}' })).status,
    ).toBe(401);
    expect(seen).toEqual([]);
  });

  it.each([
    ['GET', '/v1/messages'],
    ['POST', '/v1/models'],
    ['POST', '/api/oauth/profile'],
    ['POST', '/v1/messages/batches'],
    ['POST', '//evil.example/v1/messages'],
    ['POST', '/v1/messages/../../api/oauth/token'],
  ])('refuses %s %s (403), and forwards nothing', async (method, path) => {
    const res = await call(path, method === 'GET' ? { method } : { method, body: '{}' });
    expect(res.status).toBe(403);
    expect(seen).toEqual([]);
  });

  it('refuses the session token once revoked (401)', async () => {
    proxy.revoke();
    expect((await call('/v1/messages', { body: '{}' })).status).toBe(401);
    expect(seen).toEqual([]);
  });

  it('answers 503 without detail when the host credential cannot be read', async () => {
    await proxy.close();
    proxy = await startAuthProxy({
      upstream: 'http://127.0.0.1:9',
      routes: ['^/v1/messages$'],
      betas: [],
      sessionToken: TOKEN,
      credential: async () => {
        throw new Error('detail that must not leak');
      },
    });
    const res = await call('/v1/messages', { body: '{}' });
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('detail that must not leak');
  });
});

describe('usageOf', () => {
  it('reads a JSON response and ignores unparseable bodies', () => {
    expect(
      usageOf('application/json', '{"model":"m","content":[{"text":"x"}],"usage":{"input_tokens":1}}'),
    ).toEqual({
      model: 'm',
      input_tokens: 1,
    });
    expect(usageOf('application/json', 'not json')).toEqual({});
  });
});

describe('commandCredential', () => {
  let dir: string;
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'aos-cred-')));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const script = (body: string) => {
    const file = join(dir, 'cred.mjs');
    writeFileSync(file, `#!/usr/bin/env node\n${body}\n`);
    chmodSync(file, 0o755);
    return [process.execPath, file];
  };

  it('reads claudeAiOauth.accessToken and caches it while it is fresh', async () => {
    const counter = join(dir, 'count');
    const argv = script(
      `import { appendFileSync } from 'node:fs'; appendFileSync(${JSON.stringify(counter)}, 'x');` +
        `console.log(JSON.stringify({ claudeAiOauth: { accessToken: 'a', expiresAt: Date.now() + 3600e3 } }));`,
    );
    const source = commandCredential(argv);
    expect(await source()).toMatchObject({ accessToken: 'a' });
    expect(await source()).toMatchObject({ accessToken: 'a' });
    expect(readFileSync(counter, 'utf8')).toBe('x');
  });

  it('refuses an expired credential and never echoes the command output', async () => {
    const expired = commandCredential(
      script(`console.log(JSON.stringify({ claudeAiOauth: { accessToken: 'zz-secret', expiresAt: 1 } }));`),
    );
    await expect(expired()).rejects.toThrow(/expired/);
    const broken = commandCredential(script(`console.log('zz-secret not json');`));
    await expect(broken()).rejects.toThrow(/^credential is not JSON$/);
    const failing = commandCredential(script(`console.log('zz-secret'); process.exit(3);`));
    await expect(failing()).rejects.toThrow(/^credential command failed$/);
  });
});
