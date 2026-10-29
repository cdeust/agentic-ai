import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TOOLS, type ToolName } from '@agentic-ai/contracts';
import type { z } from 'zod';
import type { CallTool } from '../application/call-tool.js';
import type { ListTools } from '../application/list-tools.js';
import { GatewayError } from '../application/errors.js';

function errorResult(error: unknown) {
  const code = error instanceof GatewayError ? error.code : 'INTERNAL';
  const message = error instanceof GatewayError ? error.message : 'internal error';
  return { content: [{ type: 'text' as const, text: JSON.stringify({ code, message }) }], isError: true };
}

/** The single MCP server clients see. It only translates MCP to the CallTool use case and back. */
export function createGatewayServer(callTool: CallTool, listTools: ListTools): McpServer {
  const server = new McpServer({ name: 'agentic-ai-gateway', version: '0.1.0' });
  for (const descriptor of listTools.execute()) {
    const contract = TOOLS[descriptor.name as ToolName] as (typeof TOOLS)[ToolName] | undefined;
    if (contract === undefined) continue;
    server.registerTool(
      descriptor.name,
      {
        description: descriptor.description,
        inputSchema: contract.input as z.ZodObject,
        outputSchema: contract.output as z.ZodObject,
      },
      async (args: Record<string, unknown>, extra) => {
        try {
          const response = await callTool.execute({
            tool: descriptor.name,
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
