import { TOOLS, WorkerInputSchema, ZERO_COST, type WorkerOutput } from '@agentic-ai/contracts';
import { z } from 'zod';
import type { AgentPort, InternalTools } from './agent-port.js';
import { SYSTEM_PROMPTS } from './prompts.js';

export interface WorkerDependencies {
  agent: AgentPort;
  tools: InternalTools;
}

export interface WorkerProcessResult {
  exitCode: number;
  stdout: string;
}

const DEFAULT_LIMITS = { maxTurns: 8, maxBudgetUsd: 0.5 };

function failed(code: string, message: string): WorkerOutput {
  return { status: 'failed', data: null, evidence: [], cost: ZERO_COST, error: { code, message } };
}

/**
 * Worker core: one JSON document in (WorkerInput), one JSON document out (WorkerOutput).
 * Pure with respect to I/O: the agent runtime and the tools are injected.
 */
export async function runWorker(stdin: string, deps: WorkerDependencies): Promise<WorkerProcessResult> {
  let json: unknown;
  try {
    json = JSON.parse(stdin);
  } catch {
    return { exitCode: 2, stdout: JSON.stringify(failed('WORKER_FAILED', 'stdin is not JSON')) };
  }
  const input = WorkerInputSchema.safeParse(json);
  if (!input.success) {
    return { exitCode: 2, stdout: JSON.stringify(failed('WORKER_FAILED', input.error.message)) };
  }
  const { tool } = input.data;
  const contract = Object.hasOwn(TOOLS, tool) ? TOOLS[tool as keyof typeof TOOLS] : undefined;
  const systemPrompt = SYSTEM_PROMPTS[tool];
  if (contract === undefined || systemPrompt === undefined) {
    return { exitCode: 2, stdout: JSON.stringify(failed('WORKER_FAILED', `unknown tool ${tool}`)) };
  }
  try {
    const outcome = await deps.agent.run({
      tool,
      input: input.data.input,
      systemPrompt,
      outputSchema: z.toJSONSchema(contract.data) as Record<string, unknown>,
      limits: input.data.limits
        ? { maxTurns: input.data.limits.max_turns, maxBudgetUsd: input.data.limits.max_budget_usd }
        : DEFAULT_LIMITS,
      tools: deps.tools,
    });
    const output: WorkerOutput = {
      status: 'ok',
      data: outcome.structured,
      evidence: outcome.evidence,
      cost: outcome.cost,
    };
    return { exitCode: 0, stdout: JSON.stringify(output) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { exitCode: 0, stdout: JSON.stringify(failed('WORKER_FAILED', message)) };
  }
}
