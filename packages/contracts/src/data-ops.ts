import { z } from 'zod';
import { RunEventSchema, RunEventTypeSchema, RunSchema, RunStatusSchema } from './run.js';
import { MemoryItemSchema } from './tools.js';

/** Typed operations of the data component. There is no free-form SQL operation. */
export const RunsCreateInputSchema = z.object({
  service: z.string(),
  tool: z.string(),
  input: z.unknown(),
});
export const RunsAppendEventInputSchema = z.object({
  run_id: z.string(),
  type: RunEventTypeSchema,
  payload: z.record(z.string(), z.unknown()).default({}),
});
export const RunsCompleteInputSchema = z.object({
  run_id: z.string(),
  status: RunStatusSchema.exclude(['running']),
  result: z.unknown(),
});
export const RunsGetInputSchema = z.object({ run_id: z.string() });
export const RunsEventsInputSchema = z.object({ run_id: z.string() });
export const MemoryInsertInputSchema = z.object({
  content: z.string().min(1),
  tags: z.array(z.string()).default([]),
  embedding: z.array(z.number()).optional(),
});
export const MemorySearchInputSchema = z.object({
  query: z.string(),
  embedding: z.array(z.number()).optional(),
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
export const DATA_OP_NAMES = Object.keys(DATA_OPS) as DataOpName[];
