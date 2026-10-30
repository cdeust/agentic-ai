import assert from 'node:assert/strict';
import { timeoutError, type ContainerRunner } from '../../src/domain/ports.js';
import { DockerContainerRunner, type Exec } from '../../src/infrastructure/docker-runner.js';
import { InProcessContainerRunner } from '../../src/infrastructure/in-process-runner.js';
import {
  Given,
  Then,
  When,
  assertMatches,
  attempt,
  refusedWith,
  required,
  slot,
  type Attempt,
  type MemoryWorld,
} from './helpers.js';

const CONFIG = {
  image: 'worker:test',
  network: 'exec',
  memory: '256m',
  pidsLimit: 64,
  env: { INTERNAL_TOOLS_URL: 'http://memory:8083' },
};

const LIMITS = { max_turns: 1, max_budget_usd: 0.1 };

class RunnerScenario {
  runner: ContainerRunner | undefined;
  outcome: Attempt | undefined;
  args: string[] = [];
  calls: string[][] = [];
  stdin = '';
}

const scenario = (world: MemoryWorld) => slot(world, 'runners', () => new RunnerScenario());

// --- the ContainerRunner contract: one adapter per Examples row ---

Given(
  'the {string} container runner whose worker prints {string} and exits with {int}',
  function (adapter: string, stdout: string, exitCode: number) {
    const s = scenario(this);
    if (adapter === 'in-process') {
      s.runner = new InProcessContainerRunner(async () => ({ stdout, exitCode }));
    } else if (adapter === 'docker (fake exec)') {
      s.runner = new DockerContainerRunner(CONFIG, async () => ({ stdout, exitCode, stderr: '' }));
    } else {
      assert.fail(`unknown ContainerRunner adapter: ${adapter}`);
    }
  },
);

Given('the {string} container runner whose worker never finishes', function (adapter: string) {
  const s = scenario(this);
  if (adapter === 'in-process') {
    s.runner = new InProcessContainerRunner(() => new Promise(() => undefined));
  } else if (adapter === 'docker (fake exec)') {
    s.runner = new DockerContainerRunner(CONFIG, async (_c, _a, _s, timeoutMs) => {
      throw timeoutError(timeoutMs);
    });
  } else {
    assert.fail(`unknown ContainerRunner adapter: ${adapter}`);
  }
});

When(
  'the container runner runs a recall request with a timeout of {int} ms',
  async function (timeoutMs: number) {
    const s = scenario(this);
    const runner = required(s.runner, 'a container runner');
    s.outcome = await attempt(() =>
      runner.run({
        input: { run_id: 'r1', tool: 'recall', input: { query: 'q' }, limits: LIMITS },
        timeoutMs,
      }),
    );
  },
);

Then(
  'the container runner returned exit code {int} and stdout {string}',
  function (exitCode: number, stdout: string) {
    const { outcome } = scenario(this);
    assert.ok(outcome && !outcome.failed, 'the runner must have returned');
    assert.deepEqual(outcome.value, { exitCode, stdout });
  },
);

Then('the container runner exit code is {int}', function (exitCode: number) {
  const { outcome } = scenario(this);
  assert.ok(outcome && !outcome.failed, 'the runner must have returned');
  assert.equal((outcome.value as { exitCode: number }).exitCode, exitCode);
});

Then('the container runner is rejected with code {string}', function (code: string) {
  refusedWith(scenario(this).outcome, code);
});

// --- DockerContainerRunner isolation flags ---

Given('the docker runner arguments of the test configuration', function () {
  scenario(this).args = new DockerContainerRunner(CONFIG).args();
});

Then('the docker arguments include {string}', function (flag: string) {
  assert.ok(scenario(this).args.includes(flag), `${flag} is not in the docker arguments`);
});

Then('the docker argument after {string} is {string}', function (flag: string, value: string) {
  const { args } = scenario(this);
  assert.equal(args[args.indexOf(flag) + 1], value);
});

Then('the last docker argument is {string}', function (value: string) {
  assert.equal(scenario(this).args.at(-1), value);
});

Then('the forwarded docker environment is {string}', function (expected: string) {
  const { args } = scenario(this);
  assert.deepEqual(
    args.filter((_, i) => args[i - 1] === '--env'),
    JSON.parse(expected),
  );
});

// --- DockerContainerRunner execution ---

Given('a docker runner whose exec records its calls and times out on run', function () {
  const s = scenario(this);
  const exec: Exec = async (_c, args) => {
    s.calls.push(args);
    if (args[0] === 'run') throw timeoutError(5);
    return { exitCode: 0, stdout: '', stderr: '' };
  };
  s.runner = new DockerContainerRunner(CONFIG, exec);
});

Given('a docker runner whose exec records its stdin and succeeds', function () {
  const s = scenario(this);
  const exec: Exec = async (_c, _a, input) => {
    s.stdin = input;
    return { exitCode: 0, stdout: '{}', stderr: '' };
  };
  s.runner = new DockerContainerRunner(CONFIG, exec);
});

Given('a docker runner whose exec fails with {string}', function (message: string) {
  scenario(this).runner = new DockerContainerRunner(CONFIG, async () => {
    throw new Error(message);
  });
});

When(
  'the docker runner runs a request for run {string} with a timeout of {int} ms',
  async function (runId: string, timeoutMs: number) {
    const s = scenario(this);
    const runner = required(s.runner, 'a docker runner');
    s.outcome = await attempt(() =>
      runner.run({ input: { run_id: runId, tool: 't', input: 1, limits: LIMITS }, timeoutMs }),
    );
  },
);

Then('the docker runner is rejected with code {string}', function (code: string) {
  refusedWith(scenario(this).outcome, code);
});

Then(
  'docker call number {int} includes {string} and {string}',
  function (n: number, first: string, second: string) {
    const call = scenario(this).calls[n - 1];
    assert.ok(call?.includes(first) && call.includes(second), `call ${n} lacks ${first} ${second}: ${call}`);
  },
);

Then('docker call number {int} is {string}', function (n: number, expected: string) {
  assert.deepEqual(scenario(this).calls[n - 1], JSON.parse(expected));
});

Then('the docker worker stdin matches {string}', function (expected: string) {
  assertMatches(JSON.parse(scenario(this).stdin), JSON.parse(expected));
});
