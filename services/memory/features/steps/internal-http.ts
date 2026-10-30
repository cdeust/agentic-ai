import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { InternalToolService } from '../../src/application/internal-tools.js';
import { InMemoryDataPort } from '../../src/infrastructure/in-memory.js';
import { createInternalToolsHost } from '../../src/presentation/internal-http.js';
import { HttpInternalTools } from '../../worker/internal-tools.js';
import { Given, Then, When, assertMatches, required, slot, type MemoryWorld } from './helpers.js';

class HostScenario {
  base = '';
  tools: HttpInternalTools | undefined;
  insertedId: string | undefined;
  found: unknown;
  status: number | undefined;
}

const scenario = (world: MemoryWorld) => slot(world, 'internal-http', () => new HostScenario());

Given('an internal tools host on a free local port', async function () {
  const server = createInternalToolsHost(new InternalToolService(new InMemoryDataPort(), 'memory'));
  this.cleanups.push(() => void server.close());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const s = scenario(this);
  s.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  s.tools = new HttpInternalTools(s.base);
});

When(
  'the worker HttpInternalTools adapter calls {string} with {string}',
  async function (tool: string, input: string) {
    const s = scenario(this);
    const answer = await required(s.tools, 'an internal tools host').call(
      tool as Parameters<HttpInternalTools['call']>[0],
      JSON.parse(input),
    );
    if (tool === 'memory_insert') s.insertedId = (answer as { id: string }).id;
    else s.found = answer;
  },
);

Then('the worker search answer lists the inserted memory', function () {
  const s = scenario(this);
  assertMatches(s.found, [{ id: required(s.insertedId, 'an inserted memory') }]);
});

When(
  'the body {string} is posted to the internal path {string}',
  async function (body: string, path: string) {
    const s = scenario(this);
    s.status = (await fetch(`${s.base}${path}`, { method: 'POST', body })).status;
  },
);

Then('the internal tools host answers with status {int}', function (status: number) {
  assert.equal(scenario(this).status, status);
});
