import assert from 'node:assert/strict';
import { IntentService } from '../../src/application/intent-service.js';
import {
  ServiceError,
  timeoutError,
  type ContainerRunner,
  type RunRegistry,
} from '../../src/domain/ports.js';
import { InMemoryRunRegistry } from '../../src/infrastructure/in-memory.js';
import { Given, Then, When, assertMatches, required, slot, type MemoryWorld } from './helpers.js';

const LIMITS = { timeoutMs: 1000, maxTurns: 4, maxBudgetUsd: 0.1 };
const COST = { input_tokens: 10, output_tokens: 5, usd: 0.001 };

const okWorker = JSON.stringify({
  status: 'ok',
  data: { summary: 'found', memories: [{ id: 'm1', content: 'c', tags: [], score: 1 }] },
  evidence: [{ source: 'memory', ref: 'm1' }],
  cost: COST,
});

function runner(stdout: string | Error, exitCode = 0): ContainerRunner {
  return {
    async run() {
      if (stdout instanceof Error) throw stdout;
      return { exitCode, stdout };
    },
  };
}

type Result = Awaited<ReturnType<IntentService['handle']>>;

class IntentScenario {
  registry = new InMemoryRunRegistry();
  service: IntentService | undefined;
  result: Result | undefined;
  seenRequest: unknown;

  over(r: ContainerRunner): void {
    this.registry = new InMemoryRunRegistry();
    this.service = new IntentService(this.registry, r, LIMITS);
  }
  get lastResult(): Result {
    return required(this.result, 'an intent result');
  }
  runEvents(): string[] {
    return this.registry.get(this.lastResult.run_id ?? '').events.map((e) => e.type);
  }
}

const scenario = (world: MemoryWorld) => slot(world, 'intent-service', () => new IntentScenario());

Given('an intent service over a worker that prints the ok recall output', function () {
  scenario(this).over(runner(okWorker));
});

Given(
  'an intent service over a worker that exits with code {int} and prints {string}',
  function (exitCode: number, stdout: string) {
    scenario(this).over(runner(stdout, exitCode));
  },
);

Given('an intent service over a worker that exceeds its timeout', function () {
  scenario(this).over(runner(timeoutError(5)));
});

Given('an intent service over a worker that cannot start because {string}', function (reason: string) {
  scenario(this).over(runner(new ServiceError('WORKER_UNAVAILABLE', reason)));
});

Given('an intent service over a run registry that is down', function () {
  const s = scenario(this);
  const down: RunRegistry = {
    async create() {
      throw new ServiceError('DATA_UNAVAILABLE', 'data down');
    },
    async appendEvent() {},
    async complete() {},
  };
  s.service = new IntentService(down, runner(okWorker), LIMITS);
});

Given('an intent service over a worker that records its request', function () {
  const s = scenario(this);
  s.over({
    async run(request) {
      s.seenRequest = request;
      return { exitCode: 0, stdout: okWorker };
    },
  });
});

When('the intent service handles {string} with input {string}', async function (tool: string, input: string) {
  const s = scenario(this);
  s.result = await required(s.service, 'an intent service').handle(
    tool as Parameters<IntentService['handle']>[0],
    JSON.parse(input),
  );
});

Then('the intent result matches {string}', function (expected: string) {
  assertMatches(scenario(this).lastResult, JSON.parse(expected));
});

Then('the intent result error code is {string}', function (code: string) {
  assert.equal(scenario(this).lastResult.error?.code, code);
});

Then('the intent result error message contains {string}', function (part: string) {
  const message = scenario(this).lastResult.error?.message;
  assert.ok(message?.includes(part), `message ${message} does not contain ${part}`);
});

Then('the recorded run events are {string}', function (types: string) {
  assert.deepEqual(scenario(this).runEvents(), types.split(', '));
});

Then('the recorded run events include {string}', function (type: string) {
  assert.ok(scenario(this).runEvents().includes(type), `no ${type} event`);
});

Then('the recorded run status is {string}', function (status: string) {
  const s = scenario(this);
  assert.equal(s.registry.get(s.lastResult.run_id ?? '').status, status);
});

Then('the run registry holds {int} runs', function (count: number) {
  assert.equal(scenario(this).registry.runs.size, count);
});

Then('the worker request matches {string}', function (expected: string) {
  assertMatches(scenario(this).seenRequest, JSON.parse(expected));
});
