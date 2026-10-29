import {
  WorkerTimeoutError,
  type ContainerRunner,
  type WorkerRunRequest,
  type WorkerRunResult,
} from '../domain/ports.js';

export type WorkerEntrypoint = (stdin: string) => Promise<WorkerRunResult>;

/** In-memory ContainerRunner: executes the worker entrypoint in this process, without a container. */
export class InProcessContainerRunner implements ContainerRunner {
  constructor(private readonly entrypoint: WorkerEntrypoint) {}

  async run(request: WorkerRunRequest): Promise<WorkerRunResult> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new WorkerTimeoutError(request.timeoutMs)), request.timeoutMs);
    });
    try {
      return await Promise.race([this.entrypoint(JSON.stringify(request.input)), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
