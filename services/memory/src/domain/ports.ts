import type { DataOpName, ErrorCode, RunEventType, RunStatus, WorkerInput } from '@architect-os/contracts';

export interface WorkerLimits {
  timeoutMs: number;
  maxTurns: number;
  maxBudgetUsd: number;
}

export interface WorkerRunRequest {
  input: WorkerInput;
  timeoutMs: number;
}

export interface WorkerRunResult {
  exitCode: number;
  stdout: string;
}

/** Runs the worker for one execution and returns what it printed. Isolation is the adapter's job. */
export interface ContainerRunner {
  run(request: WorkerRunRequest): Promise<WorkerRunResult>;
}

/** The service's view of the run registry kept by the data component. */
export interface RunRegistry {
  create(tool: string, input: unknown): Promise<{ id: string }>;
  appendEvent(runId: string, type: RunEventType, payload: Record<string, unknown>): Promise<void>;
  complete(runId: string, status: Exclude<RunStatus, 'running'>, result: unknown): Promise<void>;
}

/** The service's access to the typed data operations its internal tools are views of. */
export interface DataPort {
  call(op: DataOpName, input: unknown): Promise<unknown>;
}

/** A failure an adapter reports with the Result error code it stands for (worker timeout, data down, ...). */
export class ServiceError extends Error {
  constructor(
    readonly code: Extract<ErrorCode, 'WORKER_TIMEOUT' | 'WORKER_UNAVAILABLE' | 'DATA_UNAVAILABLE'>,
    message: string,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export const timeoutError = (timeoutMs: number) =>
  new ServiceError('WORKER_TIMEOUT', `worker exceeded ${timeoutMs} ms`);
