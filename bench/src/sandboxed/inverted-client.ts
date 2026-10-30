// E-02 : processus sous srt, CLIENT MCP sur ses propres stdin/stdout. StdioServerTransport est symetrique : le role vient du Client.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
const client = new Client({ name: 'sandboxed-task', version: '0.0.0' });
await client.connect(new StdioServerTransport());
const tools = (await client.listTools()).tools.map((t) => t.name);
const input = (await client.callTool({ name: 'task_input', arguments: {} })) as { content: Array<{ text: string }> };
const { n } = JSON.parse((input.content[0] as { text: string }).text) as { n: number };
let sum = 0;
const t0 = performance.now();
for (let i = 0; i < n; i++) {
  const r = (await client.callTool({ name: 'memory_search', arguments: { query: String(i) } })) as { content: Array<{ text: string }> };
  sum += (JSON.parse((r.content[0] as { text: string }).text) as { echoed: number }).echoed;
}
const denied = (await client.callTool({ name: 'hors_profil', arguments: {} }).catch((e: Error) => ({ thrown: e.message }))) as { isError?: boolean; thrown?: string };
await client.callTool({ name: 'task_complete', arguments: { output: JSON.stringify({ tools, sum, ms: Math.round(performance.now() - t0), denied: denied.isError ?? denied.thrown }) } });
await client.close();
