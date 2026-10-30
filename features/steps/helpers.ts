import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Given as CucumberGiven, Then as CucumberThen, When as CucumberWhen } from '@cucumber/cucumber';
import type { ArchitectWorld } from '../support/world.js';

// Instantiation expressions: step functions get `this: ArchitectWorld` (IDefineStep is generic in the World type,
// node_modules/@cucumber/cucumber/lib/support_code_library_builder/types.d.ts).
export const Given = CucumberGiven<ArchitectWorld>;
export const When = CucumberWhen<ArchitectWorld>;
export const Then = CucumberThen<ArchitectWorld>;

/** The repository root. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The value a step stored under `key`; a missing one means the Given/When steps are in the wrong order. */
export function stored<T>(world: ArchitectWorld, key: string): T {
  const value = world.state[key];
  assert.notEqual(value, undefined, `nothing stored under "${key}": a previous step is missing`);
  return value as T;
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

/** "a, b ,c" -> ['a', 'b', 'c']. */
export const list = (text: string): string[] => text.split(',').map((item) => item.trim());
