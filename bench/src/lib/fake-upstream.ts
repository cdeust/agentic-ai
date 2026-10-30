// Faux amont Anthropic local (HTTP clair, 127.0.0.1) et broker par task. Aucun appel reel, aucune cle reelle.
// Le broker est un modele de banc de ce que sera modules/broker (1b.2) : le port est l'identite, la cle est posee ici.
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface UpstreamReq {
  method: string;
  path: string;
  key: string | undefined;
  auth: string | undefined;
  body: string;
}
export interface Upstream {
  port: number;
  log: UpstreamReq[];
  close: () => void;
}

const start = {
  type: 'message_start',
  message: { id: 'm', type: 'message', role: 'assistant', model: 'mock', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } },
};
type Ev = [string, unknown];
const toolUse = (id: string, name: string, input: unknown): Ev[] => [
  ['message_start', start],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name, input: {} } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } }],
  ['message_stop', { type: 'message_stop' }],
];
const text = (t: string): Ev[] => [
  ['message_start', start],
  ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
  ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } }],
  ['content_block_stop', { type: 'content_block_stop', index: 0 }],
  ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } }],
  ['message_stop', { type: 'message_stop' }],
];
const sse = (res: http.ServerResponse, evs: Ev[]): void => {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const [e, d] of evs) res.write(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`);
  res.end();
};

export interface UpstreamOpts {
  /** Appele a l'arrivee de chaque POST /v1/messages, avant la reponse. */
  onMessages?: (body: string) => void;
  /** Delai avant reponse quand le corps contient LENT. */
  slowMs?: number;
}

/** Faux amont. POST /v1/messages : 1er tour = appel de l'outil mcp__platform__memory_search, 2e tour = texte "fin".
 * POST /v1/messages/reflect : amont malveillant qui renvoie l'en-tete x-api-key dans les en-tetes et le corps. */
export function startUpstream(o: UpstreamOpts = {}): Promise<Upstream> {
  const log: UpstreamReq[] = [];
  const srv = http.createServer((q, r) => {
    let body = '';
    q.on('data', (d: Buffer) => (body += d.toString()));
    q.on('end', () => {
      void (async () => {
        const urlPath = (q.url ?? '').split('?')[0] ?? '';
        const key = q.headers['x-api-key'];
        const auth = q.headers['authorization'];
        log.push({ method: q.method ?? '', path: urlPath, key: Array.isArray(key) ? key[0] : key, auth: Array.isArray(auth) ? auth[0] : auth, body });
        if (urlPath.endsWith('/reflect')) {
          r.writeHead(200, { 'content-type': 'application/json', 'x-echo-key': String(key ?? '') });
          r.end(JSON.stringify({ reflected: key ?? null }));
          return;
        }
        if (urlPath.includes('count_tokens')) {
          r.writeHead(200, { 'content-type': 'application/json' });
          r.end('{"input_tokens":1}');
          return;
        }
        if (q.method === 'POST' && urlPath.startsWith('/v1/messages')) {
          o.onMessages?.(body);
          if (body.includes('LENT')) await new Promise((x) => setTimeout(x, o.slowMs ?? 800));
          if (!body.includes('tool_result')) return sse(r, toolUse('toolu_1', 'mcp__platform__memory_search', { query: 'q' }));
          return sse(r, text('fin'));
        }
        r.writeHead(404);
        r.end();
      })();
    });
  });
  return new Promise((resolve) =>
    srv.listen(0, '127.0.0.1', () =>
      resolve({ port: (srv.address() as AddressInfo).port, log, close: () => srv.close() }),
    ),
  );
}

export type Sanitize = 'none' | 'keep-length' | 'full';
export interface Broker {
  port: number;
  /** Requetes POST /v1/messages* transmises a l'amont. */
  count: () => number;
  /** Valeur de x-api-key recue des clients (avant remplacement). */
  clientKeys: string[];
  close: () => void;
}

export function startBroker(o: { upstreamPort: number; key: string; sanitize?: Sanitize }): Promise<Broker> {
  const sanitize = o.sanitize ?? 'full';
  let requests = 0;
  const clientKeys: string[] = [];
  const srv = http.createServer((q, r) => {
    if (q.method !== 'POST' || !(q.url ?? '').startsWith('/v1/messages')) {
      r.writeHead(403);
      r.end('refuse par le broker');
      return;
    }
    requests++;
    const ck = q.headers['x-api-key'];
    clientKeys.push(String(ck));
    const headers: http.OutgoingHttpHeaders = { ...q.headers, host: `127.0.0.1:${o.upstreamPort}`, 'x-api-key': o.key };
    delete headers['authorization'];
    const up = http.request({ host: '127.0.0.1', port: o.upstreamPort, path: q.url, method: 'POST', headers }, (u) => {
      if (sanitize === 'none') {
        r.writeHead(u.statusCode ?? 502, u.headers);
        u.pipe(r);
        return;
      }
      const chunks: Buffer[] = [];
      u.on('data', (c: Buffer) => chunks.push(c));
      u.on('end', () => {
        const h: http.OutgoingHttpHeaders = {};
        for (const [k, v] of Object.entries(u.headers)) {
          const s = Array.isArray(v) ? v.join(',') : String(v ?? '');
          h[k] = s.split(o.key).join('[retire]');
        }
        const out = Buffer.from(Buffer.concat(chunks).toString('utf8').split(o.key).join('[retire]'));
        if (sanitize === 'full') {
          delete h['content-length'];
          delete h['transfer-encoding'];
        }
        // 'keep-length' : le defaut ecrit dans E-05c, content-length conserve alors que le corps a change de taille.
        r.writeHead(u.statusCode ?? 502, h);
        r.end(out);
      });
    });
    up.on('error', () => {
      r.writeHead(502);
      r.end();
    });
    q.pipe(up);
  });
  return new Promise((resolve) =>
    srv.listen(0, '127.0.0.1', () =>
      resolve({ port: (srv.address() as AddressInfo).port, count: () => requests, clientKeys, close: () => srv.close() }),
    ),
  );
}
