import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { matchesGlob, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { Given, ROOT, Then, stored } from './helpers.js';

/**
 * The profiles of cucumber.mjs as far as the guard needs them (node_modules/@cucumber/cucumber/lib/configuration/types.d.ts):
 * `tags` and `name` are filters, `retry` and `strict` are run options, `paths` the scope.
 */
interface Profile {
  paths: string[];
  tags?: string;
  name?: string[];
  retry?: number;
  strict?: boolean;
  [key: string]: unknown;
}
interface Profiles {
  default: Profile;
  mutation: Profile;
}

const GateSchema = z.object({
  features: z.object({ include: z.array(z.string()), exclude: z.array(z.string()) }),
});

/** Feature files selected by the gate globs (tools/test-gate/gate.json "features"), hidden directories left out. */
function gateFeatureFiles(): string[] {
  const { features } = GateSchema.parse(
    JSON.parse(readFileSync(join(ROOT, 'tools/test-gate/gate.json'), 'utf8')),
  );
  const files = globSync(features.include, {
    cwd: ROOT,
    exclude: (name) => name === 'node_modules' || name.startsWith('.'),
  });
  return files.sort();
}

const covers = (profile: Profile, file: string): boolean =>
  profile.paths.some((glob) => matchesGlob(file, glob));

function assertPlainScope(profile: Profile): void {
  assert.equal(profile.tags, undefined, 'the default profile must not have tags');
  assert.equal(profile.name, undefined, 'the default profile must not have a name filter');
  assert.equal(profile.retry, 0, 'retry must be 0');
  assert.equal(profile.strict, true, 'strict must be true');
}

function assertCoversGate(profile: Profile): void {
  const files = gateFeatureFiles();
  assert.ok(files.length > 0, 'the gate globs select no feature file');
  const missing = files.filter((file) => !covers(profile, file));
  assert.deepEqual(missing, [], 'feature files of the gate outside the profile paths');
}

function assertMutationScope(base: Profile, mutation: Profile): void {
  const { paths: _basePaths, ...baseRest } = base;
  const { paths: _mutationPaths, ...mutationRest } = mutation;
  assert.deepEqual(mutationRest, baseRest, 'the mutation profile differs from the default beyond its paths');
  for (const file of gateFeatureFiles()) {
    const expected = covers(base, file) && !file.startsWith('features/repository/');
    assert.equal(covers(mutation, file), expected, `mutation profile scope of ${file}`);
  }
}

Given('the committed cucumber configuration', async function () {
  const module = (await import(pathToFileURL(join(ROOT, 'cucumber.mjs')).href)) as Record<string, Profile>;
  assert.ok(
    module['default'] !== undefined && module['mutation'] !== undefined,
    'default and mutation profiles',
  );
  this.state['profiles'] = { default: module['default'], mutation: module['mutation'] } satisfies Profiles;
});

Given('the committed Stryker configuration', async function () {
  const module = (await import(pathToFileURL(join(ROOT, 'stryker.config.mjs')).href)) as { default: unknown };
  this.state['stryker'] = module.default;
});

const profiles = (world: Parameters<typeof stored>[0]): Profiles => stored<Profiles>(world, 'profiles');

Then('its default profile has no tags, no name, retry 0 and strict', function () {
  assertPlainScope(profiles(this).default);
});

Then('its default profile covers every feature file of the gate', function () {
  assertCoversGate(profiles(this).default);
});

Then('its mutation profile differs from the default profile only by its paths', function () {
  const { default: base, mutation } = profiles(this);
  const { paths: _a, ...baseRest } = base;
  const { paths: _b, ...mutationRest } = mutation;
  assert.deepEqual(mutationRest, baseRest);
  assertPlainScope(mutation);
});

Then(
  'its mutation profile covers every feature file of the default profile except those of features\\/repository',
  function () {
    const { default: base, mutation } = profiles(this);
    assertMutationScope(base, mutation);
    assert.ok(
      gateFeatureFiles().some((file) => file.startsWith('features/repository/')),
      'features/repository is empty',
    );
  },
);

Then('its cucumber runner profile is {string}', function (profile: string) {
  const config = z.object({ cucumber: z.object({ profile: z.string() }) }).parse(stored(this, 'stryker'));
  assert.equal(config.cucumber.profile, profile);
});

Then('a default profile with tags is rejected', function () {
  assert.throws(() => assertPlainScope({ ...profiles(this).default, tags: '@wip' }));
});

Then('a default profile with a name filter is rejected', function () {
  assert.throws(() => assertPlainScope({ ...profiles(this).default, name: ['a scenario'] }));
});

Then('a mutation profile that also drops features\\/integration is rejected', function () {
  const { default: base, mutation } = profiles(this);
  const broken = {
    ...mutation,
    paths: mutation.paths.filter((glob) => !glob.startsWith('features/integration/')),
  };
  assert.notEqual(broken.paths.length, mutation.paths.length);
  assert.throws(() => assertMutationScope(base, broken));
});
