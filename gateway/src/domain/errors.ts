/** Why the gateway refused or could not route a call. Sent to the client as `{ code, message }`. */
export type GatewayErrorCode = 'UNKNOWN_TOOL' | 'UNAUTHORIZED' | 'QUOTA_EXCEEDED' | 'SERVICE_UNAVAILABLE';

export class GatewayError extends Error {
  constructor(
    readonly code: GatewayErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}
