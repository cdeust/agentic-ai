import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { InternalToolService } from '../application/internal-tools.js';

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

/**
 * Internal tool endpoint for workers: POST /internal/<tool> for each tool of INTERNAL_TOOLS this service owns.
 * Reachable only from the exec network (see docs/infrastructure.md).
 */
export function createInternalToolsHost(tools: InternalToolService): Server {
  return createServer((req, res) => {
    void (async () => {
      const send = (status: number, body: unknown) =>
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      if (req.method === 'GET' && req.url === '/healthz') return send(200, { ok: true });
      const name = /^\/internal\/([a-z_]+)$/.exec(req.url ?? '')?.[1];
      if (req.method !== 'POST' || name === undefined) return send(404, { error: 'not found' });
      const answer = await tools.call(name, await readJson(req));
      return answer.ok ? send(200, answer.value) : send(answer.status, { error: answer.message });
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
}
