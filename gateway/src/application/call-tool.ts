import { TOOLS, type ToolName } from '@architect-os/contracts';
import { GatewayError } from '../domain/errors.js';
import type {
  Authenticator,
  AuditLog,
  Clock,
  Presented,
  QuotaPolicy,
  ServiceClient,
  ServiceResponse,
} from '../domain/ports.js';

export interface CallToolCommand {
  tool: string;
  args: Record<string, unknown>;
  presented: Presented;
}

/**
 * The gateway's single use case: look up the tool in the contract catalogue, authenticate, apply the quota,
 * route to the owner, journal. It never interprets the payload and runs no agent.
 */
export class CallTool {
  constructor(
    private readonly auth: Authenticator,
    private readonly quota: QuotaPolicy,
    private readonly services: ServiceClient,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(command: CallToolCommand): Promise<ServiceResponse> {
    const started = this.clock.now();
    const descriptor = Object.hasOwn(TOOLS, command.tool) ? TOOLS[command.tool as ToolName] : undefined;
    let subject = 'anonymous';
    try {
      if (descriptor === undefined) throw new GatewayError('UNKNOWN_TOOL', `unknown tool ${command.tool}`);
      const identity = await this.auth.authenticate(command.presented);
      subject = identity.subject;
      await this.quota.consume(identity, command.tool);
      const response = await this.services.invoke(descriptor.owner, command.tool, command.args);
      await this.journal(started, subject, command.tool, descriptor.owner, 'ok');
      return response;
    } catch (error) {
      const code = error instanceof GatewayError ? error.code : 'INTERNAL';
      await this.journal(started, subject, command.tool, descriptor?.owner ?? null, 'error', code);
      throw error;
    }
  }

  private journal(
    started: Date,
    subject: string,
    tool: string,
    owner: string | null,
    outcome: 'ok' | 'error',
    errorCode?: string,
  ): Promise<void> {
    return this.audit.record({
      at: started.toISOString(),
      subject,
      tool,
      owner,
      outcome,
      ...(errorCode === undefined ? {} : { error_code: errorCode }),
      duration_ms: this.clock.now().getTime() - started.getTime(),
    });
  }
}
