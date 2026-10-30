import {
  TOOLS,
  WorkerOutputSchema,
  ZERO_COST,
  ErrorCodeSchema,
  type Cost,
  type ErrorCode,
  type Evidence,
  type Result,
  type ToolName,
  type WorkerOutput,
} from '@architect-os/contracts';
import { ServiceError, type ContainerRunner, type RunRegistry, type WorkerLimits } from '../domain/ports.js';

function failure(
  code: ErrorCode,
  message: string,
  runId: string | null,
  cost: Cost = ZERO_COST,
  evidence: Evidence[] = [],
): Result<never> {
  return { status: 'failed', data: null, evidence, run_id: runId, cost, error: { code, message } };
}

function parseWorkerStdout(
  stdout: string,
): { ok: true; value: WorkerOutput } | { ok: false; message: string } {
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    return { ok: false, message: 'worker stdout is not JSON' };
  }
  const parsed = WorkerOutputSchema.safeParse(json);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, message: parsed.error.message };
}

/**
 * Handles an intent tool: validate the input, create the run, launch the worker,
 * validate the worker output against the tool contract, record, answer with a Result.
 * Never throws: every failure becomes a Result with a named cause.
 */
export class IntentService {
  constructor(
    private readonly registry: RunRegistry,
    private readonly runner: ContainerRunner,
    private readonly limits: WorkerLimits,
  ) {}

  async handle(tool: ToolName, rawInput: unknown): Promise<Result<unknown>> {
    const contract = TOOLS[tool];
    const input = contract.input.safeParse(rawInput);
    if (!input.success) return failure('INVALID_INPUT', input.error.message, null);

    let runId: string;
    try {
      runId = (await this.registry.create(tool, input.data)).id;
      await this.registry.appendEvent(runId, 'run.created', { tool });
    } catch (error) {
      return failure('DATA_UNAVAILABLE', describe(error), null);
    }

    try {
      return await this.execute(tool, runId, input.data);
    } catch (error) {
      return failure(error instanceof ServiceError ? error.code : 'INTERNAL', describe(error), runId);
    }
  }

  private async execute(tool: ToolName, runId: string, input: unknown): Promise<Result<unknown>> {
    await this.registry.appendEvent(runId, 'worker.started', {});
    let stdout: string;
    try {
      const run = await this.runner.run({
        input: {
          run_id: runId,
          tool,
          input,
          limits: { max_turns: this.limits.maxTurns, max_budget_usd: this.limits.maxBudgetUsd },
        },
        timeoutMs: this.limits.timeoutMs,
      });
      await this.registry.appendEvent(runId, 'worker.exited', { exit_code: run.exitCode });
      if (run.exitCode !== 0) {
        return this.finish(runId, failure('WORKER_FAILED', `worker exited with code ${run.exitCode}`, runId));
      }
      stdout = run.stdout;
    } catch (error) {
      if (!(error instanceof ServiceError) || error.code === 'DATA_UNAVAILABLE') throw error;
      await this.registry.appendEvent(runId, 'worker.exited', { error: error.code });
      return this.finish(runId, failure(error.code, error.message, runId));
    }

    const envelope = parseWorkerStdout(stdout);
    if (!envelope.ok) return this.invalid(runId, envelope.message);
    const output = envelope.value;

    if (output.status === 'failed' || output.status === 'needs_clarification') {
      const code = ErrorCodeSchema.safeParse(output.error?.code);
      const named: ErrorCode = code.success
        ? code.data
        : output.status === 'needs_clarification'
          ? 'NEEDS_CLARIFICATION'
          : 'WORKER_FAILED';
      const result: Result<never> = {
        status: output.status,
        data: null,
        evidence: output.evidence,
        run_id: runId,
        cost: output.cost,
        error: { code: named, message: output.error?.message ?? 'worker reported no message' },
      };
      return this.finish(runId, result);
    }

    const data = TOOLS[tool].data.safeParse(output.data);
    if (!data.success) return this.invalid(runId, data.error.message, output.cost);
    await this.registry.appendEvent(runId, 'output.validated', {});
    return this.finish(runId, {
      status: 'ok',
      data: data.data,
      evidence: output.evidence,
      run_id: runId,
      cost: output.cost,
    });
  }

  private async invalid(runId: string, detail: string, cost: Cost = ZERO_COST): Promise<Result<never>> {
    await this.registry.appendEvent(runId, 'output.invalid', { detail });
    return this.finish(runId, failure('WORKER_OUTPUT_INVALID', detail, runId, cost));
  }

  private async finish<T extends Result<unknown>>(runId: string, result: T): Promise<T> {
    await this.registry.complete(runId, result.status, result);
    await this.registry.appendEvent(runId, 'run.completed', { status: result.status });
    return result;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
