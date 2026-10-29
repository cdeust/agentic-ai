import { ClaudeSdkAgent } from './sdk-agent.js';
import { HttpInternalTools } from './internal-tools.js';
import { runWorker } from './run-worker.js';

/**
 * Worker entrypoint (the image's ENTRYPOINT). stdin: WorkerInput JSON; stdout: WorkerOutput JSON.
 * No API key lives here: ANTHROPIC_BASE_URL points at the secrets broker, which adds the key.
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const toolsUrl = process.env['INTERNAL_TOOLS_URL'];
if (toolsUrl === undefined) {
  process.stdout.write(
    JSON.stringify({
      status: 'failed',
      data: null,
      evidence: [],
      cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
      error: { code: 'WORKER_FAILED', message: 'INTERNAL_TOOLS_URL is not set' },
    }),
  );
  process.exit(2);
}

const result = await runWorker(await readStdin(), {
  agent: new ClaudeSdkAgent(),
  tools: new HttpInternalTools(toolsUrl),
});
process.stdout.write(result.stdout);
process.exit(result.exitCode);
