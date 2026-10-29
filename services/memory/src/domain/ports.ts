import type { MemoryItem, RunEventType, RunStatus, WorkerInput } from '@agentic-ai/contracts';

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

/** The service's view of memory storage kept by the data component. */
export interface MemoryStore {
  insert(content: string, tags: string[]): Promise<{ id: string }>;
  search(query: string, limit: number): Promise<MemoryItem[]>;
}

export class WorkerTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`worker exceeded ${timeoutMs} ms`);
    this.name = 'WorkerTimeoutError';
  }
}

export class WorkerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkerUnavailableError';
  }
}

export class DataUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataUnavailableError';
  }
}
