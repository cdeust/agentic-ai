import { describe, expect, it } from 'vitest';
import {
  DATA_OP_NAMES,
  RecallInputSchema,
  RememberInputSchema,
  TOOLS,
  TOOL_NAMES,
  WorkerOutputSchema,
  resultSchema,
  RecallDataSchema,
  ZERO_COST,
} from '../src/index.js';

describe('Result schema', () => {
  const schema = resultSchema(RecallDataSchema);
  const base = { evidence: [], run_id: 'r1', cost: ZERO_COST };

  it('accepts ok with data and failed with an error', () => {
    expect(schema.safeParse({ ...base, status: 'ok', data: { summary: 's', memories: [] } }).success).toBe(
      true,
    );
    expect(
      schema.safeParse({
        ...base,
        status: 'failed',
        data: null,
        error: { code: 'WORKER_FAILED', message: 'm' },
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        ...base,
        status: 'needs_clarification',
        data: null,
        error: { code: 'NEEDS_CLARIFICATION', message: 'which?' },
      }).success,
    ).toBe(true);
  });

  it('rejects ok without data, failed without error, and unnamed causes', () => {
    expect(schema.safeParse({ ...base, status: 'ok', data: null }).success).toBe(false);
    expect(schema.safeParse({ ...base, status: 'failed', data: null }).success).toBe(false);
    expect(
      schema.safeParse({ ...base, status: 'failed', data: null, error: { code: 'BECAUSE', message: 'm' } })
        .success,
    ).toBe(false);
  });

  it('allows a null run_id only as a value, never a missing field', () => {
    expect(
      schema.safeParse({
        status: 'failed',
        data: null,
        evidence: [],
        cost: ZERO_COST,
        error: { code: 'INVALID_INPUT', message: 'm' },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...base,
        run_id: null,
        status: 'failed',
        data: null,
        error: { code: 'INVALID_INPUT', message: 'm' },
      }).success,
    ).toBe(true);
  });
});

describe('tool schemas', () => {
  it('applies defaults and rejects empty input', () => {
    expect(RecallInputSchema.parse({ query: 'q' })).toEqual({ query: 'q', limit: 5 });
    expect(RememberInputSchema.parse({ content: 'c' })).toEqual({ content: 'c', tags: [] });
    expect(RecallInputSchema.safeParse({ query: '' }).success).toBe(false);
    expect(RecallInputSchema.safeParse({ query: 'q', limit: 500 }).success).toBe(false);
  });

  it('declares an owner, a description and an output schema for every tool', () => {
    expect(TOOL_NAMES).toEqual(['recall', 'remember']);
    for (const name of TOOL_NAMES) {
      expect(TOOLS[name].owner).toBe('memory');
      expect(TOOLS[name].description.length).toBeGreaterThan(0);
    }
  });

  it('has no data operation that carries SQL', () => {
    expect(DATA_OP_NAMES.filter((op) => /sql|query/i.test(op))).toEqual([]);
  });

  it('validates the worker wire format', () => {
    const ok = { status: 'ok', data: {}, evidence: [], cost: ZERO_COST };
    expect(WorkerOutputSchema.safeParse(ok).success).toBe(true);
    expect(
      WorkerOutputSchema.safeParse({ ...ok, cost: { input_tokens: -1, output_tokens: 0, usd: 0 } }).success,
    ).toBe(false);
  });
});
