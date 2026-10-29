import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TOOLS, TOOL_NAMES } from '@agentic-ai/contracts';
import type { z } from 'zod';
import type { IntentService } from '../application/intent-service.js';

/** Internal MCP server of the memory service: one tool per intent it owns. */
export function createMemoryServer(intents: IntentService): McpServer {
  const server = new McpServer({ name: 'agentic-ai-memory', version: '0.1.0' });
  for (const name of TOOL_NAMES) {
    const contract = TOOLS[name];
    if (contract.owner !== 'memory') continue;
    server.registerTool(
      name,
      {
        description: contract.description,
        inputSchema: contract.input as z.ZodObject,
        outputSchema: contract.output as z.ZodObject,
      },
      async (args: unknown) => {
        const result = await intents.handle(name, args);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      },
    );
  }
  return server;
}
