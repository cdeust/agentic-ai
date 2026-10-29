import { describe, expect, it } from 'vitest';
import type { AgentPort, AgentRequest } from '../../worker/agent-port.js';
import { InMemoryInternalTools } from '../../worker/internal-tools.js';
import { runWorker } from '../../worker/run-worker.js';

const COST = { input_tokens: 3, output_tokens: 2, usd: 0.0002 };

/** Scripted agent: no network, no Anthropic call. */
class ScriptedAgent implements AgentPort {
  readonly requests: AgentRequest[] = [];
  constructor(private readonly script: (request: AgentRequest) => Promise<unknown>) {}
  async run(request: AgentRequest) {
    this.requests.push(request);
    return {
      structured: await this.script(request),
      evidence: [{ source: 'memory', ref: 'm1' }],
      cost: COST,
    };
  }
}

const input = (tool: string, body: unknown) =>
  JSON.stringify({ run_id: 'r1', tool, input: body, limits: { max_turns: 3, max_budget_usd: 0.2 } });

describe('runWorker', () => {
  it('runs the agent with the internal tools and emits an ok WorkerOutput', async () => {
    const tools = new InMemoryInternalTools();
    await tools.insert('alpha fact', []);
    const agent = new ScriptedAgent(async (request) => {
      const found = await request.tools.search('alpha', 5);
      return { summary: 'one fact', memories: found };
    });
    const result = await runWorker(input('recall', { query: 'alpha' }), { agent, tools });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'ok',
      cost: COST,
      data: { summary: 'one fact' },
    });
    expect(agent.requests[0]).toMatchObject({ limits: { maxTurns: 3, maxBudgetUsd: 0.2 }, tool: 'recall' });
    expect(agent.requests[0]?.outputSchema).toMatchObject({ type: 'object' });
  });

  it('turns an agent error into a failed WorkerOutput with a named code', async () => {
    const agent = new ScriptedAgent(async () => {
      throw new Error('agent stopped: error_max_turns');
    });
    const result = await runWorker(input('recall', { query: 'q' }), {
      agent,
      tools: new InMemoryInternalTools(),
    });
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'failed',
      error: { code: 'WORKER_FAILED', message: expect.stringContaining('error_max_turns') },
    });
  });

  it.each([
    ['not JSON', 'nope'],
    ['an unknown tool', input('teleport', {})],
    ['a malformed envelope', JSON.stringify({ tool: 1 })],
  ])('exits with code 2 on %s', async (_name, stdin) => {
    const agent = new ScriptedAgent(async () => ({}));
    const result = await runWorker(stdin, { agent, tools: new InMemoryInternalTools() });
    expect(result.exitCode).toBe(2);
    expect(agent.requests).toHaveLength(0);
  });
});
