import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentPort, AgentRequest, InternalTools } from '../../worker/agent-port.js';
import { loadPrompts, PROMPTS_DIR } from '../../worker/prompts.js';
import { runWorker } from '../../worker/run-worker.js';

const COST = { input_tokens: 3, output_tokens: 2, usd: 0.0002 };
const PROMPTS = { recall: 'recall prompt', remember: 'remember prompt' };

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

const tools: InternalTools = {
  call: async (tool) =>
    tool === 'memory_search' ? [{ id: 'm1', content: 'alpha fact', tags: [], score: 1 }] : { id: 'm2' },
};

const input = (tool: string, body: unknown) =>
  JSON.stringify({ run_id: 'r1', tool, input: body, limits: { max_turns: 3, max_budget_usd: 0.2 } });

describe('runWorker', () => {
  it('runs the agent with the tool prompt and internal tools and emits an ok WorkerOutput', async () => {
    const agent = new ScriptedAgent(async (request) => {
      const found = await request.tools.call('memory_search', { query: 'alpha', limit: 5 });
      return { summary: 'one fact', memories: found };
    });
    const result = await runWorker(input('recall', { query: 'alpha' }), { agent, tools, prompts: PROMPTS });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'ok',
      cost: COST,
      data: { summary: 'one fact' },
    });
    expect(agent.requests[0]).toMatchObject({
      limits: { maxTurns: 3, maxBudgetUsd: 0.2 },
      tool: 'recall',
      systemPrompt: 'recall prompt',
    });
    expect(agent.requests[0]?.outputSchema).toMatchObject({ type: 'object' });
  });

  it('turns an agent error into a failed WorkerOutput with a named code', async () => {
    const agent = new ScriptedAgent(async () => {
      throw new Error('agent stopped: error_max_turns');
    });
    const result = await runWorker(input('recall', { query: 'q' }), { agent, tools, prompts: PROMPTS });
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'failed',
      error: { code: 'WORKER_FAILED', message: expect.stringContaining('error_max_turns') },
    });
  });

  it.each([
    ['not JSON', 'nope'],
    ['an unknown tool', input('teleport', {})],
    ['a malformed envelope', JSON.stringify({ tool: 1 })],
    ['a tool without a prompt', input('recall', { query: 'q' }), {}],
  ])('exits with code 2 on %s', async (_name, stdin, prompts: Record<string, string> = PROMPTS) => {
    const agent = new ScriptedAgent(async () => ({}));
    const result = await runWorker(stdin, { agent, tools, prompts });
    expect(result.exitCode).toBe(2);
    expect(agent.requests).toHaveLength(0);
  });
});

describe('worker prompts (prompts/<tool>.md)', () => {
  const temps: string[] = [];
  afterEach(() => temps.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
  const dirWith = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), 'prompts-'));
    temps.push(dir);
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    return pathToFileURL(`${dir}/`);
  };

  it('loads a non-empty committed prompt for every intent tool the worker serves', async () => {
    const prompts = await loadPrompts(PROMPTS_DIR);
    expect(Object.keys(prompts).sort()).toEqual(['recall', 'remember']);
    expect(prompts['recall']).toContain('memory_search');
    expect(prompts['remember']).toContain('memory_insert');
  });

  it('rejects a directory with a missing or an empty prompt', async () => {
    await expect(loadPrompts(dirWith({ 'recall.md': 'x' }))).rejects.toThrow();
    await expect(loadPrompts(dirWith({ 'recall.md': 'x', 'remember.md': '  \n' }))).rejects.toThrow('empty');
  });
});
