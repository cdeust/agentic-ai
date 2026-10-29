import { z } from 'zod';

/** Outcome of a tool call. `needs_clarification` carries the question in `error.message`. */
export const ResultStatusSchema = z.enum(['ok', 'needs_clarification', 'failed']);
export type ResultStatus = z.infer<typeof ResultStatusSchema>;

/** Named causes of a non-ok Result. A failure always names one of these. */
export const ErrorCodeSchema = z.enum([
  'INVALID_INPUT',
  'NEEDS_CLARIFICATION',
  'WORKER_UNAVAILABLE',
  'WORKER_FAILED',
  'WORKER_TIMEOUT',
  'WORKER_OUTPUT_INVALID',
  'DATA_UNAVAILABLE',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const EvidenceSchema = z.object({
  source: z.string(),
  ref: z.string(),
  excerpt: z.string().optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const CostSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  usd: z.number().nonnegative(),
});
export type Cost = z.infer<typeof CostSchema>;

export const ErrorInfoSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
});
export type ErrorInfo = z.infer<typeof ErrorInfoSchema>;

/** Result<T> = { status, data, evidence, run_id, cost, error? }. `run_id` is null only when no run was created. */
export interface Result<T> {
  status: ResultStatus;
  data: T | null;
  evidence: Evidence[];
  run_id: string | null;
  cost: Cost;
  error?: ErrorInfo;
}

/** Declarative invariants: ok has data and no error; failed has an error. */
export function resultSchema<T extends z.ZodType>(data: T) {
  return z
    .object({
      status: ResultStatusSchema,
      data: data.nullable(),
      evidence: z.array(EvidenceSchema),
      run_id: z.string().nullable(),
      cost: CostSchema,
      error: ErrorInfoSchema.optional(),
    })
    .superRefine((value, ctx) => {
      const {
        status,
        data: payload,
        error,
      } = value as unknown as Pick<Result<unknown>, 'status' | 'data' | 'error'>;
      if (status === 'ok' && (payload === null || error !== undefined)) {
        ctx.addIssue({ code: 'custom', message: 'status ok requires data and no error' });
      }
      if (status !== 'ok' && error === undefined) {
        ctx.addIssue({ code: 'custom', message: `status ${status} requires an error` });
      }
    });
}

export const ZERO_COST: Cost = { input_tokens: 0, output_tokens: 0, usd: 0 };
