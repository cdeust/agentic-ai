import { createServer, type IncomingMessage, type Server } from 'node:http';
import { z } from 'zod';
import type { InternalToolService } from '../application/internal-tools.js';

const SearchBody = z.object({ query: z.string(), limit: z.number().int().min(1).max(50).default(5) });
const InsertBody = z.object({ content: z.string().min(1), tags: z.array(z.string()).default([]) });

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

/**
 * Internal tool endpoint for workers: POST /internal/memory.search and /internal/memory.insert.
 * Reachable only from the exec network (see docs/infrastructure.md).
 */
export function createInternalToolsHost(tools: InternalToolService): Server {
  return createServer((req, res) => {
    void (async () => {
      const send = (status: number, body: unknown) =>
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      if (req.method === 'GET' && req.url === '/healthz') return send(200, { ok: true });
      if (req.method !== 'POST') return send(404, { error: 'not found' });
      if (req.url === '/internal/memory.search') {
        const body = SearchBody.safeParse(await readJson(req));
        return body.success
          ? send(200, await tools.search(body.data.query, body.data.limit))
          : send(400, { error: body.error.message });
      }
      if (req.url === '/internal/memory.insert') {
        const body = InsertBody.safeParse(await readJson(req));
        return body.success
          ? send(200, await tools.insert(body.data.content, body.data.tags))
          : send(400, { error: body.error.message });
      }
      return send(404, { error: 'not found' });
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
}
