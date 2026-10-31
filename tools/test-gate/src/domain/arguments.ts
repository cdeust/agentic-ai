import type { ReadFailure } from './violation.js';

export type Command =
  | { readonly name: 'plan' | 'check'; readonly job: string }
  /** Writes the mutation debt registry from the mutation report; takes no option. */
  | { readonly name: 'debt' };

const USAGE = 'usage : test-gate plan|check [--job <nom>] | debt';

/** `plan|check [--job <name>]` (the job defaults to linux), or `debt`. */
export function parseArguments(args: readonly string[]): Command | ReadFailure {
  const [name, ...options] = args;
  if (name === 'debt') return options.length === 0 ? { name } : { failure: USAGE };
  if (name !== 'plan' && name !== 'check') return { failure: USAGE };
  if (options.length === 0) return { name, job: 'linux' };
  const [flag, job, ...rest] = options;
  if (flag !== '--job' || job === undefined || rest.length > 0) return { failure: USAGE };
  return { name, job };
}
