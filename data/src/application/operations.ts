import {
  DATA_OPS,
  MemoryInsertInputSchema,
  MemorySearchInputSchema,
  RunsAppendEventInputSchema,
  RunsCompleteInputSchema,
  RunsCreateInputSchema,
  RunsEventsInputSchema,
  RunsGetInputSchema,
  type DataOpName,
} from '@agentic-ai/contracts';
import { InvalidInputError } from '../domain/errors.js';
import { EMBEDDING_DIMENSION, type MemoryRepository, type RunRepository } from '../domain/ports.js';

interface Parser<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: { message: string } };
}

function parse<T>(schema: Parser<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new InvalidInputError(parsed.error.message);
  return parsed.data;
}

/** The complete surface of the data component. Every operation is typed by a contract schema. */
export class DataOperations {
  constructor(
    private readonly runs: RunRepository,
    private readonly memory: MemoryRepository,
  ) {}

  has(op: string): op is DataOpName {
    return Object.hasOwn(DATA_OPS, op);
  }

  async execute(op: DataOpName, raw: unknown): Promise<unknown> {
    switch (op) {
      case 'runs.create':
        return this.runs.create(parse(RunsCreateInputSchema, raw));
      case 'runs.appendEvent': {
        const input = parse(RunsAppendEventInputSchema, raw);
        return this.runs.appendEvent(input.run_id, input.type, input.payload);
      }
      case 'runs.complete': {
        const input = parse(RunsCompleteInputSchema, raw);
        return this.runs.complete(input.run_id, input.status, input.result);
      }
      case 'runs.get':
        return this.runs.get(parse(RunsGetInputSchema, raw).run_id);
      case 'runs.events':
        return this.runs.events(parse(RunsEventsInputSchema, raw).run_id);
      case 'memory.insert': {
        const input = parse(MemoryInsertInputSchema, raw);
        assertDimension(input.embedding);
        return this.memory.insert(input);
      }
      case 'memory.search': {
        const input = parse(MemorySearchInputSchema, raw);
        assertDimension(input.embedding);
        return this.memory.search(input);
      }
    }
  }
}

function assertDimension(embedding: number[] | undefined): void {
  if (embedding !== undefined && embedding.length !== EMBEDDING_DIMENSION) {
    throw new InvalidInputError(`embedding must have ${EMBEDDING_DIMENSION} dimensions`);
  }
}
