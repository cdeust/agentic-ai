import {
  parseEnvelope,
  type Envelope,
  type GherkinDocument,
  type Hook,
  type Location,
  type Pickle,
  type PickleStep,
  type TestCase,
  type TestCaseStarted,
} from '@cucumber/messages';
import type { Attempt, CucumberRun, StepOutcome } from '../domain/run.js';
import type { ReadFailure } from '../domain/violation.js';
import { identitiesOf } from './gherkin.js';

// Envelope shapes and parseEnvelope: node_modules/@cucumber/messages/dist/esm/src/messages.d.ts and parseEnvelope.d.ts.
// A report whose references do not resolve (a pickle without its document, a test case without its pickle) is not
// a cucumber-js 12.9.0 report: the lookups below then throw, and the throw becomes a ReadFailure.

function hookName(hook: Hook | undefined): string {
  const reference = (hook as Hook).sourceReference;
  return `hook ${reference.uri}:${(reference.location as Location).line}`;
}

function index(envelopes: readonly Envelope[]) {
  const documents = new Map<string, GherkinDocument>();
  const pickles = new Map<string, Pickle>();
  const testCases = new Map<string, TestCase>();
  const hooks = new Map<string, Hook>();
  const started: TestCaseStarted[] = [];
  const willBeRetried = new Map<string, boolean>();
  const stepStatus = new Map<string, string>();
  const runHooks = new Map<string, { hookId: string; status: string }>();
  for (const envelope of envelopes) {
    const { gherkinDocument, pickle, testCase, hook, testCaseStarted, testCaseFinished, testStepFinished } =
      envelope;
    const { testRunHookStarted, testRunHookFinished } = envelope;
    if (gherkinDocument !== undefined) documents.set(gherkinDocument.uri as string, gherkinDocument);
    if (pickle !== undefined) pickles.set(pickle.id, pickle);
    if (testCase !== undefined) testCases.set(testCase.id, testCase);
    if (hook !== undefined) hooks.set(hook.id, hook);
    if (testCaseStarted !== undefined) started.push(testCaseStarted);
    if (testCaseFinished !== undefined) {
      willBeRetried.set(testCaseFinished.testCaseStartedId, testCaseFinished.willBeRetried);
    }
    if (testStepFinished !== undefined) {
      const { testCaseStartedId, testStepId, testStepResult } = testStepFinished;
      stepStatus.set(`${testCaseStartedId} ${testStepId}`, testStepResult.status);
    }
    if (testRunHookStarted !== undefined) {
      runHooks.set(testRunHookStarted.id, { hookId: testRunHookStarted.hookId, status: 'MISSING' });
    }
    if (testRunHookFinished !== undefined) {
      (runHooks.get(testRunHookFinished.testRunHookStartedId) as { status: string }).status =
        testRunHookFinished.result.status;
    }
  }
  return { documents, pickles, testCases, hooks, started, willBeRetried, stepStatus, runHooks };
}

/**
 * The executed pickles of a Cucumber Messages NDJSON report, restricted to the job scope (`inScope` on the uri).
 * A pickle is executed when it has at least one TestCaseStarted. TestRunFinished.success is never read (doc §7.3).
 */
export function parseCucumberReport(
  text: string,
  inScope: (uri: string) => boolean,
): CucumberRun | ReadFailure {
  try {
    const lines = text.split('\n').filter((line) => line.trim() !== '');
    const { documents, pickles, testCases, hooks, started, willBeRetried, stepStatus, runHooks } = index(
      lines.map((line) => parseEnvelope(line)),
    );
    const byUri = new Map<string, Pickle[]>();
    for (const pickle of pickles.values()) byUri.set(pickle.uri, [...(byUri.get(pickle.uri) ?? []), pickle]);
    const identities = new Map<string, string>();
    for (const [uri, list] of byUri) {
      for (const [id, identity] of identitiesOf(documents.get(uri) as GherkinDocument, list))
        identities.set(id, identity);
    }
    const executed = new Map<string, { id: string; pickleSteps: number; attempts: Attempt[] }>();
    for (const start of started) {
      const testCase = testCases.get(start.testCaseId) as TestCase;
      const pickle = pickles.get(testCase.pickleId) as Pickle;
      const steps: StepOutcome[] = testCase.testSteps.map((step) => ({
        name:
          step.pickleStepId === undefined
            ? hookName(hooks.get(step.hookId as string))
            : `step « ${(pickle.steps.find((pickleStep) => pickleStep.id === step.pickleStepId) as PickleStep).text} »`,
        status: stepStatus.get(`${start.id} ${step.id}`) ?? 'MISSING',
      }));
      const entry = executed.get(pickle.id) ?? {
        id: identities.get(pickle.id) as string,
        pickleSteps: pickle.steps.length,
        attempts: [],
      };
      entry.attempts.push({
        attempt: start.attempt,
        willBeRetried: willBeRetried.get(start.id) ?? null,
        steps,
      });
      if (inScope(pickle.uri)) executed.set(pickle.id, entry);
    }
    return {
      pickles: [...executed.values()],
      runHooks: [...runHooks.values()].map(({ hookId, status }) => ({
        name: hookName(hooks.get(hookId)),
        status,
      })),
    };
  } catch (error) {
    return { failure: `rapport Cucumber invalide : ${(error as Error).message}` };
  }
}
