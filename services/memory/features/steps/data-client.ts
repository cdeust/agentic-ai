import assert from 'node:assert/strict';
import { HttpDataClient, type Fetch } from '../../src/infrastructure/data-client.js';
import {
  Given,
  Then,
  When,
  attempt,
  refusedWith,
  required,
  slot,
  type Attempt,
  type MemoryWorld,
} from './helpers.js';

class DataClientScenario {
  client: HttpDataClient | undefined;
  readonly seen: { url: string; body: unknown }[] = [];
  outcome: Attempt | undefined;
}

const scenario = (world: MemoryWorld) => slot(world, 'data-client', () => new DataClientScenario());

Given(
  'an HttpDataClient for {string} whose fetch answers {int} with {string}',
  function (baseUrl: string, status: number, body: string) {
    const s = scenario(this);
    const fetch: Fetch = async (url, init) => {
      s.seen.push({ url, body: JSON.parse(init.body) });
      return { ok: status < 400, status, text: async () => body };
    };
    s.client = new HttpDataClient(baseUrl, fetch);
  },
);

Given(
  'an HttpDataClient for {string} whose fetch fails with {string}',
  function (baseUrl: string, message: string) {
    scenario(this).client = new HttpDataClient(baseUrl, async () => {
      throw new Error(message);
    });
  },
);

const client = (s: DataClientScenario) => required(s.client, 'an HttpDataClient');

When(
  'the data client creates a run for tool {string} with input {string}',
  async function (tool: string, input: string) {
    const s = scenario(this);
    s.outcome = await attempt(() => client(s).create(tool, JSON.parse(input)));
  },
);

When(
  'the data client appends the event {string} with payload {string} to run {string}',
  async function (type: string, payload: string, runId: string) {
    const s = scenario(this);
    s.outcome = await attempt(() =>
      client(s).appendEvent(runId, type as Parameters<HttpDataClient['appendEvent']>[1], JSON.parse(payload)),
    );
  },
);

When(
  'the data client calls the operation {string} with {string}',
  async function (op: string, input: string) {
    const s = scenario(this);
    s.outcome = await attempt(() =>
      client(s).call(op as Parameters<HttpDataClient['call']>[0], JSON.parse(input)),
    );
  },
);

Then('the data client answer is {string}', function (expected: string) {
  const { outcome } = scenario(this);
  assert.ok(outcome && !outcome.failed, 'the data client call must have succeeded');
  assert.deepEqual(outcome.value, JSON.parse(expected));
});

Then('the first data client request is {string}', function (expected: string) {
  assert.deepEqual(scenario(this).seen[0], JSON.parse(expected));
});

Then('the data client call is rejected with code {string}', function (code: string) {
  refusedWith(scenario(this).outcome, code);
});
