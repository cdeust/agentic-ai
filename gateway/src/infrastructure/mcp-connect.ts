import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/** Opens an MCP client connection to a service's streamable-HTTP endpoint. */
export async function connectMcpOverHttp(url: string, name: string): Promise<Client> {
  const client = new Client({ name, version: '0.1.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  await client.listTools();
  return client;
}
