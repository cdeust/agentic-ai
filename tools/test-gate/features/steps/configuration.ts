import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { changedFiles } from '../../src/infrastructure/gate.js';
import { jobOf, parseGateConfig } from '../../src/infrastructure/config.js';
import { GitRepository } from '../../src/infrastructure/git.js';
import { Workspace } from '../../src/infrastructure/workspace.js';
import { FIXTURES, Then, repository } from './repository.js';

const COMMITTED = fileURLToPath(new URL('../../gate.json', import.meta.url));

function committed(): Record<string, unknown> {
  return JSON.parse(readFileSync(COMMITTED, 'utf8')) as Record<string, unknown>;
}

/** Sets (or, for the value `absent`, deletes) the dotted `path` of a JSON object. */
function edit(json: Record<string, unknown>, path: string, value: string): Record<string, unknown> {
  const keys = path.split('.');
  const last = keys.pop() as string;
  let target = json;
  for (const key of keys) target = target[key] as Record<string, unknown>;
  if (value === 'absent') delete target[last];
  else target[last] = JSON.parse(value) as unknown;
  return json;
}

Then('the committed gate configuration loads against its schema', function () {
  const config = parseGateConfig(readFileSync(COMMITTED, 'utf8'));
  assert.ok(!('failure' in config), JSON.stringify(config));
});

Then('the fixture gate configuration loads against its schema', function () {
  const config = parseGateConfig(readFileSync(`${FIXTURES}gate.json`, 'utf8'));
  assert.ok(!('failure' in config), JSON.stringify(config));
});

Then(
  'the committed gate job {string} counts {string} with mutation {string}',
  function (name, globs, mutation) {
    const config = parseGateConfig(readFileSync(COMMITTED, 'utf8'));
    assert.ok(!('failure' in config));
    assert.deepEqual(jobOf(config, name), { name, features: globs.split(', '), mutation: mutation === 'on' });
  },
);

Then(
  'a copy of the committed gate configuration with {string} set to {string} is rejected with:',
  function (path: string, value: string, message: string) {
    assert.deepEqual(parseGateConfig(JSON.stringify(edit(committed(), path, value))), { failure: message });
  },
);

Then(
  'a copy of the committed gate configuration with {string} set to {string} loads',
  function (path: string, value: string) {
    const config = parseGateConfig(JSON.stringify(edit(committed(), path, value)));
    assert.ok(!('failure' in config), JSON.stringify(config));
  },
);

Then('the gate changes against the first parent are:', function (text: string) {
  const repo = repository(this);
  const git = new GitRepository(repo.dir);
  const changes = changedFiles(git, new Workspace(repo.dir), git.commits().firstParent);
  const lines = changes.map((change) =>
    `${change.path}${change.deleted ? ' (supprimé)' : ''}: ${change.lines.join(',')}`.trimEnd(),
  );
  assert.deepEqual(lines, text.split('\n'));
});
