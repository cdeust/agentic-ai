import assert from 'node:assert/strict';
import type { DataTable } from '@cucumber/cucumber';
import { ResultStatusSchema, TOOLS } from '@architect-os/contracts';
import type { ArchitectWorld } from '../support/world.js';
import { buildStack, scriptedAgent } from '../support/harness.js';
import type { AgentPort } from '../../services/memory/worker/agent-port.js';
import { Given, Then, When, assertMatches, list, stored } from './helpers.js';

type Stack = Awaited<ReturnType<typeof buildStack>>;

interface ToolResult {
  status: string;
  run_id: string;
  data: { summary: string; memories: { content: string }[] } | null;
  cost: { input_tokens: number };
  error: { code: string; message: string };
}

async function openStack(world: ArchitectWorld, agent: AgentPort): Promise<void> {
  const stack = await buildStack(agent);
  world.cleanups.push(() => void stack.close());
  world.state['stack'] = stack;
}

const stack = (world: ArchitectWorld) => stored<Stack>(world, 'stack');
const result = (world: ArchitectWorld) => stored<ToolResult>(world, 'result');
const registry = (world: ArchitectWorld) => stack(world).run(result(world).run_id);

Given('an end-to-end stack whose scripted agent stores and searches memories', async function () {
  const prompts: Record<string, string> = {};
  this.state['prompts'] = prompts;
  await openStack(
    this,
    scriptedAgent(async (request) => {
      prompts[request.tool] = request.systemPrompt;
      if (request.tool === 'remember') {
        const inserted = (await request.tools.call(
          'memory_insert',
          request.input as Record<string, unknown>,
        )) as { id: string };
        return { memory_id: inserted.id };
      }
      const input = request.input as { query: string; limit: number };
      const memories = (await request.tools.call('memory_search', input)) as unknown[];
      return { summary: `${memories.length} memory(ies) match "${input.query}"`, memories };
    }),
  );
});

Given('an end-to-end stack whose scripted agent returns an invalid output', async function () {
  await openStack(
    this,
    scriptedAgent(async () => ({ summary: 123, memories: 'not a list' })),
  );
});

Given('an end-to-end stack whose scripted agent crashes with {string}', async function (message: string) {
  await openStack(
    this,
    scriptedAgent(async () => {
      throw new Error(message);
    }),
  );
});

When('the end-to-end client calls the tool {string} with:', async function (name: string, json: string) {
  const response = await stack(this).client.callTool({ name, arguments: JSON.parse(json) });
  this.state['response'] = response;
  this.state['result'] = response.structuredContent;
});

Then('the end-to-end call is not an error', function () {
  assert.ok(!stored<{ isError?: boolean }>(this, 'response').isError);
});

Then('the end-to-end Result has the status {string}', function (status: string) {
  if (status === 'ok') {
    // The recall output schema of the contracts accepts exactly what a good Result carries.
    this.state['result'] = TOOLS.recall.output.parse(this.state['result']);
    assert.equal(ResultStatusSchema.parse(result(this).status), 'ok');
  } else assert.equal(result(this).status, status);
});

Then('the end-to-end recall summary is:', function (summary: string) {
  assert.equal(result(this).data?.summary, summary);
});

Then('the first memory of the end-to-end recall contains {string}', function (text: string) {
  assert.ok(result(this).data?.memories[0]?.content.includes(text));
});

Then('the end-to-end Result costs {int} input tokens', function (tokens: number) {
  assert.equal(result(this).cost.input_tokens, tokens);
});

Then('the end-to-end Result has no data', function () {
  assert.equal(result(this).data, null);
});

Then('the end-to-end Result has the error code {string} and a message', function (code: string) {
  assert.equal(result(this).error.code, code);
  assert.ok(result(this).error.message.length > 0);
});

Then(
  'the end-to-end Result has the error code {string} and a message containing {string}',
  function (code: string, text: string) {
    assert.equal(result(this).error.code, code);
    assert.ok(result(this).error.message.includes(text), result(this).error.message);
  },
);

Then('the run recorded in the registry matches:', async function (json: string) {
  assertMatches((await registry(this)).run, JSON.parse(json));
});

Then('the run recorded in the registry has the status {string}', async function (status: string) {
  assert.equal((await registry(this)).run.status, status);
});

Then('the events recorded in the registry are {string}', async function (types: string) {
  assert.deepEqual(
    (await registry(this)).events.map((e) => e.type),
    list(types),
  );
});

Then('the events recorded in the registry are numbered {string}', async function (seqs: string) {
  assert.deepEqual(
    (await registry(this)).events.map((e) => e.seq),
    list(seqs).map(Number),
  );
});

Then(
  'the scripted agent received the system prompt of the tool {string} containing {string}',
  function (tool: string, text: string) {
    // The system prompts are the committed prompts/<tool>.md files.
    const prompt = stored<Record<string, string>>(this, 'prompts')[tool];
    assert.ok(prompt?.includes(text), `the prompt of ${tool} does not contain ${text}`);
  },
);

Then('the gateway audit log holds these entries:', function (table: DataTable) {
  assert.deepEqual(
    stack(this).audit.entries.map((e) => [e.tool, e.owner, e.outcome]),
    table.rows(),
  );
});
