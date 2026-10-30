import { countRule, type BaseInput, type Count } from './count.js';
import { judgeMutation, type MutationJudgement, type MutationReport, type Perimeter } from './mutation.js';
import {
  duplicateIdentities,
  outcomeViolations,
  setViolations,
  type CucumberRun,
  type StaticSet,
} from './run.js';
import type { ReadFailure, Violation } from './violation.js';

export interface GateInputs {
  readonly job: string;
  readonly head: string;
  readonly firstParent: string | null;
  readonly staticNow: StaticSet;
  readonly staticParent: readonly string[];
  readonly run: CucumberRun | ReadFailure;
  readonly base: BaseInput;
  /** null when the job runs no mutation. */
  readonly mutation: { readonly perimeter: Perimeter; readonly report: MutationReport | ReadFailure } | null;
}

export interface Verdict {
  readonly job: string;
  readonly head: string;
  readonly firstParent: string | null;
  readonly green: boolean;
  /** Identity texts of the executed pickles. */
  readonly executed: readonly string[];
  readonly staticCount: number;
  readonly count: Count;
  readonly mutation: MutationJudgement | null;
  /** Every violation, in rule order. */
  readonly violations: readonly Violation[];
}

/** Green if and only if every rule holds. Reads the report's pickles, never its exit code nor its `success`. */
export function evaluate(inputs: GateInputs): Verdict {
  const run = 'failure' in inputs.run ? { pickles: [], runHooks: [] } : inputs.run;
  const readFailure: Violation[] =
    'failure' in inputs.run ? [{ rule: 2, text: `rapport Cucumber illisible : ${inputs.run.failure}` }] : [];
  const executed = run.pickles.map((pickle) => pickle.id);
  const count = countRule({
    job: inputs.job,
    firstParent: inputs.firstParent,
    now: inputs.staticNow.ids,
    parent: inputs.staticParent,
    executed: executed.length,
    base: inputs.base,
  });
  const mutation =
    inputs.mutation === null ? null : judgeMutation(inputs.mutation.perimeter, inputs.mutation.report);
  const violations = [
    ...duplicateIdentities(inputs.staticNow),
    ...readFailure,
    ...outcomeViolations(run),
    ...setViolations(executed, inputs.staticNow),
    ...count.violations,
    ...(mutation?.violations ?? []),
  ];
  return {
    job: inputs.job,
    head: inputs.head,
    firstParent: inputs.firstParent,
    green: violations.length === 0,
    executed,
    staticCount: inputs.staticNow.ids.length,
    count,
    mutation,
    violations,
  };
}
