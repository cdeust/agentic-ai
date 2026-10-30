// T-42 / T-43 : broker avec autorisation de task (docs/design/platform-v3-srt.md §11.2), amont enregistreur et certificat de banc.
// Aucune cle reelle : la cle "amont" et l'autorisation sont generees a l'execution. Le broker du banc reste bufferise (1b.2 : en flux).
import { execFile } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { maskValue } from './common.ts';

/** Autorisation de task : 256 bits aleatoires (§11.2), masquee dans les rapports. */
export const newLease = (): string => {
  const l = randomBytes(32).toString('hex');
  maskValue(l);
  return l;
};

export interface Pki {
  certPath: string;
  keyPath: string;
  cert: string;
  key: string;
  opensslVersion: string;
}
/** Certificat auto-signe pour broker.localhost et evil.localhost. L'hote (processus srt) le fait approuver par NODE_EXTRA_CA_CERTS. */
export async function makePki(dir: string): Promise<Pki> {
  const keyPath = path.join(dir, 'broker.key.pem');
  const certPath = path.join(dir, 'broker.cert.pem');
  const run = promisify(execFile);
  await run('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', keyPath, '-out', certPath, '-days', '2', '-subj', '/CN=broker.localhost', '-addext', 'subjectAltName=DNS:broker.localhost,DNS:evil.localhost', '-addext', 'basicConstraints=critical,CA:TRUE']);
  const v = await run('openssl', ['version']);
  return { certPath, keyPath, cert: readFileSync(certPath, 'utf8'), key: readFileSync(keyPath, 'utf8'), opensslVersion: v.stdout.trim() };
}

export interface RecordedReq {
  method: string;
  url: string;
  rawHeaders: string[];
  body: string;
}
/** Ou une valeur apparait dans une requete recue par l'amont : noms et valeurs d'en-tetes, url, corps. */
export function placements(r: RecordedReq, secret: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < r.rawHeaders.length; i += 2) {
    if ((r.rawHeaders[i + 1] ?? '').includes(secret)) out.push(`header:${(r.rawHeaders[i] ?? '').toLowerCase()}`);
    if ((r.rawHeaders[i] ?? '').includes(secret)) out.push('header-name');
  }
  if (r.url.includes(secret)) out.push('url');
  if (r.body.includes(secret)) out.push('body');
  return out;
}

export interface RecordingUpstream {
  port: number;
  log: RecordedReq[];
  close: () => void;
}
const fragment = (s: string, n: number): string[] => {
  const parts: string[] = [];
  for (let i = 0; i < s.length; i += n) parts.push(s.slice(i, i + n));
  return parts;
};
/** Amont enregistreur et reflechissant. Il renvoie, sous des formes variees, la valeur de x-api-key qu'il a recue
 * (c'est-a-dire ce que le broker lui a transmis). /v1/messages : 200 ordinaire. */
export function startRecordingUpstream(): Promise<RecordingUpstream> {
  const log: RecordedReq[] = [];
  const srv = http.createServer((q, r) => {
    let body = '';
    q.on('data', (d: Buffer) => (body += d.toString()));
    q.on('end', () => {
      void (async () => {
        log.push({ method: q.method ?? '', url: q.url ?? '', rawHeaders: [...q.rawHeaders], body });
        const k = String(q.headers['x-api-key'] ?? '');
        const route = (q.url ?? '').split('?')[0] ?? '';
        const json = (o: unknown, h: http.OutgoingHttpHeaders = {}): void => {
          r.writeHead(200, { 'content-type': 'application/json', ...h });
          r.end(JSON.stringify(o));
        };
        if (route === '/v1/messages/reflect-plain') return json({ reflected: k }, { 'x-echo-key': k });
        if (route === '/v1/messages/reflect-base64') return json({ reflected: Buffer.from(k).toString('base64') });
        if (route === '/v1/messages/reflect-hex') return json({ reflected: Buffer.from(k).toString('hex') });
        if (route === '/v1/messages/reflect-two-chunks') {
          // La valeur est coupee en deux ecritures espacees ; un retrait bufferise la revoit entiere.
          r.writeHead(200, { 'content-type': 'application/json' });
          r.write(`{"reflected":"${k.slice(0, 20)}`);
          await new Promise((x) => setTimeout(x, 150));
          r.end(`${k.slice(20)}"}`);
          return;
        }
        if (route === '/v1/messages/reflect-sse-split') {
          // Flux SSE : la valeur est repartie sur des evenements distincts ; la chaine n'existe nulle part dans les octets.
          r.writeHead(200, { 'content-type': 'text/event-stream' });
          for (const part of fragment(k, 8)) {
            r.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: part } })}\n\n`);
            await new Promise((x) => setTimeout(x, 15));
          }
          r.end('event: message_stop\ndata: {"type":"message_stop"}\n\n');
          return;
        }
        if (route.startsWith('/v1/messages')) return json({ id: 'msg', type: 'message', content: [{ type: 'text', text: 'ok' }] });
        r.writeHead(404);
        r.end();
      })();
    });
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ port: (srv.address() as AddressInfo).port, log, close: () => srv.close() })));
}

export interface LeaseBrokerOpts {
  upstreamPort: number;
  /** Cle reelle (du banc) posee par le broker dans le seul x-api-key amont. */
  key: string;
  /** Autorisation de la task, comparee en temps constant a chaque requete. */
  lease: string;
  pki?: Pki;
  /** Retrait des valeurs dans la reponse : defense supplementaire (litteral, corps bufferise). */
  filter?: boolean;
}
export interface Decision {
  status: number;
  reason: string;
  forwarded: boolean;
}
export interface LeaseBroker {
  port: number;
  decisions: Decision[];
  close: () => void;
}
const digest = (s: string): Buffer => createHash('sha256').update(s).digest();
/** Comparaison en temps constant : les deux cotes sont ramenes a 32 octets avant timingSafeEqual. */
export const leaseMatches = (given: string | undefined, lease: string): boolean => given !== undefined && timingSafeEqual(digest(given), digest(lease));
const AUTH_HEADERS = new Set(['authorization', 'proxy-authorization', 'x-api-key', 'cookie', 'host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'upgrade', 'te', 'trailer']);

/** Le broker construit lui-meme la requete amont : en-tetes du client sauf authentification, x-api-key = cle reelle seule, corps tel quel. */
export function startLeaseBroker(o: LeaseBrokerOpts): Promise<LeaseBroker> {
  const decisions: Decision[] = [];
  const reply = (r: http.ServerResponse, status: number, reason: string, forwarded = false): void => {
    decisions.push({ status, reason, forwarded });
    r.writeHead(status, { 'content-type': 'application/json' });
    r.end(JSON.stringify({ error: reason }));
  };
  const handler = (q: http.IncomingMessage, r: http.ServerResponse): void => {
    const chunks: Buffer[] = [];
    let size = 0;
    q.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= 8_000_000) chunks.push(c);
    });
    q.on('end', () => {
      const body = Buffer.concat(chunks);
      const given = q.headers['x-api-key'];
      const givenStr = Array.isArray(given) ? given[0] : given;
      // 1. L'autorisation d'abord : un appelant sans elle n'obtient rien, pas meme le test du chemin.
      const elsewhere =
        (q.url ?? '').includes(o.lease) ||
        body.includes(o.lease) ||
        q.rawHeaders.some((h, i) => !(i % 2 === 1 && (q.rawHeaders[i - 1] ?? '').toLowerCase() === 'x-api-key') && h.includes(o.lease));
      if (!leaseMatches(givenStr, o.lease)) return reply(r, elsewhere ? 403 : 401, elsewhere ? 'LEASE_OUT_OF_PLACE' : 'LEASE_INVALID');
      // 2. L'autorisation ailleurs que dans x-api-key (corps, autre en-tete, url) : refus, rien n'est transmis.
      const dup = q.rawHeaders.filter((h, i) => i % 2 === 0 && h.toLowerCase() === 'x-api-key').length > 1;
      if (elsewhere || dup) return reply(r, 403, 'LEASE_OUT_OF_PLACE');
      if (q.method !== 'POST' || !(q.url ?? '').startsWith('/v1/messages')) return reply(r, 403, 'ROUTE_REFUSED');
      // 3. Construction de la requete amont.
      const headers: http.OutgoingHttpHeaders = {};
      for (let i = 0; i < q.rawHeaders.length; i += 2) {
        const n = (q.rawHeaders[i] ?? '').toLowerCase();
        if (!AUTH_HEADERS.has(n)) headers[n] = q.rawHeaders[i + 1];
      }
      headers['x-api-key'] = o.key;
      headers['content-length'] = String(body.length);
      const up = http.request({ host: '127.0.0.1', port: o.upstreamPort, path: q.url, method: 'POST', headers }, (u) => {
        const parts: Buffer[] = [];
        u.on('data', (c: Buffer) => parts.push(c));
        u.on('end', () => {
          const h: http.OutgoingHttpHeaders = {};
          const strip = (s: string): string => (o.filter === false ? s : s.split(o.key).join('[retire]').split(o.lease).join('[retire]'));
          for (const [k, v] of Object.entries(u.headers)) if (k !== 'content-length' && k !== 'transfer-encoding') h[k] = strip(Array.isArray(v) ? v.join(',') : String(v ?? ''));
          decisions.push({ status: u.statusCode ?? 502, reason: 'FORWARDED', forwarded: true });
          r.writeHead(u.statusCode ?? 502, h);
          r.end(strip(Buffer.concat(parts).toString('utf8')));
        });
      });
      up.on('error', () => reply(r, 502, 'UPSTREAM_ERROR', true));
      up.end(body);
    });
  };
  const srv = o.pki ? https.createServer({ key: o.pki.key, cert: o.pki.cert }, handler) : http.createServer(handler);
  // '::' : broker.localhost se resout en ::1 (macOS) ou 127.0.0.1 ; la double pile couvre les deux.
  return new Promise((resolve) => srv.listen(0, '::', () => resolve({ port: (srv.address() as AddressInfo).port, decisions, close: () => srv.close() })));
}

/** Puits de l'hote : enregistre ce que recoit un hote qui n'est pas le broker (T-04 f, g, i, j rejoues pour l'autorisation). */
export function startSink(pki: Pki | undefined): Promise<{ port: number; log: RecordedReq[]; close: () => void }> {
  const log: RecordedReq[] = [];
  const handler = (q: http.IncomingMessage, r: http.ServerResponse): void => {
    let body = '';
    q.on('data', (d: Buffer) => (body += d.toString()));
    q.on('end', () => {
      log.push({ method: q.method ?? '', url: q.url ?? '', rawHeaders: [...q.rawHeaders], body });
      r.writeHead(200, { 'content-type': 'text/plain' });
      r.end('puits');
    });
  };
  const srv = pki ? https.createServer({ key: pki.key, cert: pki.cert }, handler) : http.createServer(handler);
  return new Promise((resolve) => srv.listen(0, '::', () => resolve({ port: (srv.address() as AddressInfo).port, log, close: () => srv.close() })));
}

/** Ce qu'un client recoit est-il trivialement reconstructible en la valeur ? Litteral, base64, hex, fragments recolles (SSE et JSON). */
export function recoverable(received: string, secret: string): string[] {
  const how: string[] = [];
  if (received.includes(secret)) how.push('litteral');
  const compact = received.replace(/[^A-Za-z0-9_\-+/=]/g, '');
  const sseText = [...received.matchAll(/"text":"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1] ?? '').join('');
  if (sseText.includes(secret)) how.push('flux-recolle');
  for (const token of received.match(/[A-Za-z0-9+/=_-]{16,}/g) ?? []) {
    try {
      if (Buffer.from(token, 'base64').toString('utf8').includes(secret)) how.push('base64');
      if (/^[0-9a-f]+$/i.test(token) && Buffer.from(token, 'hex').toString('utf8').includes(secret)) how.push('hex');
    } catch {
      /* jeton non decodable */
    }
  }
  if (compact.includes(secret) && !how.includes('litteral')) how.push('litteral-apres-nettoyage');
  return [...new Set(how)];
}

export const writeText = (p: string, s: string): void => writeFileSync(p, s);
