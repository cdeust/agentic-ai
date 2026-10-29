import { z } from 'zod';
import { CostSchema, EvidenceSchema, ResultStatusSchema, resultSchema } from './result.js';

export const MemoryItemSchema = z.object({
  id: z.string(),
  content: z.string(),
  tags: z.array(z.string()),
  score: z.number(),
});
export type MemoryItem = z.infer<typeof MemoryItemSchema>;

export const RecallInputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(5),
});
export type RecallInput = z.infer<typeof RecallInputSchema>;

export const RecallDataSchema = z.object({
  summary: z.string(),
  memories: z.array(MemoryItemSchema),
});
export type RecallData = z.infer<typeof RecallDataSchema>;

export const RememberInputSchema = z.object({
  content: z.string().min(1),
  tags: z.array(z.string()).default([]),
});
export type RememberInput = z.infer<typeof RememberInputSchema>;

export const RememberDataSchema = z.object({
  memory_id: z.string(),
});
export type RememberData = z.infer<typeof RememberDataSchema>;

export const ServiceIdSchema = z.enum(['memory']);
export type ServiceId = z.infer<typeof ServiceIdSchema>;

export interface ToolContract<I extends z.ZodType = z.ZodType, D extends z.ZodType = z.ZodType> {
  readonly owner: ServiceId;
  readonly description: string;
  readonly input: I;
  readonly data: D;
  readonly output: z.ZodType;
}

function tool<I extends z.ZodType, D extends z.ZodType>(
  owner: ServiceId,
  description: string,
  input: I,
  data: D,
): ToolContract<I, D> {
  return { owner, description, input, data, output: resultSchema(data) };
}

/** Intent tools exposed to clients. The gateway routes each to its owner. */
export const TOOLS = {
  recall: tool(
    'memory',
    'Recall memories relevant to a question and return a grounded summary with evidence.',
    RecallInputSchema,
    RecallDataSchema,
  ),
  remember: tool('memory', 'Store a piece of knowledge in memory.', RememberInputSchema, RememberDataSchema),
} as const;
export type ToolName = keyof typeof TOOLS;
export const TOOL_NAMES = Object.keys(TOOLS) as ToolName[];

/** Wire contract between a service and its worker (one JSON document each way). */
export const WorkerInputSchema = z.object({
  run_id: z.string(),
  tool: z.string(),
  input: z.unknown(),
  /** Set by the service (services/<name>/src/main.ts DEFAULT_LIMITS); the worker has no defaults of its own. */
  limits: z.object({ max_turns: z.number().int().positive(), max_budget_usd: z.number().positive() }),
});
export type WorkerInput = z.infer<typeof WorkerInputSchema>;

/** The worker reports a free-form error code; the service maps it to a named ErrorCode. */
export const WorkerOutputSchema = z.object({
  status: ResultStatusSchema,
  data: z.unknown(),
  evidence: z.array(EvidenceSchema),
  cost: CostSchema,
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});
export type WorkerOutput = z.infer<typeof WorkerOutputSchema>;
