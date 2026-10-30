import type { Violation } from './violation.js';

/** A test step of one attempt: a pickle step (its text) or a hook (its source). Status as in TestStepResultStatus. */
export interface StepOutcome {
  readonly name: string;
  readonly status: string;
}

export interface Attempt {
  /** TestCaseStarted.attempt. */
  readonly attempt: number;
  /** TestCaseFinished.willBeRetried; null when the attempt never finished. */
  readonly willBeRetried: boolean | null;
  readonly steps: readonly StepOutcome[];
}

/** A pickle that was started at least once, with its identity text. */
export interface ExecutedPickle {
  readonly id: string;
  /** Number of steps of the pickle itself (hooks excluded). */
  readonly pickleSteps: number;
  readonly attempts: readonly Attempt[];
}

/** What the gate keeps of a Cucumber Messages report. TestRunFinished.success is deliberately absent (doc §7.3). */
export interface CucumberRun {
  readonly pickles: readonly ExecutedPickle[];
  /** BeforeAll / AfterAll hooks. */
  readonly runHooks: readonly StepOutcome[];
}

/** The pickles of the job scope compiled from the .feature files of one tree. */
export interface StaticSet {
  readonly ids: readonly string[];
  /** Parse errors, `<path>: <message>`. */
  readonly errors: readonly string[];
}

const PASSED = 'PASSED';

/** Rule 1: an identity present twice in the static set makes the count ambiguous. */
export function duplicateIdentities(set: StaticSet): Violation[] {
  const counts = new Map<string, number>();
  for (const id of set.ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts]
    .filter(([, count]) => count > 1)
    .map(([id, count]) => ({
      rule: 1,
      text: `${id} : identité présente ${count} fois dans l'ensemble statique`,
    }));
}

/** Rule 2: one attempt, at least one step, every step (hooks included) PASSED. */
export function outcomeViolations(run: CucumberRun): Violation[] {
  const violations: Violation[] = [];
  const add = (text: string) => violations.push({ rule: 2, text });
  for (const hook of run.runHooks) {
    if (hook.status !== PASSED) add(`${hook.name} : ${hook.status}`);
  }
  for (const pickle of run.pickles) {
    if (pickle.attempts.length !== 1)
      add(`${pickle.id} : ${pickle.attempts.length} tentatives, une seule attendue`);
    if (pickle.pickleSteps === 0) add(`${pickle.id} : scénario sans step`);
    for (const attempt of pickle.attempts) {
      const where = `${pickle.id} : tentative ${attempt.attempt}`;
      if (attempt.attempt !== 0) add(`${where} : attempt > 0`);
      if (attempt.willBeRetried === null) add(`${where} : non terminée`);
      if (attempt.willBeRetried === true) add(`${where} : willBeRetried`);
      for (const step of attempt.steps) {
        if (step.status !== PASSED) add(`${where}, ${step.name} : ${step.status}`);
      }
    }
  }
  return violations;
}

/** Rule 3: the executed set equals the static set, by identity. Parse errors of the static set break it too. */
export function setViolations(executed: readonly string[], set: StaticSet): Violation[] {
  const expected = new Set(set.ids);
  const ran = new Set(executed);
  return [
    ...set.errors.map((error) => ({ rule: 3 as const, text: `${error} : fichier .feature illisible` })),
    ...[...expected]
      .filter((id) => !ran.has(id))
      .map((id) => ({ rule: 3 as const, text: `${id} : attendu, non exécuté` })),
    ...[...ran]
      .filter((id) => !expected.has(id))
      .map((id) => ({ rule: 3 as const, text: `${id} : exécuté, absent de l'ensemble statique` })),
  ];
}
