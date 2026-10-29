import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw === '' ? undefined : JSON.parse(raw);
}

/** Stateless streamable-HTTP host: GET /healthz and POST /mcp, one server per request. */
export function createHttpHost(serverFactory: () => McpServer): Server {
  return createServer((req, res) => {
    void (async () => {
      if (req.method === 'GET' && req.url === '/healthz') {
        res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
        return;
      }
      if (req.method !== 'POST' || req.url !== '/mcp') {
        res.writeHead(404).end();
        return;
      }
      const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
      const bearer = /^Bearer (.+)$/i.exec(req.headers.authorization ?? '')?.[1];
      // The header is only carried to the Authenticator port; this host verifies nothing.
      const request = Object.assign(
        req,
        bearer === undefined ? {} : { auth: { token: bearer, clientId: 'unverified', scopes: [] } },
      );
      const server = serverFactory();
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(request, res, await readJson(req));
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
}
