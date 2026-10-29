import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { GatewayError } from '../domain/errors.js';
import type { ServiceClient, ServiceResponse } from '../domain/ports.js';

/** Routes a tool call to the owning service over an MCP client connection. */
export class McpServiceClient implements ServiceClient {
  constructor(private readonly connections: ReadonlyMap<string, Pick<Client, 'callTool'>>) {}

  async invoke(service: string, tool: string, args: Record<string, unknown>): Promise<ServiceResponse> {
    const connection = this.connections.get(service);
    if (connection === undefined)
      throw new GatewayError('SERVICE_UNAVAILABLE', `service ${service} has no connection`);
    let response;
    try {
      response = await connection.callTool({ name: tool, arguments: args });
    } catch (error) {
      throw new GatewayError('SERVICE_UNAVAILABLE', `service ${service} unavailable: ${String(error)}`);
    }
    const first = (response.content as { type: string; text?: string }[] | undefined)?.[0];
    return {
      structured: response.structuredContent as Record<string, unknown> | undefined,
      text: first?.type === 'text' ? (first.text ?? '') : '',
      isError: response.isError === true,
    };
  }
}
