import { createServer, type IncomingMessage, type Server } from 'node:http';
import { DATA_OP_NAMES, type DataOpName } from '@agentic-ai/contracts';
import type { DataOperations } from '../application/operations.js';

const STATUS_BY_CODE: Record<string, number> = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  INVALID_OPERATION: 409,
};

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw === '' ? {} : JSON.parse(raw);
}

/**
 * Internal HTTP API of the data component: GET /healthz and POST /v1/ops/<operation>.
 * One route per typed operation; there is no route that accepts SQL.
 */
export function createDataApi(operations: DataOperations): Server {
  return createServer((req, res) => {
    const send = (status: number, body: unknown) =>
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    void (async () => {
      if (req.method === 'GET' && req.url === '/healthz') return send(200, { ok: true });
      const op = /^\/v1\/ops\/([A-Za-z.]+)$/.exec(req.url ?? '')?.[1];
      if (req.method !== 'POST' || op === undefined || !(DATA_OP_NAMES as string[]).includes(op)) {
        return send(404, { code: 'NOT_FOUND', message: 'no such operation' });
      }
      let body: unknown;
      try {
        body = await readJson(req);
      } catch {
        return send(400, { code: 'INVALID_INPUT', message: 'body is not JSON' });
      }
      try {
        return send(200, await operations.execute(op as DataOpName, body));
      } catch (error) {
        const named = error as { code?: string; message?: string };
        return send(STATUS_BY_CODE[named.code ?? ''] ?? 500, {
          code: named.code ?? 'INTERNAL',
          message: named.code === undefined ? 'internal error' : (named.message ?? ''),
        });
      }
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
}
