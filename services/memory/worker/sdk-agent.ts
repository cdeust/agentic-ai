import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { INTERNAL_TOOLS, INTERNAL_TOOL_NAMES, type Evidence } from '@agentic-ai/contracts';
import type { AgentOutcome, AgentPort, AgentRequest } from './agent-port.js';

const SERVER_NAME = 'memory';
const TOOL_NAMES = INTERNAL_TOOL_NAMES.filter((name) => INTERNAL_TOOLS[name].owner === SERVER_NAME);

/** Every returned record carrying an `id` is evidence; its `content`, when present, is the excerpt. */
function evidenceOf(value: unknown): Evidence[] {
  return (Array.isArray(value) ? value : [value]).flatMap((item: { id?: unknown; content?: unknown }) =>
    typeof item?.id === 'string'
      ? [
          {
            source: SERVER_NAME,
            ref: item.id,
            ...(typeof item.content === 'string' ? { excerpt: item.content } : {}),
          },
        ]
      : [],
  );
}

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
    const server = createSdkMcpServer({
      name: SERVER_NAME,
      tools: TOOL_NAMES.map((name) =>
        tool(name, INTERNAL_TOOLS[name].description, INTERNAL_TOOLS[name].input.shape, async (args) => {
          const answer = await request.tools.call(name, args);
          evidence.push(...evidenceOf(answer));
          return { content: [{ type: 'text', text: JSON.stringify(answer) }] };
        }),
      ),
    });

    const stream = query({
      prompt: JSON.stringify({ tool: request.tool, input: request.input }),
      options: {
        systemPrompt: request.systemPrompt,
        mcpServers: { [SERVER_NAME]: server },
        strictMcpConfig: true,
        tools: [],
        allowedTools: TOOL_NAMES.map((name) => `mcp__${SERVER_NAME}__${name}`),
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
