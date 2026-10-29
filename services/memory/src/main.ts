import { pathToFileURL } from 'node:url';
import { IntentService } from './application/intent-service.js';
import { InternalToolService } from './application/internal-tools.js';
import type { ContainerRunner, DataPort, RunRegistry, WorkerLimits } from './domain/ports.js';
import { HttpDataClient } from './infrastructure/data-client.js';
import { DockerContainerRunner } from './infrastructure/docker-runner.js';
import { createHttpHost } from './presentation/http-host.js';
import { createInternalToolsHost } from './presentation/internal-http.js';
import { createMemoryServer } from './presentation/mcp-server.js';

export interface MemoryDependencies {
  registry: RunRegistry;
  data: DataPort;
  runner: ContainerRunner;
  limits: WorkerLimits;
}

export const DEFAULT_LIMITS: WorkerLimits = { timeoutMs: 120_000, maxTurns: 8, maxBudgetUsd: 0.5 };

/** Composition root. All wiring of the memory service happens here. */
export function compose(deps: MemoryDependencies) {
  const intents = new IntentService(deps.registry, deps.runner, deps.limits);
  const internalTools = new InternalToolService(deps.data, 'memory');
  return {
    intents,
    internalTools,
    createServer: () => createMemoryServer(intents),
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const dataClient = new HttpDataClient(required('DATA_URL'));
  const runner = new DockerContainerRunner({
    image: required('WORKER_IMAGE'),
    network: required('WORKER_NETWORK'),
    memory: process.env['WORKER_MEMORY'] ?? '512m',
    pidsLimit: 128,
    env: {
      INTERNAL_TOOLS_URL: required('INTERNAL_TOOLS_URL'),
      ANTHROPIC_BASE_URL: required('BROKER_URL'),
    },
  });
  const app = compose({ registry: dataClient, data: dataClient, runner, limits: DEFAULT_LIMITS });
  const port = Number(process.env['PORT'] ?? 8081);
  const internalPort = Number(process.env['INTERNAL_PORT'] ?? 8083);
  createHttpHost(app.createServer).listen(port, () => console.warn(`memory listening on :${port}`));
  createInternalToolsHost(app.internalTools).listen(internalPort, () =>
    console.warn(`memory internal tools listening on :${internalPort}`),
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
