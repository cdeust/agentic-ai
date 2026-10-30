import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Given as CucumberGiven, Then as CucumberThen, When as CucumberWhen } from '@cucumber/cucumber';

/** Structural view of the root World (features/support/world.ts); a component cannot import across projects. */
export interface SandboxWorld {
  state: Record<string, unknown>;
  cleanups: (() => Promise<void> | void)[];
}

// Instantiation expressions: step functions get `this: SandboxWorld` (IDefineStep is generic in the World type,
// node_modules/@cucumber/cucumber/lib/support_code_library_builder/types.d.ts).
export const Given = CucumberGiven<SandboxWorld>;
export const When = CucumberWhen<SandboxWorld>;
export const Then = CucumberThen<SandboxWorld>;

/** `packages/sandbox` and the repository root. */
export const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ROOT = resolve(PKG, '..', '..');

/** The value a step stored under `key`; a missing one means the Given/When steps are in the wrong order. */
export function stored<T>(world: SandboxWorld, key: string): T {
  const value = world.state[key];
  assert.notEqual(value, undefined, `nothing stored under "${key}": a previous step is missing`);
  return value as T;
}

/** Validation function for `assert.throws` / `assert.rejects`: the message alone must match `pattern`. */
export function messageMatches(pattern: string): (error: unknown) => true {
  return (error) => {
    assert.ok(error instanceof Error, `expected an Error, got ${String(error)}`);
    assert.match(error.message, new RegExp(pattern));
    return true;
  };
}

/** Partial deep match, like vitest `toMatchObject`: objects by the expected keys, arrays by length and element. */
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
