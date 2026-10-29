export abstract class GatewayError extends Error {
  abstract readonly code: string;
}

export class UnknownToolError extends GatewayError {
  readonly code = 'UNKNOWN_TOOL';
  constructor(tool: string) {
    super(`unknown tool ${tool}`);
  }
}

export class UnauthorizedError extends GatewayError {
  readonly code = 'UNAUTHORIZED';
  constructor(message = 'missing or invalid token') {
    super(message);
  }
}

export class QuotaExceededError extends GatewayError {
  readonly code = 'QUOTA_EXCEEDED';
  constructor(subject: string, tool: string) {
    super(`quota exceeded for ${subject} on ${tool}`);
  }
}

export class ServiceUnavailableError extends GatewayError {
  readonly code = 'SERVICE_UNAVAILABLE';
  constructor(service: string, detail: string) {
    super(`service ${service} unavailable: ${detail}`);
  }
}
