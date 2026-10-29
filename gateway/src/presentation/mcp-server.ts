import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TOOLS, TOOL_NAMES } from '@agentic-ai/contracts';
import type { z } from 'zod';
import type { CallTool } from '../application/call-tool.js';
import { GatewayError } from '../application/errors.js';

function errorResult(error: unknown) {
  const code = error instanceof GatewayError ? error.code : 'INTERNAL';
  const message = error instanceof GatewayError ? error.message : 'internal error';
  return { content: [{ type: 'text' as const, text: JSON.stringify({ code, message }) }], isError: true };
}

/** The single MCP server clients see: the contract catalogue, each call translated to the CallTool use case. */
export function createGatewayServer(callTool: CallTool): McpServer {
  const server = new McpServer({ name: 'agentic-ai-gateway', version: '0.1.0' });
  for (const name of TOOL_NAMES) {
    const contract = TOOLS[name];
    server.registerTool(
      name,
      {
        description: contract.description,
        inputSchema: contract.input as z.ZodObject,
        outputSchema: contract.output as z.ZodObject,
      },
      async (args: Record<string, unknown>, extra) => {
        try {
          const response = await callTool.execute({
            tool: name,
            args,
            presented: { token: extra.authInfo?.token },
          });
          if (response.isError || response.structured === undefined) {
            return { content: [{ type: 'text' as const, text: response.text }], isError: true };
          }
          return {
            content: [{ type: 'text' as const, text: response.text }],
            structuredContent: response.structured,
          };
        } catch (error) {
          return errorResult(error);
        }
      },
    );
  }
  return server;
}
