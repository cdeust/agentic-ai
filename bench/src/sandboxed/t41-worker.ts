// T-41 : worker agent ENTIER sous srt. Ce processus tourne dans la sandbox ; il contient la boucle query() de l'Agent SDK
// et des handlers minces. Il parle a l'hote par ses propres stdin/stdout (MCP inverse, E-02). Le binaire Claude Code est
// lance par le SDK comme enfant simple de ce processus : il partage la sandbox, aucun srt imbrique (E-07).
// stdout est le canal MCP : tout journal va sur stderr.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';

console.log = (...a: unknown[]) => console.error(...a);
const text = (r: unknown): string => ((r as { content: Array<{ text: string }> }).content[0] as { text: string }).text;
const tryFs = (f: () => unknown): string => { try { f(); return 'LU'; } catch (e) { return (e as NodeJS.ErrnoException).code ?? 'ERR'; } };

const client = new Client({ name: 'worker', version: '0.0.0' });
await client.connect(new StdioServerTransport());
const input = JSON.parse(text(await client.callTool({ name: 'task_input', arguments: {} }))) as { prompt: string; brokerPort: number };

const proofs: Record<string, unknown> = {
  home: homedir(),
  pid: process.pid,
  ssh_read: tryFs(() => readFileSync(path.join(homedir(), '.ssh', 'id_test'))),
  home_list: tryFs(() => readdirSync(homedir())),
  env_entries: Object.entries(process.env).map(([k, v]) => `${k}=${v}`),
  proxy_env: Object.keys(process.env).filter((k) => /proxy/i.test(k)),
};

// Handler mince : aucune logique, transmission a l'hote qui detient l'identite de la task par fermeture.
const platform = createSdkMcpServer({
  name: 'platform',
  tools: [tool('memory_search', 'cherche en memoire', { query: z.string() }, async (a) => ({ content: [{ type: 'text', text: text(await client.callTool({ name: 'memory_search', arguments: a })) }] }))],
});
const env: Record<string, string | undefined> = {
  ...process.env,
  ANTHROPIC_API_KEY: 'aucune-cle-ici',
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${input.brokerPort}`,
  CLAUDE_CONFIG_DIR: path.join(process.cwd(), '.cfg'),
  DISABLE_TELEMETRY: '1',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  DISABLE_AUTOUPDATER: '1',
};
delete env['NO_PROXY'];
delete env['no_proxy']; // sinon le loopback du broker contourne le proxy et la sandbox refuse (T-03d)

let result = '';
let init: unknown;
try {
  for await (const m of query({
    prompt: input.prompt,
    options: {
      cwd: process.cwd(),
      maxTurns: 4,
      persistSession: false,
      settingSources: [],
      strictMcpConfig: true,
      mcpServers: { platform },
      tools: [],
      allowedTools: ['mcp__platform__memory_search'],
      permissionMode: 'dontAsk',
      env,
    },
  })) {
    if (m.type === 'system' && (m as { subtype?: string }).subtype === 'init') init = { tools: (m as { tools?: string[] }).tools, mcp: (m as { mcp_servers?: unknown }).mcp_servers };
    if (m.type === 'result') result = `${m.subtype}:${(m as { result?: string }).result ?? ''}`;
  }
} catch (e) {
  result = `EXCEPTION:${(e as Error).message.slice(0, 200)}`;
}
proofs['init'] = init;
await client.callTool({ name: 'task_complete', arguments: { output: JSON.stringify({ result, proofs }) } });
await client.close();
process.exit(0);
