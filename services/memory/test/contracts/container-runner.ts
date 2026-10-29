import { describe, expect, it } from 'vitest';
import type { ContainerRunner } from '../../src/domain/ports.js';

export interface RunnerHarness {
  /** A runner whose worker prints `stdout` and exits with `exitCode`. */
  responding(stdout: string, exitCode: number): ContainerRunner;
  /** A runner whose worker never finishes. */
  hanging(): ContainerRunner;
}

const REQUEST = {
  input: {
    run_id: 'r1',
    tool: 'recall',
    input: { query: 'q' },
    limits: { max_turns: 1, max_budget_usd: 0.1 },
  },
  timeoutMs: 50,
};

/** Behavioural contract every ContainerRunner adapter must satisfy. */
export function containerRunnerContract(name: string, harness: RunnerHarness): void {
  describe(`ContainerRunner contract: ${name}`, () => {
    it('returns the worker stdout and exit code', async () => {
      expect(await harness.responding('{"a":1}', 0).run(REQUEST)).toEqual({ exitCode: 0, stdout: '{"a":1}' });
    });

    it('reports a non-zero exit code without throwing', async () => {
      expect((await harness.responding('', 3).run(REQUEST)).exitCode).toBe(3);
    });

    it('rejects with WORKER_TIMEOUT when the worker exceeds the timeout', async () => {
      await expect(harness.hanging().run(REQUEST)).rejects.toMatchObject({ code: 'WORKER_TIMEOUT' });
    });
  });
}
