// Module MCP stdio pose sous srt (E-01, T-38, T-39). Rien n'est ecrit sur stdout hors protocole.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync, readdirSync } from 'node:fs';
import net from 'node:net';
import http from 'node:http';

const server = new McpServer({ name: 'bench-module', version: '0.0.0' });
const text = (o: unknown) => ({ content: [{ type: 'text' as const, text: typeof o === 'string' ? o : JSON.stringify(o) }] });
const connect = (target: { port: number; host: string } | string): Promise<string> =>
  new Promise((resolve) => {
    const c = typeof target === 'string' ? net.connect(target) : net.connect(target.port, target.host);
    const t = setTimeout(() => { c.destroy(); resolve('TIMEOUT'); }, 4000);
    c.on('connect', () => { clearTimeout(t); c.destroy(); resolve('CONNECTE'); });
    c.on('error', (e: NodeJS.ErrnoException) => { clearTimeout(t); resolve(e.code ?? e.message); });
  });
const tryFetch = async (url: string): Promise<string> => {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(6000) }); return `HTTP-${r.status}`; }
  catch (e) { const x = e as { cause?: { code?: string }; message: string }; return `ECHEC:${String(x.cause?.code ?? '')}:${x.message}`; }
};
const tryFs = (f: () => unknown): string => { try { f(); return 'LU'; } catch (e) { return (e as NodeJS.ErrnoException).code ?? 'ERR'; } };

server.registerTool('echo', { description: 'echo', inputSchema: { text: z.string() } }, async ({ text: t }) => text(t));
server.registerTool('probe', { description: 'tentatives interdites', inputSchema: { tcpPort: z.number(), unixPath: z.string(), canary: z.string(), home: z.string() } },
  async ({ tcpPort, unixPath, canary, home }) =>
    text({
      tcp_direct: await connect({ port: tcpPort, host: '127.0.0.1' }),
      unix_pg: await connect(unixPath),
      fetch_external: await tryFetch('https://example.com'),
      fetch_host_loopback: await tryFetch(`http://127.0.0.1:${tcpPort}/`),
      read_ssh: tryFs(() => readFileSync(canary)),
      list_home: tryFs(() => readdirSync(home)),
    }));
server.registerTool('listen_http', { description: 'tente d ecouter en HTTP', inputSchema: {} }, async () => {
  const srv = http.createServer((_q, r) => r.end('module-http'));
  return new Promise((resolve) => {
    srv.on('error', (e: NodeJS.ErrnoException) => resolve(text({ listening: false, error: e.code ?? e.message })));
    srv.listen(0, '127.0.0.1', () => resolve(text({ listening: true, port: (srv.address() as net.AddressInfo).port })));
  });
});
await server.connect(new StdioServerTransport());
