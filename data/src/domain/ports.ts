import type { MemoryItem, Run, RunEvent, RunEventType, RunStatus } from '@agentic-ai/contracts';

/** Dimension of the pgvector column declared in migrations/0002_memory.sql. */
export const EMBEDDING_DIMENSION = 384;

export interface Clock {
  now(): string;
}

export interface IdGenerator {
  next(): string;
}

export interface NewRun {
  service: string;
  tool: string;
  input: unknown;
}

/** Registry of executions. Typed operations only; no free-form query. */
export interface RunRepository {
  create(run: NewRun): Promise<Run>;
  appendEvent(runId: string, type: RunEventType, payload: Record<string, unknown>): Promise<RunEvent>;
  complete(runId: string, status: Exclude<RunStatus, 'running'>, result: unknown): Promise<Run>;
  get(runId: string): Promise<Run>;
  events(runId: string): Promise<RunEvent[]>;
}

export interface NewMemory {
  content: string;
  tags: string[];
  embedding?: number[] | undefined;
}

export interface MemorySearch {
  query: string;
  embedding?: number[] | undefined;
  limit: number;
}

export interface MemoryRepository {
  insert(memory: NewMemory): Promise<{ id: string }>;
  search(search: MemorySearch): Promise<MemoryItem[]>;
}
