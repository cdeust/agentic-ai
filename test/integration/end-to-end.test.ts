import { afterEach, describe, expect, it } from 'vitest';
import { ResultStatusSchema, TOOLS } from '@agentic-ai/contracts';
import { buildStack, scriptedAgent } from './harness.js';

const open: { close(): unknown }[] = [];
afterEach(() => open.splice(0).forEach((stack) => stack.close()));
async function stackFor(...args: Parameters<typeof buildStack>) {
  const stack = await buildStack(...args);
  open.push(stack);
  return stack;
}

const prompts: Record<string, string> = {};
const wellBehavedAgent = scriptedAgent(async (request) => {
  prompts[request.tool] = request.systemPrompt;
  if (request.tool === 'remember') {
    const stored = (await request.tools.call('memory_insert', request.input as Record<string, unknown>)) as {
      id: string;
    };
    return { memory_id: stored.id };
  }
  const input = request.input as { query: string; limit: number };
  const memories = (await request.tools.call('memory_search', input)) as unknown[];
  return { summary: `${memories.length} memory(ies) match "${input.query}"`, memories };
});

describe('end to end: client -> gateway -> memory -> worker -> data', () => {
  it('serves recall through the gateway, runs the worker, validates the Result and records the run', async () => {
    const stack = await stackFor(wellBehavedAgent);

    const remembered = await stack.client.callTool({
      name: 'remember',
      arguments: { content: 'The staging database is rebuilt every Monday', tags: ['ops'] },
    });
    expect(remembered.isError).toBeFalsy();

    const recalled = await stack.client.callTool({
      name: 'recall',
      arguments: { query: 'staging database' },
    });
    expect(recalled.isError).toBeFalsy();

    const result = TOOLS.recall.output.parse(recalled.structuredContent) as {
      status: string;
      run_id: string;
      data: { summary: string; memories: { content: string }[] };
      cost: { input_tokens: number };
    };
    expect(ResultStatusSchema.parse(result.status)).toBe('ok');
    expect(result.data.summary).toBe('1 memory(ies) match "staging database"');
    expect(result.data.memories[0]?.content).toContain('rebuilt every Monday');
    expect(result.cost.input_tokens).toBe(12);

    const { run, events } = await stack.run(result.run_id);
    expect(run).toMatchObject({
      service: 'memory',
      tool: 'recall',
      status: 'ok',
      input: { query: 'staging database', limit: 5 },
    });
    expect(events.map((e) => e.type)).toEqual([
      'run.created',
      'worker.started',
      'worker.exited',
      'output.validated',
      'run.completed',
    ]);
    expect(events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4]);

    // The agent received the system prompts of the committed prompts/<tool>.md files.
    expect(prompts['remember']).toContain('memory_insert');
    expect(prompts['recall']).toContain('memory_search');

    expect(stack.audit.entries.map((e) => [e.tool, e.owner, e.outcome])).toEqual([
      ['remember', 'memory', 'ok'],
      ['recall', 'memory', 'ok'],
    ]);
  });
});

describe('end to end: failures are values with a named cause', () => {
  it('turns an invalid worker output into status failed with a named cause, recorded in the registry', async () => {
    const stack = await stackFor(scriptedAgent(async () => ({ summary: 123, memories: 'not a list' })));

    const response = await stack.client.callTool({ name: 'recall', arguments: { query: 'anything' } });
    const result = response.structuredContent as {
      status: string;
      data: unknown;
      run_id: string;
      error: { code: string; message: string };
    };
    expect(result.status).toBe('failed');
    expect(result.data).toBeNull();
    expect(result.error.code).toBe('WORKER_OUTPUT_INVALID');
    expect(result.error.message.length).toBeGreaterThan(0);

    const { run, events } = await stack.run(result.run_id);
    expect(run.status).toBe('failed');
    expect(events.map((e) => e.type)).toEqual([
      'run.created',
      'worker.started',
      'worker.exited',
      'output.invalid',
      'run.completed',
    ]);
  });

  it('turns an agent crash into status failed with cause WORKER_FAILED', async () => {
    const stack = await stackFor(
      scriptedAgent(async () => {
        throw new Error('agent stopped: error_max_turns');
      }),
    );
    const response = await stack.client.callTool({ name: 'recall', arguments: { query: 'q' } });
    expect(response.structuredContent).toMatchObject({
      status: 'failed',
      error: { code: 'WORKER_FAILED', message: expect.stringContaining('error_max_turns') },
    });
  });
});
