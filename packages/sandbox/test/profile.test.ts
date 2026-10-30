import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  closedEnv,
  isWritable,
  loadTemplate,
  parseTemplate,
  resolveProfile,
  type ProfileVariables,
} from '../src/profile.js';

const PROFILES = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'profiles');
const committed = (): Record<string, unknown> =>
  JSON.parse(readFileSync(join(PROFILES, 'builder.json'), 'utf8')) as Record<string, unknown>;

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

describe('builder profile template (descriptive file)', () => {
  const template = loadTemplate(PROFILES, 'builder');

  it('loads the committed file against the strict schema', () => {
    expect(template.srt.filesystem.allowWrite.length).toBeGreaterThan(0);
  });

  it('carries the builder profile adopted in decision 1 (platform-v3-srt.md, §8)', () => {
    const fs = template.srt.filesystem;
    expect(fs.allowWrite).toEqual(
      expect.arrayContaining([
        '${worktree}',
        '${repo}/.git/worktrees/${worktreeName}',
        '${repo}/.git/objects',
        '${repo}/.git/refs',
        '${repo}/.git/logs',
        '${home}/.cache',
        '${config}',
        '${tmp}',
      ]),
    );
    expect(fs.allowWrite.filter((p) => p.startsWith('${home}/.claude'))).toEqual([]);
    expect(fs.denyWrite).toEqual([
      '${repo}/.git/hooks',
      '${repo}/.git/config',
      '${repo}/.git/worktrees/${worktreeName}/commondir',
      '${repo}/.git/worktrees/${worktreeName}/gitdir',
      '${repo}/.git/worktrees/${worktreeName}/config.worktree',
      '${repo}/.git/refs/heads/main',
      '${worktree}/.claude/settings.json',
      '${worktree}/.claude/settings.local.json',
      '${config}/settings.json',
    ]);
    expect(fs.denyRead).toEqual(
      [
        '.ssh',
        '.aws',
        '.gnupg',
        '.config/gh',
        '.npmrc',
        '.netrc',
        '.claude',
        '.claude.json',
        'Library/Keychains',
      ].map((p) => `\${home}/${p}`),
    );
    expect(template.srt.allowPty).toBe(true);
    expect(template.env.set['CLAUDE_CODE_TMPDIR']).toBe('${tmp}');
    expect(template.env.unset).toEqual(['NO_PROXY', 'no_proxy']);
  });

  it('reaches the model only through the host auth proxy, with a session token and its own config dir', () => {
    expect(template.srt.network.allowedDomains).toEqual(['127.0.0.1:${authProxyPort}', 'registry.npmjs.org']);
    expect(template.env.set).toMatchObject({
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:${authProxyPort}',
      CLAUDE_CODE_OAUTH_TOKEN: '${sessionToken}',
      CLAUDE_CONFIG_DIR: '${config}',
    });
    const resolved = resolveProfile(template, VARS);
    expect(resolved.files['/t/aos/config/settings.json']).toEqual({ sandbox: { enabled: false } });
    expect(resolved.files['/t/aos/config/.claude.json']).toMatchObject({
      projects: {
        '/r': { hasTrustDialogAccepted: true },
        '/r/.claude/worktrees/w': { hasTrustDialogAccepted: true },
      },
    });
  });

  it('never makes the user settings, ~/.claude.json, plugins or the main repo writable', () => {
    const { settings } = resolveProfile(template, VARS);
    for (const path of [
      '/h/.claude/settings.json',
      '/h/.claude.json',
      '/h/.claude/plugins/x',
      '/r/.git/hooks/pre-commit',
      '/r/.git/config',
      '/r/.git/worktrees/w/commondir',
      '/r/.git/worktrees/w/gitdir',
      '/r/.git/worktrees/w/config.worktree',
      '/r/.git/refs/heads/main',
      '/r/.git/packed-refs',
      '/r/.claude/worktrees/w/.claude/settings.json',
      '/r/.claude/worktrees/w/.claude/settings.local.json',
      '/r/node_modules/.bin/srt',
      '/r/packages/sandbox/profiles/builder.json',
      '/t/aos/profile.json',
      '/t/aos/config/settings.json',
    ])
      expect(isWritable(settings, path), path).toBe(false);
    for (const path of [
      '/r/.claude/worktrees/w/src/a.ts',
      '/r/.git/objects/ab/cdef',
      '/r/.git/refs/heads/feat/x',
      '/r/.git/worktrees/w/HEAD',
      '/t/aos/config/projects/p/s.jsonl',
      '/t/aos/config/plugins/data/builder-guard-inline/x',
      '/t/aos/config/.claude.json',
      '/t/aos/tmp/x',
    ])
      expect(isWritable(settings, path), path).toBe(true);
  });

  it.each([
    ['a weakening option', (t: Record<string, any>) => (t['srt']['enableWeakerNestedSandbox'] = true)],
    ['a misspelt key [T-01]', (t: Record<string, any>) => (t['srt']['network']['strictAllowlistt'] = true)],
    ['filesystem.disabled', (t: Record<string, any>) => (t['srt']['filesystem']['disabled'] = true)],
    ['allowGitConfig', (t: Record<string, any>) => (t['srt']['filesystem']['allowGitConfig'] = true)],
    ['an API key passed through', (t: Record<string, any>) => t['env']['pass'].push('ANTHROPIC_API_KEY')],
    ['a config dir set', (t: Record<string, any>) => (t['env']['set']['CLAUDE_CONFIG_DIR'] = '/x')],
    ['NO_PROXY passed through', (t: Record<string, any>) => t['env']['pass'].push('NO_PROXY')],
    [
      'a literal token written in the file',
      (t: Record<string, any>) => (t['env']['set']['CLAUDE_CODE_OAUTH_TOKEN'] = 'sk-ant-literal'),
    ],
    [
      'a base URL to another host',
      (t: Record<string, any>) =>
        (t['env']['set']['ANTHROPIC_BASE_URL'] = 'https://evil.example/${authProxyPort}'),
    ],
    [
      'a host Claude variable passed through',
      (t: Record<string, any>) => t['env']['pass'].push('CLAUDE_CODE_OAUTH_TOKEN'),
    ],
  ])('rejects a broken copy with %s', (_, breakIt) => {
    const broken = committed();
    breakIt(broken);
    expect(() => parseTemplate(broken)).toThrow(/PROFILE_INVALID/);
  });

  it('rejects an unknown profile name and a path-like name', () => {
    expect(() => loadTemplate(PROFILES, 'nope')).toThrow(/PROFILE_INVALID/);
    expect(() => loadTemplate(PROFILES, '../builder')).toThrow(/PROFILE_INVALID/);
  });
});

describe('profile resolution', () => {
  const template = loadTemplate(PROFILES, 'builder');

  it('substitutes every variable and leaves no placeholder', () => {
    const resolved = resolveProfile(template, VARS);
    expect(JSON.stringify(resolved)).not.toContain('${');
    expect(resolved.settings.filesystem.denyWrite).toContain('/r/.git/worktrees/w/commondir');
    expect(resolved.env.set['CLAUDE_CODE_TMPDIR']).toBe('/t/aos/tmp');
    expect(resolved.env.set['ANTHROPIC_BASE_URL']).toBe('http://127.0.0.1:4321');
    expect(resolved.settings.network.allowedDomains).toContain('127.0.0.1:4321');
  });

  it('rejects an unknown variable and a relative result', () => {
    const unknown = committed() as Record<string, any>;
    unknown['srt']['filesystem']['allowWrite'].push('${nope}/x');
    expect(() => resolveProfile(parseTemplate(unknown), VARS)).toThrow(/variable inconnue/);
    const relative = committed() as Record<string, any>;
    relative['srt']['filesystem']['allowWrite'].push('rel/${worktreeName}');
    expect(() => resolveProfile(parseTemplate(relative), VARS)).toThrow(/non absolu/);
    const outside = committed() as Record<string, any>;
    outside['files']['${home}/.claude/settings.json'] = {};
    expect(() => resolveProfile(parseTemplate(outside), VARS)).toThrow(/hors de allowWrite/);
  });

  it('builds a closed environment: listed names only, then the fixed values', () => {
    const env = closedEnv(resolveProfile(template, VARS), {
      HOME: '/h',
      PATH: '/usr/bin',
      TERM: 'xterm',
      ANTHROPIC_API_KEY: 'x',
      CLAUDE_CONFIG_DIR: '/c',
      CLAUDE_CODE_OAUTH_TOKEN: 'host-token',
      NO_PROXY: '*',
      NODE_OPTIONS: '--require x',
      SECRET: 's',
    });
    expect(env).toEqual({
      HOME: '/h',
      PATH: '/usr/bin',
      TERM: 'xterm',
      CLAUDE_CODE_TMPDIR: '/t/aos/tmp',
      CLAUDE_CONFIG_DIR: '/t/aos/config',
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:4321',
      CLAUDE_CODE_OAUTH_TOKEN: 'session-token',
      npm_config_cache: '/h/.cache/npm',
    });
  });
});
