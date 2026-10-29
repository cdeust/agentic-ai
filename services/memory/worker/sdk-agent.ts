import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import type { Evidence } from '@agentic-ai/contracts';
import { z } from 'zod';
import type { AgentOutcome, AgentPort, AgentRequest } from './agent-port.js';

const SERVER_NAME = 'memory';

/**
 * Claude Agent SDK adapter (the only place the SDK is imported).
 * Types checked against node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:
 * query(), tool(), createSdkMcpServer(), Options.{tools, allowedTools, maxTurns, maxBudgetUsd,
 * outputFormat, settingSources, persistSession, permissionMode}, SDKResultSuccess.{structured_output, total_cost_usd, usage}.
 */
export class ClaudeSdkAgent implements AgentPort {
  constructor(private readonly env: Record<string, string | undefined> = process.env) {}

  async run(request: AgentRequest): Promise<AgentOutcome> {
    const evidence: Evidence[] = [];
    const memory = createSdkMcpServer({
      name: SERVER_NAME,
      tools: [
        tool(
          'memory_search',
          'Search stored memories by text.',
          { query: z.string(), limit: z.number().int().min(1).max(50).default(5) },
          async (args) => {
            const found = await request.tools.search(args.query, args.limit);
            for (const item of found)
              evidence.push({ source: 'memory', ref: item.id, excerpt: item.content });
            return { content: [{ type: 'text', text: JSON.stringify(found) }] };
          },
        ),
        tool(
          'memory_insert',
          'Store one memory.',
          { content: z.string().min(1), tags: z.array(z.string()).default([]) },
          async (args) => {
            const stored = await request.tools.insert(args.content, args.tags);
            evidence.push({ source: 'memory', ref: stored.id });
            return { content: [{ type: 'text', text: JSON.stringify(stored) }] };
          },
        ),
      ],
    });

    const stream = query({
      prompt: JSON.stringify({ tool: request.tool, input: request.input }),
      options: {
        systemPrompt: request.systemPrompt,
        mcpServers: { [SERVER_NAME]: memory },
        strictMcpConfig: true,
        tools: [],
        allowedTools: [`mcp__${SERVER_NAME}__memory_search`, `mcp__${SERVER_NAME}__memory_insert`],
        permissionMode: 'dontAsk',
        settingSources: [],
        persistSession: false,
        maxTurns: request.limits.maxTurns,
        maxBudgetUsd: request.limits.maxBudgetUsd,
        outputFormat: { type: 'json_schema', schema: request.outputSchema },
        env: this.env,
      },
    });

    for await (const message of stream) {
      if (message.type !== 'result') continue;
      if (message.subtype !== 'success') {
        throw new Error(`agent stopped: ${message.subtype}`);
      }
      const cost = {
        input_tokens: message.usage.input_tokens,
        output_tokens: message.usage.output_tokens,
        usd: message.total_cost_usd,
      };
      return { structured: message.structured_output, evidence, cost };
    }
    throw new Error('agent produced no result message');
  }
}
