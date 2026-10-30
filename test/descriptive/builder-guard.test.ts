import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { decide, loadRules, type Rules } from '../../plugins/builder-guard/hooks/guard.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
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
          hooks: z.array(z.strictObject({ type: z.literal('command'), command: z.string().min(1) })).min(1),
        }),
      )
      .length(1),
  }),
});

const committed = (): Record<string, any> =>
  JSON.parse(readFileSync(join(HOOKS, 'rules.json'), 'utf8')) as Record<string, any>;
const rules: Rules = loadRules();
const bash = (command: string) => decide({ tool_name: 'Bash', tool_input: { command } }, rules);
const file = (tool_name: string, file_path: string) =>
  decide({ tool_name, tool_input: { file_path } }, rules);

describe('builder-guard plugin (descriptive files)', () => {
  it('loads rules.json and hooks.json against their strict schemas', () => {
    expect(RulesSchema.safeParse(committed()).success).toBe(true);
    const hooks = HooksSchema.parse(JSON.parse(readFileSync(join(HOOKS, 'hooks.json'), 'utf8')));
    expect(hooks.hooks.PreToolUse[0]?.matcher.split('|')).toEqual(
      expect.arrayContaining(['Bash', 'Read', 'Write', 'Edit']),
    );
  });

  it.each([
    ['an invalid regular expression', (r: Record<string, any>) => (r['bash'][0]['pattern'] = '(')],
    ['a rule without reason', (r: Record<string, any>) => delete r['bash'][0]['reason']],
    ['a misspelt key', (r: Record<string, any>) => (r['paths'][0]['tool'] = ['Read'])],
  ])('rejects a broken copy with %s', (_, breakIt) => {
    const broken = committed();
    breakIt(broken);
    expect(RulesSchema.safeParse(broken).success).toBe(false);
  });
});

describe('builder-guard decisions (minimal set of decision 2)', () => {
  it.each([
    ['git push origin main', 'push-main'],
    ['git push --dry-run nowhere main', 'push-main'],
    ['git push origin HEAD:main', 'push-main'],
    ['git push origin feat/x:refs/heads/main', 'push-main'],
    ['cd x && git -C . push -u origin main', 'push-main'],
    ['git push --force origin feat/x', 'push-force'],
    ['git push -f origin feat/x', 'push-force'],
    ['git push -uf origin feat/x', 'push-force'],
    ['git push --force-with-lease origin feat/x', 'push-force'],
    ['git push origin +feat/x', 'push-force'],
    ['security find-generic-password -s x', 'keychain'],
    ['security find-internet-password -s github.com -w', 'keychain'],
    ['/usr/bin/security dump-keychain -d', 'keychain'],
    ['cat ~/.ssh/id_ed25519', 'secret-files'],
    ['ls $HOME/.aws', 'secret-files'],
    ['cat ~/.npmrc', 'secret-files'],
    ['cat ~/.netrc', 'secret-files'],
    ['gpg --homedir ~/.gnupg -k', 'secret-files'],
    ['cat ~/.config/gh/hosts.yml', 'secret-files'],
    ['echo x > ../../../.git/hooks/pre-commit', 'git-hooks-config-write'],
    ['cp payload .git/hooks/post-checkout', 'git-hooks-config-write'],
    ['echo "[core]" >> /r/.git/config', 'git-hooks-config-write'],
    ['git config core.hooksPath /tmp/h', 'git-config-write'],
    ['git config --local user.name x', 'git-config-write'],
  ])('denies Bash `%s` (%s)', (command, rule) => {
    expect(bash(command)).toMatchObject({ allow: false, rule });
  });

  it.each([
    'git push origin feat/tool-1a0',
    'git push -u origin feat/x',
    'git commit -m "maintain the domain"',
    'git log main..HEAD',
    'git checkout -b mainline',
    'npm run check',
    'git config --get user.name',
    'git config -l',
    'cat .git/config',
    'ls .git/hooks',
    'security --help',
    'echo sshd',
  ])('allows Bash `%s`', (command) => {
    expect(bash(command)).toEqual({ allow: true });
  });

  it.each([
    ['Read', '/home/u/.ssh/id_rsa', 'secret-files'],
    ['Read', '/home/u/.aws/credentials', 'secret-files'],
    ['Read', '/home/u/.npmrc', 'secret-files'],
    ['Edit', '/r/.netrc', 'secret-files'],
    ['Write', '/r/.git/hooks/pre-commit', 'git-hooks-config-write'],
    ['Edit', '/r/.git/config', 'git-hooks-config-write'],
  ])('denies %s on %s (%s)', (tool, path, rule) => {
    expect(file(tool, path)).toMatchObject({ allow: false, rule });
  });

  it.each([
    ['Read', '/r/.git/config'],
    ['Write', '/r/src/config.ts'],
    ['Edit', '/r/docs/ssh.md'],
    ['Read', '/r/.claude/worktrees/w/package.json'],
  ])('allows %s on %s', (tool, path) => {
    expect(file(tool, path)).toEqual({ allow: true });
  });

  it('denies by exit code 2 with the reason on stderr when run as the hook command', () => {
    const run = (input: unknown) => {
      try {
        const text = typeof input === 'string' ? input : JSON.stringify(input);
        execFileSync('node', [join(HOOKS, 'guard.ts')], { input: text, stdio: 'pipe' });
        return { code: 0, stderr: '' };
      } catch (error) {
        const e = error as { status: number; stderr: Buffer };
        return { code: e.status, stderr: e.stderr.toString() };
      }
    };
    expect(run({ tool_name: 'Bash', tool_input: { command: 'git push origin main' } })).toEqual({
      code: 2,
      stderr: expect.stringContaining('builder-guard [push-main]'),
    });
    expect(
      run({ tool_name: 'Bash', tool_input: { command: 'security find-generic-password -s x' } }),
    ).toEqual({
      code: 2,
      stderr: expect.stringContaining('builder-guard [keychain]'),
    });
    expect(run({ tool_name: 'Bash', tool_input: { command: 'git status' } })).toEqual({
      code: 0,
      stderr: '',
    });
    expect(run('{not json').code).toBe(2);
  });
});
