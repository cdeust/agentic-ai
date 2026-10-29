/** What the caller presented to prove who they are (a bearer token, when there is one). */
export interface Presented {
  token?: string | undefined;
}

export interface Identity {
  subject: string;
}

/** Port: who is calling. Throws UnauthorizedError when what was presented is not valid. */
export interface Authenticator {
  authenticate(presented: Presented): Promise<Identity>;
}

/** Port: how much may this identity call. Throws QuotaExceededError when exhausted. */
export interface QuotaPolicy {
  consume(identity: Identity, tool: string): Promise<void>;
}

export interface AuditEntry {
  at: string;
  subject: string;
  tool: string;
  owner: string | null;
  outcome: 'ok' | 'error';
  error_code?: string;
  duration_ms: number;
}

/** Port: append-only journal of every call, allowed or refused. */
export interface AuditLog {
  record(entry: AuditEntry): Promise<void>;
}

/** What a service answered. The gateway forwards it without interpreting it. */
export interface ServiceResponse {
  structured: Record<string, unknown> | undefined;
  text: string;
  isError: boolean;
}

/** Port: call a tool on the service that owns it. */
export interface ServiceClient {
  invoke(service: string, tool: string, args: Record<string, unknown>): Promise<ServiceResponse>;
}

export interface Clock {
  now(): Date;
}
