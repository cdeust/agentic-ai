import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AgentPort, AgentRequest, InternalTools } from '../../worker/agent-port.js';
import { loadPrompts, PROMPTS_DIR } from '../../worker/prompts.js';
import { runWorker } from '../../worker/run-worker.js';
import {
  Given,
  Then,
  When,
  assertMatches,
  attempt,
  required,
  slot,
  type Attempt,
  type MemoryWorld,
} from './helpers.js';

const COST = { input_tokens: 3, output_tokens: 2, usd: 0.0002 };
const PROMPTS = { recall: 'recall prompt', remember: 'remember prompt' };

/** Scripted agent: no network, no Anthropic call. */
class ScriptedAgent implements AgentPort {
  readonly requests: AgentRequest[] = [];
  constructor(private readonly script: (request: AgentRequest) => Promise<unknown>) {}
  async run(request: AgentRequest) {
    this.requests.push(request);
    return {
      structured: await this.script(request),
      evidence: [{ source: 'memory', ref: 'm1' }],
      cost: COST,
    };
  }
}

const tools: InternalTools = {
  call: async (tool) =>
    tool === 'memory_search' ? [{ id: 'm1', content: 'alpha fact', tags: [], score: 1 }] : { id: 'm2' },
};

const input = (tool: string, body: unknown) =>
  JSON.stringify({ run_id: 'r1', tool, input: body, limits: { max_turns: 3, max_budget_usd: 0.2 } });

class WorkerScenario {
  agent: ScriptedAgent | undefined;
  result: Awaited<ReturnType<typeof runWorker>> | undefined;
  loadedPrompts: Record<string, string> | undefined;
  promptsDir: URL | undefined;
  loading: Attempt | undefined;
}

const scenario = (world: MemoryWorld) => slot(world, 'run-worker', () => new WorkerScenario());
const agentOf = (s: WorkerScenario) => required(s.agent, 'a scripted agent');
const resultOf = (s: WorkerScenario) => required(s.result, 'a worker result');

Given(
  'a scripted agent that searches the memory for {string} and answers the summary {string} with the memories found',
  function (query: string, summary: string) {
    scenario(this).agent = new ScriptedAgent(async (request) => {
      const found = await request.tools.call('memory_search', { query, limit: 5 });
      return { summary, memories: found };
    });
  },
);

Given('a scripted agent that throws {string}', function (message: string) {
  scenario(this).agent = new ScriptedAgent(async () => {
    throw new Error(message);
  });
});

Given('a scripted agent that answers an empty object', function () {
  scenario(this).agent = new ScriptedAgent(async () => ({}));
});

When('the worker runs the tool {string} with input {string}', async function (tool: string, body: string) {
  const s = scenario(this);
  s.result = await runWorker(input(tool, JSON.parse(body)), { agent: agentOf(s), tools, prompts: PROMPTS });
});

When(
  'the worker runs with stdin {string} and prompts {string}',
  async function (stdin: string, prompts: string) {
    const s = scenario(this);
    s.result = await runWorker(stdin, {
      agent: agentOf(s),
      tools,
      prompts: JSON.parse(prompts) as Record<string, string>,
    });
  },
);

Then('the worker exit code is {int}', function (exitCode: number) {
  assert.equal(resultOf(scenario(this)).exitCode, exitCode);
});

Then('the worker stdout matches {string}', function (expected: string) {
  assertMatches(JSON.parse(resultOf(scenario(this)).stdout), JSON.parse(expected));
});

Then('the worker stdout error message contains {string}', function (part: string) {
  const message = (JSON.parse(resultOf(scenario(this)).stdout) as { error?: { message?: string } }).error
    ?.message;
  assert.ok(message?.includes(part), `message ${message} does not contain ${part}`);
});

Then('the first agent request matches {string}', function (expected: string) {
  assertMatches(agentOf(scenario(this)).requests[0], JSON.parse(expected));
});

Then('the scripted agent was never run', function () {
  assert.equal(agentOf(scenario(this)).requests.length, 0);
});

// --- worker prompts (prompts/<tool>.md): the committed files, and broken copies of them ---

When('the committed worker prompts are loaded', async function () {
  scenario(this).loadedPrompts = await loadPrompts(PROMPTS_DIR);
});

Then('the worker prompt names are {string}', function (names: string) {
  const prompts = required(scenario(this).loadedPrompts, 'loaded prompts');
  assert.deepEqual(Object.keys(prompts).sort(), names.split(', '));
});

Then('the worker prompt {string} contains {string}', function (name: string, part: string) {
  const prompt = required(scenario(this).loadedPrompts, 'loaded prompts')[name];
  assert.ok(prompt?.includes(part), `prompt ${name} does not contain ${part}`);
});

Given('a worker prompts directory with the files {string}', function (files: string) {
  const dir = mkdtempSync(join(tmpdir(), 'prompts-'));
  this.cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(JSON.parse(files) as Record<string, string>)) {
    writeFileSync(join(dir, name), text);
  }
  scenario(this).promptsDir = pathToFileURL(`${dir}/`);
});

Then('loading the worker prompts is rejected', async function () {
  const s = scenario(this);
  const dir = required(s.promptsDir, 'a prompts directory');
  s.loading = await attempt(() => loadPrompts(dir));
  assert.ok(s.loading.failed, 'loading must have been rejected');
});

Then(
  'loading the worker prompts is rejected with a message containing {string}',
  async function (part: string) {
    const s = scenario(this);
    const dir = required(s.promptsDir, 'a prompts directory');
    s.loading = await attempt(() => loadPrompts(dir));
    assert.ok(s.loading.failed, 'loading must have been rejected');
    assert.ok((s.loading.error as Error).message.includes(part), `message does not contain ${part}`);
  },
);
