import { execFile } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse,
} from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { AddressInfo } from 'node:net';
import { dirname } from 'node:path';

/**
 * Proxy d'authentification de l'outil 1a.0, natif, hors sandbox, sur 127.0.0.1. Seul détenteur de l'identifiant
 * Claude de l'hôte : il le lit à la demande (trousseau), le garde en mémoire, ne l'écrit ni ne le journalise jamais.
 * La sandbox ne connaît qu'un jeton de session aléatoire, refusé hors de la session (401) ; seules les routes
 * listées passent, en POST (403 sinon), vers l'amont fixe, avec l'`Authorization` remplacé. Une ligne d'`usage`
 * par réponse (modèle, tokens, horodatage), sans contenu.
 *
 * Pas de renouvellement OAuth ici : le jeton de rafraîchissement tourne à chaque usage, et le renouveler hors de
 * Claude Code sur l'hôte invaliderait la connexion de l'hôte. Le proxy relit le trousseau quand le jeton
 * approche de l'expiration ; une session Claude Code de l'hôte le renouvelle.
 */
export interface Credential {
  readonly accessToken: string;
  /** Millisecondes depuis l'époque, si connu. */
  readonly expiresAt?: number;
}
export type CredentialSource = () => Promise<Credential>;

export interface AuthProxyOptions {
  readonly upstream: string;
  /** Expressions régulières sur le chemin et la requête ; méthode POST seulement. */
  readonly routes: readonly string[];
  readonly sessionToken: string;
  readonly credential: CredentialSource;
  /** Valeurs `anthropic-beta` exigées par l'identifiant (OAuth). */
  readonly betas: readonly string[];
  readonly usageLog?: string;
}

export interface AuthProxy {
  readonly port: number;
  /** Le jeton de session ne vaut plus rien : 401. */
  revoke(): void;
  close(): Promise<void>;
}

export interface UsageRecord {
  at: string;
  status: number;
  /** Chemin de la route relayée, sans requête. */
  route?: string;
  /** `error.type` d'une réponse en erreur ; jamais le message. */
  error_type?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

const HOP_BY_HOP = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'authorization',
  'x-api-key',
  'accept-encoding',
]);
const USAGE_BUFFER_LIMIT = 4 * 1024 * 1024;

const sameSecret = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const fail = (res: ServerResponse, status: number, type: string, message: string): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ type: 'error', error: { type, message } }));
};

function forwardHeaders(headers: IncomingHttpHeaders, token: string, betas: readonly string[]) {
  const out: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers))
    if (value !== undefined && !HOP_BY_HOP.has(name)) out[name] = value;
  const present = String(headers['anthropic-beta'] ?? '')
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean);
  const merged = [...present, ...betas.filter((b) => !present.includes(b))];
  if (merged.length > 0) out['anthropic-beta'] = merged.join(',');
  out['authorization'] = `Bearer ${token}`;
  out['accept-encoding'] = 'identity';
  return out;
}

/** Extrait modèle et tokens d'une réponse JSON ou SSE de l'API Messages ; jamais le contenu. */
export function usageOf(contentType: string, body: string): Omit<UsageRecord, 'at' | 'status'> {
  const pick = (u: Record<string, unknown> | undefined) => {
    const out: Record<string, number> = {};
    for (const key of [
      'input_tokens',
      'output_tokens',
      'cache_read_input_tokens',
      'cache_creation_input_tokens',
    ])
      if (typeof u?.[key] === 'number') out[key] = u[key] as number;
    return out;
  };
  try {
    if (contentType.includes('text/event-stream')) {
      let record: Omit<UsageRecord, 'at' | 'status'> = {};
      for (const line of body.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const event = JSON.parse(line.slice(5)) as {
          type?: string;
          message?: { model?: string; usage?: Record<string, unknown> };
          usage?: Record<string, unknown>;
        };
        if (event.type === 'message_start')
          record = { ...record, model: event.message?.model, ...pick(event.message?.usage) };
        if (event.type === 'message_delta') record = { ...record, ...pick(event.usage) };
      }
      return record;
    }
    const json = JSON.parse(body) as {
      model?: string;
      usage?: Record<string, unknown>;
      error?: { type?: unknown };
    };
    return {
      ...(json.model ? { model: json.model } : {}),
      ...(typeof json.error?.type === 'string' ? { error_type: json.error.type } : {}),
      ...pick(json.usage),
    };
  } catch {
    return {};
  }
}

export async function startAuthProxy(options: AuthProxyOptions): Promise<AuthProxy> {
  const upstream = new URL(options.upstream);
  const routes = options.routes.map((r) => new RegExp(r));
  const send = upstream.protocol === 'https:' ? httpsRequest : httpRequest;
  let revoked = false;

  const log = (record: UsageRecord) => {
    if (options.usageLog === undefined) return;
    mkdirSync(dirname(options.usageLog), { recursive: true, mode: 0o700 });
    appendFileSync(options.usageLog, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const presented = String(req.headers['authorization'] ?? '');
    if (revoked || !sameSecret(presented, `Bearer ${options.sessionToken}`))
      return fail(res, 401, 'authentication_error', 'session token required');
    const path = req.url ?? '/';
    if (req.method !== 'POST' || !routes.some((r) => r.test(path)))
      return fail(res, 403, 'permission_error', 'route refused by the auth proxy');
    let credential: Credential;
    try {
      credential = await options.credential();
    } catch {
      return fail(res, 503, 'api_error', 'host credential unavailable: sign in with claude on the host');
    }
    const outgoing = send(
      new URL(path, upstream),
      { method: 'POST', headers: forwardHeaders(req.headers, credential.accessToken, options.betas) },
      (up) => {
        const headers: OutgoingHttpHeaders = {};
        for (const [name, value] of Object.entries(up.headers))
          if (value !== undefined && !HOP_BY_HOP.has(name)) headers[name] = value;
        res.writeHead(up.statusCode ?? 502, headers);
        let body = '';
        up.on('data', (chunk: Buffer) => {
          if (body.length < USAGE_BUFFER_LIMIT) body += chunk.toString('utf8');
          res.write(chunk);
        });
        up.on('end', () => {
          res.end();
          log({
            at: new Date().toISOString(),
            status: up.statusCode ?? 0,
            route: path.split('?')[0] ?? path,
            ...usageOf(String(up.headers['content-type'] ?? ''), body),
          });
        });
        up.on('error', () => res.destroy());
      },
    );
    outgoing.on('error', () => {
      if (!res.headersSent) fail(res, 502, 'api_error', 'upstream unreachable');
      else res.destroy();
    });
    req.pipe(outgoing);
  };

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) fail(res, 500, 'api_error', 'auth proxy error');
    });
  });
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  return {
    port: (server.address() as AddressInfo).port,
    revoke: () => {
      revoked = true;
    },
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

/**
 * Lit l'identifiant comme Claude Code sur l'hôte : la commande du trousseau rend le JSON
 * `{ claudeAiOauth: { accessToken, expiresAt } }`. Relu quand l'expiration approche ; rien n'est écrit.
 * Une erreur ne porte jamais la sortie de la commande.
 */
export function commandCredential(argv: readonly string[], marginMs = 60_000): CredentialSource {
  let cached: Credential | undefined;
  const fresh = (c: Credential | undefined): c is Credential =>
    c !== undefined && (c.expiresAt === undefined || c.expiresAt - Date.now() > marginMs);
  const read = () =>
    new Promise<Credential>((done, reject) => {
      const [command, ...args] = argv;
      if (command === undefined) return reject(new Error('credential command empty'));
      execFile(command, args, { timeout: 10_000, maxBuffer: 64 * 1024 }, (error, stdout) => {
        if (error) return reject(new Error('credential command failed'));
        try {
          const oauth = (
            JSON.parse(stdout) as { claudeAiOauth?: { accessToken?: unknown; expiresAt?: unknown } }
          ).claudeAiOauth;
          if (typeof oauth?.accessToken !== 'string')
            return reject(new Error('credential has no access token'));
          done({
            accessToken: oauth.accessToken,
            ...(typeof oauth.expiresAt === 'number' ? { expiresAt: oauth.expiresAt } : {}),
          });
        } catch {
          reject(new Error('credential is not JSON'));
        }
      });
    });
  return async () => {
    if (fresh(cached)) return cached;
    cached = await read();
    if (!fresh(cached)) throw new Error('host credential expired');
    return cached;
  };
}
