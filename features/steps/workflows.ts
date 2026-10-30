import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { Given, ROOT, Then, stored } from './helpers.js';

/**
 * Shape of a GitHub Actions workflow as far as the guards need it (docs.github.com, "Workflow syntax for GitHub
 * Actions"): triggers under `on`, `permissions`, and per job a list of steps with `uses`, `run` and `with`.
 * YAML 1.2 (the `yaml` package default) reads the key `on` as a string, not as a boolean.
 */
const StepSchema = z.object({
  uses: z.string().optional(),
  run: z.string().optional(),
  with: z.record(z.string(), z.unknown()).optional(),
});
const WorkflowSchema = z.object({
  on: z.union([z.string(), z.array(z.string()), z.record(z.string(), z.unknown())]),
  permissions: z.record(z.string(), z.string()).optional(),
  jobs: z.record(z.string(), z.object({ name: z.string().optional(), steps: z.array(StepSchema) })),
});
type Workflow = z.infer<typeof WorkflowSchema>;

interface Loaded {
  path: string;
  text: string;
}

const PINNED = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.\/-]+@[0-9a-f]{40}$/;

function workflow(text: string): Workflow {
  return WorkflowSchema.parse(parse(text));
}

function steps(text: string): z.infer<typeof StepSchema>[] {
  return Object.values(workflow(text).jobs).flatMap((job) => job.steps);
}

function assertPinned(text: string): void {
  for (const { uses } of steps(text)) {
    if (uses !== undefined) assert.match(uses, PINNED, `action not pinned by a 40-hex SHA: ${uses}`);
  }
}

function assertNpmCiSafe(text: string): void {
  for (const { run } of steps(text)) {
    for (const line of (run ?? '').split('\n').filter((l) => /\bnpm ci\b/.test(l))) {
      assert.match(line, /--ignore-scripts/, `npm ci without --ignore-scripts: ${line}`);
    }
  }
}

function assertCheckoutWithoutCredentials(text: string): void {
  for (const { uses, with: inputs } of steps(text)) {
    if (uses?.startsWith('actions/checkout@') === true) {
      assert.equal(inputs?.['persist-credentials'], false, 'checkout without persist-credentials: false');
    }
  }
}

function assertGate(text: string): void {
  const doc = workflow(text);
  assert.ok(typeof doc.on === 'object' && !Array.isArray(doc.on), 'on is a mapping');
  assert.ok('pull_request' in doc.on, 'gate.yml has the pull_request trigger');
  assert.ok(!('pull_request_target' in doc.on), 'gate.yml must not use pull_request_target');
  assert.deepEqual(doc.permissions, { contents: 'read', actions: 'read' });
  assert.ok(!text.includes('secrets.'), 'gate.yml must not use a secret');
  assert.deepEqual(Object.keys(doc.jobs).sort(), ['gate-linux', 'gate-macos']);
  for (const [id, job] of Object.entries(doc.jobs)) assert.equal(job.name, id);
  for (const step of Object.values(doc.jobs).flatMap((job) => job.steps)) {
    assert.ok(!('cache' in (step.with ?? {})), 'gate.yml must not use a cache');
    if (step.uses?.startsWith('actions/checkout@') === true) {
      assert.equal(step.with?.['fetch-depth'], 2, 'checkout with fetch-depth: 2');
    }
  }
}

Given('the committed workflow {string}', function (name: string) {
  const path = `.github/workflows/${name}`;
  this.state['workflow'] = { path, text: readFileSync(join(ROOT, path), 'utf8') } satisfies Loaded;
});

const text = (world: Parameters<typeof stored>[0]): string => stored<Loaded>(world, 'workflow').text;

Then('every action it uses is pinned by a commit SHA', function () {
  assertPinned(text(this));
});

Then('every npm ci in it has --ignore-scripts', function () {
  assertNpmCiSafe(text(this));
});

Then('every checkout in it has persist-credentials false', function () {
  assertCheckoutWithoutCredentials(text(this));
});

Then('it satisfies the gate workflow rules', function () {
  assertGate(text(this));
});

Then('a workflow with an unpinned action is rejected', function () {
  const broken = text(this).replace(/(actions\/checkout)@[0-9a-f]{40}/, '$1@v6');
  assert.notEqual(broken, text(this));
  assert.throws(() => assertPinned(broken));
});

Then('a workflow with an npm ci without --ignore-scripts is rejected', function () {
  const broken = text(this).replace('npm ci --ignore-scripts', 'npm ci');
  assert.notEqual(broken, text(this));
  assert.throws(() => assertNpmCiSafe(broken));
});

Then('a workflow with a checkout that keeps its credentials is rejected', function () {
  const broken = text(this).replace('persist-credentials: false', 'persist-credentials: true');
  assert.notEqual(broken, text(this));
  assert.throws(() => assertCheckoutWithoutCredentials(broken));
});

Then('a gate workflow triggered by pull_request_target is rejected', function () {
  const broken = text(this).replace(/^ {2}pull_request:$/m, '  pull_request_target:');
  assert.notEqual(broken, text(this));
  assert.throws(() => assertGate(broken));
});

Then('a gate workflow that uses a secret is rejected', function () {
  const broken = text(this).replace('${{ github.token }}', '${{ secrets.GITHUB_TOKEN }}');
  assert.notEqual(broken, text(this));
  assert.throws(() => assertGate(broken));
});

Then('a gate workflow with a cache is rejected', function () {
  const broken = text(this).replace(
    'node-version-file: .nvmrc',
    'node-version-file: .nvmrc\n          cache: npm',
  );
  assert.notEqual(broken, text(this));
  assert.throws(() => assertGate(broken));
});

Then('a gate workflow with broader permissions is rejected', function () {
  const broken = text(this).replace('  actions: read\n', '  actions: write\n');
  assert.notEqual(broken, text(this));
  assert.throws(() => assertGate(broken));
});
