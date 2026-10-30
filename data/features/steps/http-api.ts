import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { DATA_OP_NAMES } from '@architect-os/contracts';
import { composeInMemory } from '../../src/main.js';
import { Given, Then, When, assertMatches, scenario, text } from './helpers.js';

Given('the data HTTP API over an in-memory store', async function () {
  const server = composeInMemory().createServer();
  this.cleanups.push(() => {
    server.closeAllConnections();
    server.close();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  scenario(this).baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

When('I GET {string}', async function (path: string) {
  const data = scenario(this);
  const response = await fetch(`${data.baseUrl}${path}`);
  data.response = { status: response.status, text: await response.text() };
});

When('I POST {string} to {string}', async function (body: string, path: string) {
  const data = scenario(this);
  const response = await fetch(`${data.baseUrl}${path}`, { method: 'POST', body: text(data, body) });
  data.response = { status: response.status, text: await response.text() };
});

When('I keep the response id as {string}', function (name: string) {
  const data = scenario(this);
  data.vars[name] = (JSON.parse(data.lastResponse.text) as { id: string }).id;
});

Then('the response status is {int}', function (status: number) {
  assert.equal(scenario(this).lastResponse.status, status);
});

Then('the response body matches {string}', function (expected: string) {
  assertMatches(JSON.parse(scenario(this).lastResponse.text), JSON.parse(expected));
});

Then(
  'POSTing {string} to every typed operation never answers {int}',
  async function (body: string, status: number) {
    const data = scenario(this);
    for (const op of DATA_OP_NAMES) {
      const response = await fetch(`${data.baseUrl}/v1/ops/${op}`, { method: 'POST', body });
      assert.notEqual(response.status, status, op);
    }
  },
);
