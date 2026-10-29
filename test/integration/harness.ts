import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Run, RunEvent } from '@agentic-ai/contracts';
import { composeInMemory as composeData } from '../../data/src/main.js';
import { compose as composeGateway } from '../../gateway/src/main.js';
import {
  InMemoryAuditLog,
  InMemoryAuthenticator,
  InMemoryQuota,
  SystemClock,
} from '../../gateway/src/infrastructure/in-memory.js';
import { McpServiceClient } from '../../gateway/src/infrastructure/mcp-service-client.js';
import { InProcessContainerRunner } from '../../services/memory/src/infrastructure/in-process-runner.js';
import { HttpDataClient } from '../../services/memory/src/infrastructure/data-client.js';
import { compose as composeMemory, DEFAULT_LIMITS } from '../../services/memory/src/main.js';
import type { AgentPort, AgentRequest } from '../../services/memory/worker/agent-port.js';
import { runWorker } from '../../services/memory/worker/run-worker.js';

export const TOKEN = 'test-token';

async function linked(
  server: { connect(t: InMemoryTransport): Promise<void> },
  name: string,
  token?: string,
) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  if (token !== undefined) {
    const send = clientSide.send.bind(clientSide);
    clientSide.send = (message, options) =>
      send(message, { ...options, authInfo: { token, clientId: name, scopes: [] } });
  }
  await server.connect(serverSide);
  const client = new Client({ name, version: '0.0.0' });
  await client.connect(clientSide);
  await client.listTools();
  return client;
}

/**
 * Wires the whole call path in one process, with real MCP between every pair of components:
 * client -> gateway -> memory service -> (in-process worker with a scripted agent) and memory -> data (in memory).
 * No container, no network, no call to Anthropic.
 */
export async function buildStack(agent: AgentPort) {
  const data = composeData();
  const dataApi = data.createServer();
  await new Promise<void>((resolve) => dataApi.listen(0, '127.0.0.1', resolve));
  const dataClient = new HttpDataClient(`http://127.0.0.1:${(dataApi.address() as AddressInfo).port}`);

  // The worker's tools are served by the memory service; here the agent reaches them in process.
  const memory = composeMemory({
    registry: dataClient,
    store: dataClient,
    runner: new InProcessContainerRunner((stdin) =>
      runWorker(stdin, {
        agent,
        tools: {
          search: (query, limit) => memoryRef.internalTools.search(query, limit),
          insert: (content, tags) => memoryRef.internalTools.insert(content, tags),
        },
      }),
    ),
    limits: DEFAULT_LIMITS,
  });
  const memoryRef = memory;

  const clock = new SystemClock();
  const audit = new InMemoryAuditLog();
  const gateway = composeGateway({
    auth: new InMemoryAuthenticator(new Map([[TOKEN, { subject: 'alice' }]])),
    quota: new InMemoryQuota(10, 60_000, clock),
    services: new McpServiceClient(
      new Map([['memory', await linked(memory.createServer(), 'gateway-to-memory')]]),
    ),
    audit,
    clock,
  });
  const client = await linked(gateway.createServer(), 'test-client', TOKEN);

  return {
    client,
    audit,
    close: () => dataApi.close(),
    async run(runId: string): Promise<{ run: Run; events: RunEvent[] }> {
      return {
        run: (await data.operations.execute('runs.get', { run_id: runId })) as Run,
        events: (await data.operations.execute('runs.events', { run_id: runId })) as RunEvent[],
      };
    },
  };
}

const COST = { input_tokens: 12, output_tokens: 7, usd: 0.0004 };

/** Scripted agent standing in for the Claude Agent SDK. */
export function scriptedAgent(script: (request: AgentRequest) => Promise<unknown>): AgentPort {
  return {
    async run(request) {
      const structured = await script(request);
      return { structured, evidence: [{ source: 'memory', ref: 'scripted' }], cost: COST };
    },
  };
}
