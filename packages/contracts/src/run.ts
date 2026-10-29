import { z } from 'zod';

export const RunStatusSchema = z.enum(['running', 'ok', 'needs_clarification', 'failed']);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunEventTypeSchema = z.enum([
  'run.created',
  'worker.started',
  'worker.exited',
  'output.validated',
  'output.invalid',
  'run.completed',
]);
export type RunEventType = z.infer<typeof RunEventTypeSchema>;

export const RunSchema = z.object({
  id: z.string(),
  service: z.string(),
  tool: z.string(),
  input: z.unknown(),
  status: RunStatusSchema,
  result: z.unknown().optional(),
  created_at: z.string(),
  completed_at: z.string().optional(),
});
export type Run = z.infer<typeof RunSchema>;

export const RunEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  run_id: z.string(),
  type: RunEventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  at: z.string(),
});
export type RunEvent = z.infer<typeof RunEventSchema>;
