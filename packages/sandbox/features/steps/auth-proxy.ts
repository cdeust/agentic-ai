import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataTable } from '@cucumber/cucumber';
import { startAuthProxy, type AuthProxy } from '../../src/auth-proxy.js';
import { Given, Then, When, assertMatches, stored, type SandboxWorld } from './helpers.js';

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

/** Everything one proxy scenario shares; `proxy` is replaced when a step restarts it. */
interface ProxyScenario {
  seen: Seen[];
  proxy: AuthProxy | undefined;
  dir: string;
  token: string;
  response?: { status: number; text: string };
}
const scenario = (world: SandboxWorld) => stored<ProxyScenario>(world, 'proxy');
const running = (s: ProxyScenario): AuthProxy => {
  assert.ok(s.proxy, 'the auth proxy is not started');
  return s.proxy;
};

const ROUTES = ['^/v1/messages(/count_tokens)?(\\?[^#]*)?$'];

Given('a fake upstream answering with a server-sent-events stream that carries a usage', async function () {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'aos-proxy-')));
  const seen: Seen[] = [];
  const upstream: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(SSE);
    });
  });
  await new Promise<void>((done) => upstream.listen(0, '127.0.0.1', done));
  this.state['upstream'] = (upstream.address() as AddressInfo).port;
  this.state['proxy'] = { seen, dir, token: '', proxy: undefined } satisfies ProxyScenario;
  // Run last-in first-out: the proxy (registered later) closes before its upstream, then the folder goes.
  this.cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  this.cleanups.push(() => new Promise<void>((done) => upstream.close(() => done())));
});

Given(
  'an auth proxy over that upstream with the session token {string} and the host credential {string}',
  async function (token: string, credential: string) {
    const s = scenario(this);
    s.token = token;
    s.proxy = await startAuthProxy({
      upstream: `http://127.0.0.1:${stored<number>(this, 'upstream')}`,
      routes: ROUTES,
      betas: ['oauth-2025-04-20'],
      sessionToken: token,
      credential: async () => ({ accessToken: credential }),
      usageLog: join(s.dir, 'usage.jsonl'),
    });
    this.cleanups.push(() => running(s).close());
  },
);

Given(
  'the proxy is restarted with a host credential that fails with {string}',
  async function (detail: string) {
    const s = scenario(this);
    await running(s).close();
    s.proxy = await startAuthProxy({
      upstream: 'http://127.0.0.1:9',
      routes: ['^/v1/messages$'],
      betas: [],
      sessionToken: s.token,
      credential: async () => {
        throw new Error(detail);
      },
    });
  },
);

/** POST (or `init.method`) through the proxy and keep status and whole body. */
async function send(
  world: SandboxWorld,
  path: string,
  init: RequestInit,
  token: string | null,
): Promise<void> {
  const s = scenario(world);
  const headers: Record<string, string> = {};
  if (token !== null)
    Object.assign(headers, { authorization: `Bearer ${token}`, 'content-type': 'application/json' });
  const res = await fetch(`http://127.0.0.1:${running(s).port}${path}`, {
    method: 'POST',
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
  });
  s.response = { status: res.status, text: await res.text() };
}

When('I POST through the proxy {string} with the body {string}', async function (path: string, body: string) {
  await send(this, path, { body }, scenario(this).token);
});

When(
  'I POST through the proxy {string} with the body {string} and the headers:',
  async function (path: string, body: string, table: DataTable) {
    await send(
      this,
      path,
      { body, headers: Object.fromEntries(table.raw() as [string, string][]) },
      scenario(this).token,
    );
  },
);

When(
  'I POST through the proxy {string} with the body {string} and the session token {string}',
  async function (path: string, body: string, token: string) {
    await send(this, path, { body }, token);
  },
);

When(
  'I POST through the proxy {string} with the body {string} and no authorization',
  async function (path: string, body: string) {
    await send(this, path, { body, headers: {} }, null);
  },
);

When('I send {string} to {string} through the proxy', async function (method: string, path: string) {
  await send(this, path, method === 'GET' ? { method } : { method, body: '{}' }, scenario(this).token);
});

When('the session token is revoked', function () {
  running(scenario(this)).revoke();
});

const response = (world: SandboxWorld) => {
  const r = scenario(world).response;
  assert.ok(r, 'no request was sent');
  return r;
};

Then('the proxy response status is {int}', function (status: number) {
  assert.equal(response(this).status, status);
});

Then('the proxy response body is the upstream stream', function () {
  assert.equal(response(this).text, SSE);
});

Then('the proxy response body does not contain {string}', function (text: string) {
  assert.ok(!response(this).text.includes(text));
});

Then('the upstream received {int} request(s)', function (count: number) {
  assert.equal(scenario(this).seen.length, count);
});

Then('the upstream received no request', function () {
  assert.deepEqual(scenario(this).seen, []);
});

Then('the upstream request {int} has the url {string}', function (i: number, url: string) {
  assert.equal(scenario(this).seen[i]?.url, url);
});

Then('the upstream request {int} has the body {string}', function (i: number, body: string) {
  assert.equal(scenario(this).seen[i]?.body, body);
});

Then(
  'the upstream request {int} has the header {string} {string}',
  function (i: number, name: string, value: string) {
    assert.equal(scenario(this).seen[i]?.headers?.[name], value);
  },
);

Then('the upstream request {int} has no header {string}', function (i: number, name: string) {
  assert.equal(scenario(this).seen[i]?.headers?.[name], undefined);
});

const usageLog = (world: SandboxWorld) => readFileSync(join(scenario(world).dir, 'usage.jsonl'), 'utf8');

Then('the usage log holds one record matching:', function (json: string) {
  const record = JSON.parse(usageLog(this).trim()) as Record<string, unknown>;
  assertMatches(record, JSON.parse(json));
  this.state['usageRecord'] = record;
});

Then('the usage record has a string {string}', function (key: string) {
  assert.equal(typeof stored<Record<string, unknown>>(this, 'usageRecord')[key], 'string');
});

Then('the usage log does not contain {string}', function (text: string) {
  assert.ok(!usageLog(this).includes(text));
});
