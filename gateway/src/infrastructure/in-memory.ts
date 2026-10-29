import { QuotaExceededError, ServiceUnavailableError, UnauthorizedError } from '../domain/errors.js';
import type {
  AuditEntry,
  AuditLog,
  Authenticator,
  Clock,
  Identity,
  Presented,
  QuotaPolicy,
  ServiceClient,
  ServiceResponse,
} from '../domain/ports.js';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Authenticator backed by a token table. Local development and tests; swap for an identity provider adapter in production. */
export class InMemoryAuthenticator implements Authenticator {
  constructor(private readonly tokens: ReadonlyMap<string, Identity>) {}

  async authenticate(presented: Presented): Promise<Identity> {
    const identity = presented.token === undefined ? undefined : this.tokens.get(presented.token);
    if (identity === undefined) throw new UnauthorizedError();
    return identity;
  }
}

/** Fixed-window quota kept in this process. */
export class InMemoryQuota implements QuotaPolicy {
  private readonly windows = new Map<string, { start: number; used: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly clock: Clock,
  ) {}

  async consume(identity: Identity, tool: string): Promise<void> {
    const key = `${identity.subject}:${tool}`;
    const now = this.clock.now().getTime();
    const current = this.windows.get(key);
    const window =
      current !== undefined && now - current.start < this.windowMs ? current : { start: now, used: 0 };
    if (window.used >= this.limit) throw new QuotaExceededError(identity.subject, tool);
    window.used += 1;
    this.windows.set(key, window);
  }
}

export class InMemoryAuditLog implements AuditLog {
  readonly entries: AuditEntry[] = [];

  async record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<ServiceResponse>;

/** ServiceClient that dispatches to in-process handlers keyed by "service/tool". */
export class InMemoryServiceClient implements ServiceClient {
  constructor(private readonly handlers: ReadonlyMap<string, ToolHandler>) {}

  async invoke(service: string, tool: string, args: Record<string, unknown>): Promise<ServiceResponse> {
    const handler = this.handlers.get(`${service}/${tool}`);
    if (handler === undefined) throw new ServiceUnavailableError(service, `no handler for ${tool}`);
    return handler(args);
  }
}
