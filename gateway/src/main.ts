import { pathToFileURL } from 'node:url';
import { TOOLS, TOOL_NAMES } from '@agentic-ai/contracts';
import { CallTool } from './application/call-tool.js';
import { ListTools } from './application/list-tools.js';
import { ToolCatalogue } from './domain/catalogue.js';
import type { AuditLog, Authenticator, Clock, QuotaPolicy, ServiceClient } from './domain/ports.js';
import { InMemoryAuthenticator, InMemoryQuota, SystemClock } from './infrastructure/in-memory.js';
import { connectMcpOverHttp } from './infrastructure/mcp-connect.js';
import { McpServiceClient } from './infrastructure/mcp-service-client.js';
import { JsonLinesAuditLog } from './infrastructure/stdout-audit-log.js';
import { createHttpHost } from './presentation/http-host.js';
import { createGatewayServer } from './presentation/mcp-server.js';

export interface GatewayDependencies {
  auth: Authenticator;
  quota: QuotaPolicy;
  services: ServiceClient;
  audit: AuditLog;
  clock: Clock;
}

/** The catalogue is derived from the shared tool contracts; the gateway owns no tool logic. */
export function buildCatalogue(): ToolCatalogue {
  return new ToolCatalogue(
    TOOL_NAMES.map((name) => ({ name, description: TOOLS[name].description, owner: TOOLS[name].owner })),
  );
}

/** Composition root. All wiring of the gateway happens here. */
export function compose(deps: GatewayDependencies) {
  const catalogue = buildCatalogue();
  const callTool = new CallTool(catalogue, deps.auth, deps.quota, deps.services, deps.audit, deps.clock);
  const listTools = new ListTools(catalogue);
  return { createServer: () => createGatewayServer(callTool, listTools) };
}

function parseTokens(raw: string): Map<string, { subject: string }> {
  // GATEWAY_TOKENS="token1=alice;token2=bob" (local development only; see docs/infrastructure.md).
  return new Map(
    raw
      .split(';')
      .filter(Boolean)
      .map((pair) => {
        const [token, subject] = pair.split('=');
        return [token ?? '', { subject: subject ?? 'unknown' }] as const;
      }),
  );
}

async function main(): Promise<void> {
  const memory = await connectMcpOverHttp(process.env['MEMORY_URL'] ?? 'http://memory:8081/mcp', 'gateway');
  const clock = new SystemClock();
  const app = compose({
    auth: new InMemoryAuthenticator(parseTokens(process.env['GATEWAY_TOKENS'] ?? '')),
    quota: new InMemoryQuota(Number(process.env['QUOTA_PER_MINUTE'] ?? 60), 60_000, clock),
    services: new McpServiceClient(new Map([['memory', memory]])),
    audit: new JsonLinesAuditLog(),
    clock,
  });
  const port = Number(process.env['PORT'] ?? 8080);
  createHttpHost(app.createServer).listen(port, () => console.warn(`gateway listening on :${port}`));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
