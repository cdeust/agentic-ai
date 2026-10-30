import assert from 'node:assert/strict';
import { InternalToolService } from '../../src/application/internal-tools.js';
import { InMemoryDataPort } from '../../src/infrastructure/in-memory.js';
import { Given, Then, When, assertMatches, required, slot, type MemoryWorld } from './helpers.js';

class InternalToolsScenario {
  service: InternalToolService | undefined;
  answer: Awaited<ReturnType<InternalToolService['call']>> | undefined;
}

const scenario = (world: MemoryWorld) => slot(world, 'internal-tools', () => new InternalToolsScenario());

Given('an internal tool service for owner {string} over an in-memory data port', function (owner: string) {
  scenario(this).service = new InternalToolService(new InMemoryDataPort(), owner);
});

When('the internal tool {string} is called with {string}', async function (tool: string, input: string) {
  const s = scenario(this);
  s.answer = await required(s.service, 'an internal tool service').call(tool, JSON.parse(input));
});

Then('the internal tool answer matches {string}', function (expected: string) {
  assertMatches(required(scenario(this).answer, 'an internal tool answer'), JSON.parse(expected));
});

Then('the value of the internal tool answer has a string field {string}', function (field: string) {
  const answer = required(scenario(this).answer, 'an internal tool answer');
  assert.ok('value' in answer, 'the answer has no value');
  assert.equal(typeof (answer.value as Record<string, unknown>)[field], 'string');
});
