import { describe, expect, it } from 'vitest';
import { IntentService } from '../../src/application/intent-service.js';
import {
  ServiceError,
  timeoutError,
  type ContainerRunner,
  type RunRegistry,
} from '../../src/domain/ports.js';
import { InMemoryRunRegistry } from '../../src/infrastructure/in-memory.js';

const LIMITS = { timeoutMs: 1000, maxTurns: 4, maxBudgetUsd: 0.1 };
const COST = { input_tokens: 10, output_tokens: 5, usd: 0.001 };

function runner(stdout: string | Error, exitCode = 0): ContainerRunner {
  return {
    async run() {
      if (stdout instanceof Error) throw stdout;
      return { exitCode, stdout };
    },
  };
}

const okWorker = JSON.stringify({
  status: 'ok',
  data: { summary: 'found', memories: [{ id: 'm1', content: 'c', tags: [], score: 1 }] },
  evidence: [{ source: 'memory', ref: 'm1' }],
  cost: COST,
});

function setup(r: ContainerRunner) {
  const registry = new InMemoryRunRegistry();
  return { registry, service: new IntentService(registry, r, LIMITS) };
}

const eventTypes = (registry: InMemoryRunRegistry, id: string | null) =>
  registry.get(id ?? '').events.map((e) => e.type);

describe('IntentService', () => {
  it('returns an ok Result with validated data, evidence and cost, and records the run', async () => {
    const { registry, service } = setup(runner(okWorker));
    const result = await service.handle('recall', { query: 'q' });
    expect(result).toMatchObject({ status: 'ok', cost: COST, evidence: [{ ref: 'm1' }] });
    expect(eventTypes(registry, result.run_id)).toEqual([
      'run.created',
      'worker.started',
      'worker.exited',
      'output.validated',
      'run.completed',
    ]);
    expect(registry.get(result.run_id ?? '').status).toBe('ok');
  });

  it('rejects an invalid input without creating a run', async () => {
    const { registry, service } = setup(runner(okWorker));
    const result = await service.handle('recall', { query: '' });
    expect(result).toMatchObject({ status: 'failed', run_id: null, error: { code: 'INVALID_INPUT' } });
    expect(registry.runs.size).toBe(0);
  });

  it('fails with WORKER_OUTPUT_INVALID when the worker data violates the tool schema', async () => {
    const bad = JSON.stringify({ status: 'ok', data: { summary: 42 }, evidence: [], cost: COST });
    const { registry, service } = setup(runner(bad));
    const result = await service.handle('recall', { query: 'q' });
    expect(result).toMatchObject({
      status: 'failed',
      data: null,
      error: { code: 'WORKER_OUTPUT_INVALID' },
      cost: COST,
    });
    expect(eventTypes(registry, result.run_id)).toContain('output.invalid');
    expect(registry.get(result.run_id ?? '').status).toBe('failed');
  });

  it.each([
    ['not JSON', 'oops'],
    ['wrong envelope', JSON.stringify({ hello: 'world' })],
  ])('fails with WORKER_OUTPUT_INVALID when stdout is %s', async (_name, stdout) => {
    const result = await setup(runner(stdout)).service.handle('recall', { query: 'q' });
    expect(result.error?.code).toBe('WORKER_OUTPUT_INVALID');
  });
});

describe('IntentService worker failures', () => {
  it('names a non-zero exit as WORKER_FAILED', async () => {
    const result = await setup(runner('', 137)).service.handle('recall', { query: 'q' });
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'WORKER_FAILED', message: expect.stringContaining('137') },
    });
  });

  it('names a timeout as WORKER_TIMEOUT and an unstartable worker as WORKER_UNAVAILABLE', async () => {
    expect((await setup(runner(timeoutError(5))).service.handle('recall', { query: 'q' })).error?.code).toBe(
      'WORKER_TIMEOUT',
    );
    expect(
      (
        await setup(runner(new ServiceError('WORKER_UNAVAILABLE', 'no docker'))).service.handle('recall', {
          query: 'q',
        })
      ).error?.code,
    ).toBe('WORKER_UNAVAILABLE');
  });

  it('passes through a worker-reported failure and a clarification request', async () => {
    const failed = JSON.stringify({
      status: 'failed',
      data: null,
      evidence: [],
      cost: COST,
      error: { code: 'WORKER_FAILED', message: 'agent stopped' },
    });
    expect(await setup(runner(failed)).service.handle('recall', { query: 'q' })).toMatchObject({
      status: 'failed',
      error: { message: 'agent stopped' },
    });
    const ask = JSON.stringify({
      status: 'needs_clarification',
      data: null,
      evidence: [],
      cost: COST,
      error: { code: 'NEEDS_CLARIFICATION', message: 'which project?' },
    });
    expect(await setup(runner(ask)).service.handle('recall', { query: 'q' })).toMatchObject({
      status: 'needs_clarification',
      error: { message: 'which project?' },
    });
  });
});

describe('IntentService data outage and limits', () => {
  it('answers DATA_UNAVAILABLE when the registry is down', async () => {
    const down: RunRegistry = {
      async create() {
        throw new ServiceError('DATA_UNAVAILABLE', 'data down');
      },
      async appendEvent() {},
      async complete() {},
    };
    const result = await new IntentService(down, runner(okWorker), LIMITS).handle('recall', { query: 'q' });
    expect(result).toMatchObject({ status: 'failed', run_id: null, error: { code: 'DATA_UNAVAILABLE' } });
  });

  it('passes the limits to the worker', async () => {
    let seen: unknown;
    const spy: ContainerRunner = {
      async run(request) {
        seen = request;
        return { exitCode: 0, stdout: okWorker };
      },
    };
    await setup(spy).service.handle('recall', { query: 'q' });
    expect(seen).toMatchObject({
      timeoutMs: 1000,
      input: { tool: 'recall', limits: { max_turns: 4, max_budget_usd: 0.1 } },
    });
  });
});
