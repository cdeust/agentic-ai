import { spawn } from 'node:child_process';
import {
  WorkerTimeoutError,
  WorkerUnavailableError,
  type ContainerRunner,
  type WorkerRunRequest,
  type WorkerRunResult,
} from '../domain/ports.js';

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type Exec = (command: string, args: string[], stdin: string, timeoutMs: number) => Promise<ExecResult>;

export interface DockerRunnerConfig {
  image: string;
  /** Network the worker joins: the isolated exec network, never the app or data networks. */
  network: string;
  memory: string;
  pidsLimit: number;
  /** Environment forwarded to the worker. Must never contain secrets (see docs/infrastructure.md). */
  env: Record<string, string>;
}

/** Runs one worker container per execution with a read-only filesystem and no capabilities. */
export class DockerContainerRunner implements ContainerRunner {
  constructor(
    private readonly config: DockerRunnerConfig,
    private readonly exec: Exec = execWithNode,
  ) {}

  containerName(runId: string): string {
    return `agentic-worker-${runId.replace(/[^A-Za-z0-9_.-]/g, '-')}`;
  }

  args(runId = 'unnamed'): string[] {
    const { image, network, memory, pidsLimit, env } = this.config;
    return [
      'run',
      '--rm',
      '-i',
      '--name',
      this.containerName(runId),
      '--read-only',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=64m',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--user',
      '10001:10001',
      '--network',
      network,
      '--memory',
      memory,
      '--pids-limit',
      String(pidsLimit),
      ...Object.entries(env).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
      image,
    ];
  }

  async run(request: WorkerRunRequest): Promise<WorkerRunResult> {
    let result: ExecResult;
    try {
      result = await this.exec(
        'docker',
        this.args(request.input.run_id),
        JSON.stringify(request.input),
        request.timeoutMs,
      );
    } catch (error) {
      if (error instanceof WorkerTimeoutError) {
        // Killing the docker client does not stop the container: remove it explicitly.
        await this.exec('docker', ['rm', '-f', this.containerName(request.input.run_id)], '', 10_000).catch(
          () => undefined,
        );
        throw error;
      }
      throw new WorkerUnavailableError(`cannot start worker container: ${String(error)}`);
    }
    return { exitCode: result.exitCode, stdout: result.stdout };
  }
}

export const execWithNode: Exec = (command, args, stdin, timeoutMs) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new WorkerTimeoutError(timeoutMs));
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
    child.stdin.end(stdin);
  });
