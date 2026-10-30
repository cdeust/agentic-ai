import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DataTable } from '@cucumber/cucumber';
import {
  closedEnv,
  isWritable,
  loadTemplate,
  parseTemplate,
  resolveProfile,
  type ProfileTemplate,
  type ProfileVariables,
  type ResolvedProfile,
} from '../../src/profile.js';
import { Then, When, PKG, assertMatches, messageMatches, stored, type SandboxWorld } from './helpers.js';

const PROFILES = join(PKG, 'profiles');
const committed = (): Record<string, any> =>
  JSON.parse(readFileSync(join(PROFILES, 'builder.json'), 'utf8')) as Record<string, any>;

const VARS: ProfileVariables = {
  home: '/h',
  repo: '/r',
  worktree: '/r/.claude/worktrees/w',
  worktreeName: 'w',
  tmp: '/t/aos/tmp',
  config: '/t/aos/config',
  authProxyPort: '4321',
  sessionToken: 'session-token',
};

// Named defects of the committed file, one per row of the "rejects a broken copy" Examples.
const DEFECTS: Record<string, (t: Record<string, any>) => unknown> = {
  'a weakening option': (t) => (t['srt']['enableWeakerNestedSandbox'] = true),
  'a misspelt key [T-01]': (t) => (t['srt']['network']['strictAllowlistt'] = true),
  'filesystem.disabled': (t) => (t['srt']['filesystem']['disabled'] = true),
  allowGitConfig: (t) => (t['srt']['filesystem']['allowGitConfig'] = true),
  'an API key passed through': (t) => t['env']['pass'].push('ANTHROPIC_API_KEY'),
  'a config dir set': (t) => (t['env']['set']['CLAUDE_CONFIG_DIR'] = '/x'),
  'NO_PROXY passed through': (t) => t['env']['pass'].push('NO_PROXY'),
  'a literal token written in the file': (t) =>
    (t['env']['set']['CLAUDE_CODE_OAUTH_TOKEN'] = 'sk-ant-literal'),
  'a base URL to another host': (t) =>
    (t['env']['set']['ANTHROPIC_BASE_URL'] = 'https://evil.example/${authProxyPort}'),
  'a host Claude variable passed through': (t) => t['env']['pass'].push('CLAUDE_CODE_OAUTH_TOKEN'),
};

const template = (w: SandboxWorld) => stored<ProfileTemplate>(w, 'template');
const resolved = (w: SandboxWorld) => stored<ResolvedProfile>(w, 'resolved');
const column = (table: DataTable) => table.raw().map((row) => row[0] as string);
const pairs = (table: DataTable) =>
  Object.fromEntries(table.raw().map(([k, v]) => [k as string, v as string]));

When('I load the committed builder profile', function () {
  this.state['template'] = loadTemplate(PROFILES, 'builder');
});

When('I resolve the profile with the test variables', function () {
  this.state['resolved'] = resolveProfile(template(this), VARS);
});

Then('the profile grants at least one write path', function () {
  assert.ok(template(this).srt.filesystem.allowWrite.length > 0);
});

Then('the profile allows writing to at least:', function (table: DataTable) {
  const allowed = template(this).srt.filesystem.allowWrite;
  for (const path of column(table)) assert.ok(allowed.includes(path), `${path} is not in allowWrite`);
});

Then('the profile allows writing to nothing under {string}', function (prefix: string) {
  assert.deepEqual(
    template(this).srt.filesystem.allowWrite.filter((p) => p.startsWith(prefix)),
    [],
  );
});

Then('the profile denies writing to exactly:', function (table: DataTable) {
  assert.deepEqual(template(this).srt.filesystem.denyWrite, column(table));
});

Then('the profile denies reading exactly:', function (table: DataTable) {
  assert.deepEqual(template(this).srt.filesystem.denyRead, column(table));
});

Then('the profile allows a pseudo-terminal', function () {
  assert.equal(template(this).srt.allowPty, true);
});

Then('the profile sets the variable {string} to {string}', function (name: string, value: string) {
  assert.equal(template(this).env.set[name], value);
});

Then('the profile unsets exactly the variables:', function (table: DataTable) {
  assert.deepEqual(template(this).env.unset, column(table));
});

Then('the profile allows the network domains exactly:', function (table: DataTable) {
  assert.deepEqual(template(this).srt.network.allowedDomains, column(table));
});

Then('the profile sets the variables:', function (table: DataTable) {
  assertMatches(template(this).env.set, pairs(table));
});

Then('the resolved file {string} equals {string}', function (file: string, json: string) {
  assert.deepEqual(resolved(this).files[file], JSON.parse(json));
});

Then('the resolved file {string} contains {string}', function (file: string, json: string) {
  assertMatches(resolved(this).files[file], JSON.parse(json));
});

Then('none of these paths is writable:', function (table: DataTable) {
  const { settings } = resolved(this);
  for (const path of column(table)) assert.equal(isWritable(settings, path), false, path);
});

Then('all of these paths are writable:', function (table: DataTable) {
  const { settings } = resolved(this);
  for (const path of column(table)) assert.equal(isWritable(settings, path), true, path);
});

When('I break a copy of the committed profile with {}', function (defect: string) {
  const breakIt = DEFECTS[defect];
  assert.ok(breakIt, `no defect named "${defect}"`);
  const broken = committed();
  breakIt(broken);
  this.state['broken'] = broken;
});

Then('parsing the broken profile fails with {string}', function (pattern: string) {
  assert.throws(() => parseTemplate(stored(this, 'broken')), messageMatches(pattern));
});

Then('loading the profile {string} fails with {string}', function (name: string, pattern: string) {
  assert.throws(() => loadTemplate(PROFILES, name), messageMatches(pattern));
});

Then('the resolved profile contains no {string} placeholder', function (marker: string) {
  assert.ok(!JSON.stringify(resolved(this)).includes(marker));
});

Then('the resolved write denials include {string}', function (path: string) {
  assert.ok(resolved(this).settings.filesystem.denyWrite.includes(path));
});

Then('the resolved environment sets {string} to {string}', function (name: string, value: string) {
  assert.equal(resolved(this).env.set[name], value);
});

Then('the resolved network domains include {string}', function (domain: string) {
  assert.ok(resolved(this).settings.network.allowedDomains.includes(domain));
});

/** Resolves a copy of the committed file after `change`; the failure (or null) is kept for the Then step. */
function resolveCopy(world: SandboxWorld, change: (copy: Record<string, any>) => void): void {
  const copy = committed();
  change(copy);
  try {
    resolveProfile(parseTemplate(copy), VARS);
    world.state['resolveError'] = null;
  } catch (error) {
    world.state['resolveError'] = error;
  }
}

When('I resolve a copy of the profile with {string} added to allowWrite', function (path: string) {
  resolveCopy(this, (copy) => copy['srt']['filesystem']['allowWrite'].push(path));
});

When('I resolve a copy of the profile with a file {string} outside allowWrite', function (file: string) {
  resolveCopy(this, (copy) => (copy['files'][file] = {}));
});

Then('resolving it fails with {string}', function (pattern: string) {
  const error = stored<unknown>(this, 'resolveError');
  assert.ok(error !== null, 'resolving did not fail');
  messageMatches(pattern)(error);
});

When('I build the closed environment from the host environment:', function (table: DataTable) {
  this.state['closedEnv'] = closedEnv(resolved(this), pairs(table));
});

Then('the closed environment is exactly:', function (table: DataTable) {
  assert.deepEqual(stored(this, 'closedEnv'), pairs(table));
});
