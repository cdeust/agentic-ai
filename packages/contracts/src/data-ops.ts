import { z } from 'zod';
import { RunEventSchema, RunEventTypeSchema, RunSchema, RunStatusSchema } from './run.js';
import { MemoryItemSchema } from './tools.js';

/** Dimension of the pgvector column declared in data/migrations/0002_memory.sql. */
export const EMBEDDING_DIMENSION = 384;

const RunIdSchema = z.uuid();
const EmbeddingSchema = z.array(z.number()).length(EMBEDDING_DIMENSION);

/** Typed operations of the data component. There is no free-form SQL operation. */
export const RunsCreateInputSchema = z.object({
  service: z.string(),
  tool: z.string(),
  input: z.unknown(),
});
export const RunsAppendEventInputSchema = z.object({
  run_id: RunIdSchema,
  type: RunEventTypeSchema,
  payload: z.record(z.string(), z.unknown()).default({}),
});
export const RunsCompleteInputSchema = z.object({
  run_id: RunIdSchema,
  status: RunStatusSchema.exclude(['running']),
  result: z.unknown(),
});
export const RunsGetInputSchema = z.object({ run_id: RunIdSchema });
export const RunsEventsInputSchema = z.object({ run_id: RunIdSchema });
export const MemoryInsertInputSchema = z.object({
  content: z.string().min(1),
  tags: z.array(z.string()).default([]),
  embedding: EmbeddingSchema.optional(),
});
export const MemorySearchInputSchema = z.object({
  query: z.string(),
  embedding: EmbeddingSchema.optional(),
  limit: z.number().int().min(1).max(50).default(5),
});

export const DATA_OPS = {
  'runs.create': { input: RunsCreateInputSchema, output: RunSchema },
  'runs.appendEvent': { input: RunsAppendEventInputSchema, output: RunEventSchema },
  'runs.complete': { input: RunsCompleteInputSchema, output: RunSchema },
  'runs.get': { input: RunsGetInputSchema, output: RunSchema },
  'runs.events': { input: RunsEventsInputSchema, output: z.array(RunEventSchema) },
  'memory.insert': { input: MemoryInsertInputSchema, output: z.object({ id: z.string() }) },
  'memory.search': { input: MemorySearchInputSchema, output: z.array(MemoryItemSchema) },
} as const;
export type DataOpName = keyof typeof DATA_OPS;
export type DataOpInput<Op extends DataOpName> = z.output<(typeof DATA_OPS)[Op]['input']>;
export const DATA_OP_NAMES = Object.keys(DATA_OPS) as DataOpName[];

/**
 * Tools a worker agent may call back into, served by the owning service on the exec network.
 * Each one is a restricted view of one data operation: its input is a subset of that operation's input.
 */
export const INTERNAL_TOOLS = {
  memory_search: {
    owner: 'memory',
    op: 'memory.search',
    description: 'Search stored memories by text.',
    input: MemorySearchInputSchema.pick({ query: true, limit: true }),
  },
  memory_insert: {
    owner: 'memory',
    op: 'memory.insert',
    description: 'Store one memory.',
    input: MemoryInsertInputSchema.pick({ content: true, tags: true }),
  },
} as const;
export type InternalToolName = keyof typeof INTERNAL_TOOLS;
export const INTERNAL_TOOL_NAMES = Object.keys(INTERNAL_TOOLS) as InternalToolName[];
