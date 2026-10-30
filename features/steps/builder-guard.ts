import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { decide, loadRules, type Decision, type Rules } from '../../plugins/builder-guard/hooks/guard.js';
import { Given, ROOT, Then, When, stored } from './helpers.js';

const HOOKS = join(ROOT, 'plugins', 'builder-guard', 'hooks');

const Regex = z.string().refine((p) => {
  try {
    new RegExp(p, 'i');
    return true;
  } catch {
    return false;
  }
}, 'invalid regular expression');
const RuleSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  pattern: Regex,
  reason: z.string().min(1),
  tools: z.array(z.string().min(1)).min(1).optional(),
});
const RulesSchema = z.strictObject({
  description: z.string().min(1),
  bash: z.array(RuleSchema).min(1),
  paths: z.array(RuleSchema.required({ tools: true })).min(1),
});
const HooksSchema = z.strictObject({
  description: z.string().min(1),
  hooks: z.strictObject({
    PreToolUse: z
      .array(
        z.strictObject({
          matcher: z.string().min(1),
          hooks: z
            .array(
              z.strictObject({
                type: z.literal('command'),
                command: z.string().min(1),
                onFailure: z.literal('block'),
              }),
            )
            .min(1),
        }),
      )
      .length(1),
  }),
});

type Json = Record<string, any>;

const committed = (): Json => JSON.parse(readFileSync(join(HOOKS, 'rules.json'), 'utf8')) as Json;
const rules: Rules = loadRules();

/** The broken copies of rules.json, by the name used in the Examples of the feature. */
const BREAKAGES: Record<string, (rules: Json) => void> = {
  'an invalid regular expression': (r) => (r['bash'][0]['pattern'] = '('),
  'a rule without reason': (r) => delete r['bash'][0]['reason'],
  'a misspelt key': (r) => (r['paths'][0]['tool'] = ['Read']),
};

Given('the committed builder-guard rules.json', function () {
  this.state['rules'] = committed();
});

Then('it satisfies the strict builder-guard rules schema', function () {
  assert.equal(RulesSchema.safeParse(stored<Json>(this, 'rules')).success, true);
});

Then('the committed builder-guard hooks.json satisfies its strict schema', function () {
  const hooks = HooksSchema.parse(JSON.parse(readFileSync(join(HOOKS, 'hooks.json'), 'utf8')));
  this.state['matchers'] = hooks.hooks.PreToolUse[0]?.matcher.split('|');
});

Then(
  'the builder-guard hook matcher covers {string}, {string}, {string} and {string}',
  function (a: string, b: string, c: string, d: string) {
    const tools = [a, b, c, d];
    const matchers = stored<string[]>(this, 'matchers');
    for (const tool of tools) assert.ok(matchers.includes(tool), `matcher does not cover ${tool}`);
  },
);

When('I break the copy with {}', function (breakage: string) {
  const breakIt = BREAKAGES[breakage];
  assert.ok(breakIt !== undefined, `no breakage named "${breakage}"`);
  breakIt(stored<Json>(this, 'rules'));
});

Then('it no longer satisfies the strict builder-guard rules schema', function () {
  assert.equal(RulesSchema.safeParse(stored<Json>(this, 'rules')).success, false);
});

When(/^builder-guard decides on the Bash command (.+)$/, function (command: string) {
  this.state['decision'] = decide({ tool_name: 'Bash', tool_input: { command } }, rules);
});

When(
  /^builder-guard decides on the (\w+) tool for the path (.+)$/,
  function (tool: string, file_path: string) {
    this.state['decision'] = decide({ tool_name: tool, tool_input: { file_path } }, rules);
  },
);

Then(/^builder-guard denies it by the rule ([a-z-]+)$/, function (rule: string) {
  const decision = stored<Decision>(this, 'decision');
  assert.equal(decision.allow, false);
  assert.equal(decision.allow === false && decision.rule, rule);
});

Then('builder-guard allows it', function () {
  assert.deepEqual(stored<Decision>(this, 'decision'), { allow: true });
});

interface HookRun {
  code: number;
  stderr: string;
}

When('the builder-guard hook command receives this input:', function (input: string) {
  let outcome: HookRun;
  try {
    execFileSync('node', [join(HOOKS, 'guard.ts')], { input, stdio: 'pipe' });
    outcome = { code: 0, stderr: '' };
  } catch (error) {
    const e = error as { status: number; stderr: Buffer };
    outcome = { code: e.status, stderr: e.stderr.toString() };
  }
  this.state['hookRun'] = outcome;
});

Then(
  'the builder-guard hook command exits with code {int} and its standard error contains {string}',
  function (code: number, text: string) {
    const outcome = stored<HookRun>(this, 'hookRun');
    assert.equal(outcome.code, code);
    assert.ok(outcome.stderr.includes(text), `stderr "${outcome.stderr}" does not contain "${text}"`);
  },
);

Then(
  'the builder-guard hook command exits with code {int} and an empty standard error',
  function (code: number) {
    assert.deepEqual(stored<HookRun>(this, 'hookRun'), { code, stderr: '' });
  },
);

Then('the builder-guard hook command exits with code {int}', function (code: number) {
  assert.equal(stored<HookRun>(this, 'hookRun').code, code);
});
