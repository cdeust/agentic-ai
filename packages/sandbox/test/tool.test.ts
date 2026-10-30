import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadTool, parseTool } from '../src/tool.js';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(PKG, '..', '..');
const committed = (): Record<string, any> =>
  JSON.parse(readFileSync(join(PKG, 'code.json'), 'utf8')) as Record<string, any>;

describe('code.json (descriptive file of the 1a.0 tool)', () => {
  it('loads against the strict schema: builder profile, claude, builder-guard plugin', () => {
    const tool = loadTool(join(PKG, 'code.json'));
    expect(tool.profile).toBe('builder');
    expect(tool.command).toEqual(['claude']);
    expect(tool.pluginDirs).toEqual(['plugins/builder-guard']);
    expect(() =>
      readFileSync(join(ROOT, tool.pluginDirs[0] as string, '.claude-plugin', 'plugin.json')),
    ).not.toThrow();
  });

  it.each([
    ['a misspelt key', (t: Record<string, any>) => (t['plugins'] = [])],
    ['an empty command', (t: Record<string, any>) => (t['command'] = [])],
  ])('rejects a broken copy with %s', (_, breakIt) => {
    const broken = committed();
    breakIt(broken);
    expect(() => parseTool(broken)).toThrow();
  });
});
