import type { ReadFailure, Violation } from './violation.js';

/** reports/base/gate-base.json, written by the gate of the last green `main` run and downloaded by the workflow. */
export interface GateBase {
  readonly job: string;
  readonly sha: string;
  readonly count: number;
  readonly pickles: readonly string[];
}

/** null: no base file (the written fallback applies). */
export type BaseInput = GateBase | ReadFailure | null;

export type BaseSource = 'artifact' | 'fallback' | 'root';

export interface Count {
  readonly base: number;
  readonly source: BaseSource;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly expected: number;
  readonly violations: readonly Violation[];
}

export interface CountInput {
  readonly job: string;
  readonly firstParent: string | null;
  /** Static pickle ids of the job scope at the working tree and at the first parent (empty without first parent). */
  readonly now: readonly string[];
  readonly parent: readonly string[];
  readonly executed: number;
  readonly base: BaseInput;
}

/** The ids of `from` absent from `minus`, sorted. */
function difference(from: ReadonlySet<string>, minus: ReadonlySet<string>): string[] {
  return [...from].filter((id) => !minus.has(id)).sort();
}

/** Rule 4: executed = base + added - removed, added and removed derived from the two static sets, never declared. */
export function countRule(input: CountInput): Count {
  const now = new Set(input.now);
  const parent = new Set(input.parent);
  const added = difference(now, parent);
  const removed = difference(parent, now);
  const violations: Violation[] = [];
  const add = (text: string) => violations.push({ rule: 4, text });
  let base = parent.size;
  let source: BaseSource = input.firstParent === null ? 'root' : 'fallback';
  if (input.base !== null && 'failure' in input.base) {
    add(`base illisible : ${input.base.failure}`);
  } else if (input.base !== null) {
    base = input.base.count;
    source = 'artifact';
    if (input.base.sha !== input.firstParent) {
      add(`base d'un autre SHA : ${input.base.sha}, premier parent ${input.firstParent ?? 'aucun'}`);
    }
    if (input.base.job !== input.job) add(`base d'un autre job : ${input.base.job}, job ${input.job}`);
  }
  const expected = base + added.length - removed.length;
  if (input.executed !== expected) {
    add(
      `exécutés ${input.executed} ≠ base ${base} + ajoutés ${added.length} − supprimés ${removed.length} = ${expected}`,
    );
  }
  return { base, source, added, removed, expected, violations };
}
