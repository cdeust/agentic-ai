import assert from 'node:assert/strict';
import { Given as CucumberGiven, Then as CucumberThen, When as CucumberWhen } from '@cucumber/cucumber';

/** Structural view of the root World (features/support/world.ts); a component cannot import across projects. */
export interface MemoryWorld {
  state: Record<string, unknown>;
  cleanups: (() => Promise<void> | void)[];
}

// Instantiation expressions: step functions get `this: MemoryWorld` (IDefineStep is generic in the World type,
// node_modules/@cucumber/cucumber/lib/support_code_library_builder/types.d.ts).
export const Given = CucumberGiven<MemoryWorld>;
export const When = CucumberWhen<MemoryWorld>;
export const Then = CucumberThen<MemoryWorld>;

/** What an awaited call produced: its value, or what it threw. */
export interface Attempt {
  value?: unknown;
  error?: unknown;
  failed: boolean;
}

export async function attempt(work: () => Promise<unknown>): Promise<Attempt> {
  try {
    return { value: await work(), failed: false };
  } catch (error) {
    return { error, failed: true };
  }
}

export function refusedWith(outcome: Attempt | undefined, code: string): void {
  assert.ok(outcome?.failed, `expected a refusal with ${code}, the call succeeded`);
  assert.equal((outcome.error as { code?: unknown }).code, code);
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

/** The per-scenario value kept under `key` in the World state, created on first use. */
export function slot<T>(world: MemoryWorld, key: string, create: () => T): T {
  return (world.state[key] ??= create()) as T;
}

export function required<T>(value: T | undefined, what: string): T {
  assert.ok(value !== undefined, `${what} must be given first`);
  return value;
}
