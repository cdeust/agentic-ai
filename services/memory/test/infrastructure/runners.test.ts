import { describe, expect, it } from 'vitest';
import { WorkerTimeoutError, WorkerUnavailableError } from '../../src/domain/ports.js';
import { DockerContainerRunner, type Exec } from '../../src/infrastructure/docker-runner.js';
import { InProcessContainerRunner } from '../../src/infrastructure/in-process-runner.js';
import { containerRunnerContract } from '../contracts/container-runner.js';

containerRunnerContract('in-process', {
  responding: (stdout, exitCode) => new InProcessContainerRunner(async () => ({ stdout, exitCode })),
  hanging: () => new InProcessContainerRunner(() => new Promise(() => undefined)),
});

const CONFIG = {
  image: 'worker:test',
  network: 'exec',
  memory: '256m',
  pidsLimit: 64,
  env: { INTERNAL_TOOLS_URL: 'http://memory:8083' },
};

containerRunnerContract('docker (fake exec)', {
  responding: (stdout, exitCode) =>
    new DockerContainerRunner(CONFIG, async () => ({ stdout, exitCode, stderr: '' })),
  hanging: () =>
    new DockerContainerRunner(CONFIG, async (_c, _a, _s, timeoutMs) => {
      throw new WorkerTimeoutError(timeoutMs);
    }),
});

describe('DockerContainerRunner isolation flags', () => {
  const args = new DockerContainerRunner(CONFIG).args();

  it('uses a read-only filesystem, no capabilities, no privilege escalation and a non-root user', () => {
    expect(args).toEqual(
      expect.arrayContaining(['--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges']),
    );
    expect(args[args.indexOf('--user') + 1]).toBe('10001:10001');
  });

  it('joins only the configured exec network and ends with the image', () => {
    expect(args[args.indexOf('--network') + 1]).toBe('exec');
    expect(args.at(-1)).toBe('worker:test');
  });

  it('forwards only the configured environment', () => {
    const forwarded = args.filter((_, i) => args[i - 1] === '--env');
    expect(forwarded).toEqual(['INTERNAL_TOOLS_URL=http://memory:8083']);
  });

  it('names the container after the run and removes it when the worker times out', async () => {
    const calls: string[][] = [];
    const exec: Exec = async (_c, args) => {
      calls.push(args);
      if (args[0] === 'run') throw new WorkerTimeoutError(5);
      return { exitCode: 0, stdout: '', stderr: '' };
    };
    await expect(
      new DockerContainerRunner(CONFIG, exec).run({
        input: { run_id: 'run/42', tool: 't', input: 1 },
        timeoutMs: 5,
      }),
    ).rejects.toBeInstanceOf(WorkerTimeoutError);
    expect(calls[0]).toEqual(expect.arrayContaining(['--name', 'agentic-worker-run-42']));
    expect(calls[1]).toEqual(['rm', '-f', 'agentic-worker-run-42']);
  });

  it('sends the worker input on stdin and maps a spawn failure to WorkerUnavailableError', async () => {
    let stdin = '';
    const ok: Exec = async (_c, _a, input) => {
      stdin = input;
      return { exitCode: 0, stdout: '{}', stderr: '' };
    };
    await new DockerContainerRunner(CONFIG, ok).run({
      input: { run_id: 'r', tool: 't', input: 1 },
      timeoutMs: 10,
    });
    expect(JSON.parse(stdin)).toEqual({ run_id: 'r', tool: 't', input: 1 });
    const broken: Exec = async () => {
      throw new Error('docker: not found');
    };
    await expect(
      new DockerContainerRunner(CONFIG, broken).run({
        input: { run_id: 'r', tool: 't', input: 1 },
        timeoutMs: 10,
      }),
    ).rejects.toBeInstanceOf(WorkerUnavailableError);
  });
});
