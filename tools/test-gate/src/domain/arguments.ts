import type { ReadFailure } from './violation.js';

export interface Command {
  readonly name: 'plan' | 'check';
  readonly job: string;
}

const USAGE = 'usage : test-gate plan|check [--job <nom>]';

/** `plan|check [--job <name>]`; the job defaults to linux. */
export function parseArguments(args: readonly string[]): Command | ReadFailure {
  const [name, ...options] = args;
  if (name !== 'plan' && name !== 'check') return { failure: USAGE };
  if (options.length === 0) return { name, job: 'linux' };
  const [flag, job, ...rest] = options;
  if (flag !== '--job' || job === undefined || rest.length > 0) return { failure: USAGE };
  return { name, job };
}
