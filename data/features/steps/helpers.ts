import assert from 'node:assert/strict';
import { Given as CucumberGiven, Then as CucumberThen, When as CucumberWhen } from '@cucumber/cucumber';
import { EMBEDDING_DIMENSION } from '@architect-os/contracts';
import type { SqlExecutor } from '../../src/infrastructure/sql-store.js';

/** Structural view of the root World (features/support/world.ts); a component cannot import across projects. */
export interface DataWorld {
  databaseUrl: string;
  state: Record<string, unknown>;
  cleanups: (() => Promise<void> | void)[];
}

// Instantiation expressions: step functions get `this: DataWorld` (IDefineStep is generic in the World type,
// node_modules/@cucumber/cucumber/lib/support_code_library_builder/types.d.ts).
export const Given = CucumberGiven<DataWorld>;
export const When = CucumberWhen<DataWorld>;
export const Then = CucumberThen<DataWorld>;

export interface Executor {
  execute(op: string, input: unknown): Promise<unknown>;
}

export class RecordingExecutor implements SqlExecutor {
  readonly calls: { text: string; params: readonly unknown[] }[] = [];
  constructor(private readonly answer: () => Record<string, unknown>[] = () => []) {}
  async query(text: string, params: readonly unknown[]) {
    this.calls.push({ text, params });
    return { rows: this.answer() };
  }
  transaction<T>(work: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    return work(this);
  }
}

/** Everything the data steps share inside one scenario. */
export class DataScenario {
  executor: Executor | undefined;
  recording: RecordingExecutor | undefined;
  /** `$name` in a step argument is replaced by `vars[name]`. */
  readonly vars: Record<string, string> = {};
  answer: unknown;
  failure: unknown;
  baseUrl = '';
  response: { status: number; text: string } | undefined;

  get store(): Executor {
    assert.ok(this.executor, 'a data store or data operations must be given first');
    return this.executor;
  }
  get calls() {
    assert.ok(this.recording, 'a recording executor must be given first');
    return this.recording.calls;
  }
  get lastResponse() {
    assert.ok(this.response, 'a request must be sent first');
    return this.response;
  }
}

export function scenario(world: DataWorld): DataScenario {
  return (world.state['data'] ??= new DataScenario()) as DataScenario;
}

const axis = (i: number) => Array.from({ length: EMBEDDING_DIMENSION }, (_, j) => (j === i ? 1 : 0));

/**
 * Parses a JSON step argument. `"$axisN"` becomes the unit embedding on axis N, `"$filledX"` an embedding
 * of the contract dimension filled with X, any other `$name` the scenario variable of that name.
 */
export function json(data: DataScenario, text: string): unknown {
  return JSON.parse(
    text
      .replace(/"\$axis(\d+)"/g, (_, i: string) => JSON.stringify(axis(Number(i))))
      .replace(/"\$filled([\d.]+)"/g, (_, x: string) =>
        JSON.stringify(Array.from({ length: EMBEDDING_DIMENSION }, () => Number(x))),
      )
      .replace(/\$([a-z]+)/g, (match, name: string) => data.vars[name] ?? match),
  );
}

/** Substitutes `$name` in plain text. */
export function text(data: DataScenario, value: string): string {
  return value.replace(/\$([a-z]+)/g, (match, name: string) => data.vars[name] ?? match);
}

/** Partial deep match, like a `toMatchObject`: objects by the expected keys, arrays by length and element. */
export function assertMatches(actual: unknown, expected: unknown, path = 'value'): void {
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${path} is not an array`);
    assert.equal(actual.length, expected.length, `${path} length`);
    expected.forEach((item, i) => assertMatches(actual[i], item, `${path}[${i}]`));
  } else if (typeof expected === 'object' && expected !== null) {
    assert.ok(typeof actual === 'object' && actual !== null, `${path} is not an object`);
    for (const [key, value] of Object.entries(expected)) {
      assertMatches((actual as Record<string, unknown>)[key], value, `${path}.${key}`);
    }
  } else {
    assert.deepEqual(actual, expected, path);
  }
}
