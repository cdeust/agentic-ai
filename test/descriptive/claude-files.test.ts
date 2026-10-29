import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Frontmatter of the descriptive files Claude Code reads in this repository. Field names follow the
 * subagent reference (code.claude.com/docs/en/sub-agents, "Frontmatter reference": name and description
 * are required; unrecognised fields are silently ignored, so a strict schema catches a misspelt one).
 */
const SubagentSchema = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/),
  description: z.string().min(1),
  tools: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
});
const CommandSchema = z.strictObject({
  description: z.string().min(1),
  'allowed-tools': z.string().min(1).optional(),
  'argument-hint': z.string().optional(),
  model: z.string().optional(),
});

function frontmatter(text: string): unknown {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (match === null || (match[2] ?? '').trim() === '')
    throw new Error('expected YAML frontmatter and a body');
  return parse(match[1] ?? '');
}

const filesIn = (dir: string) =>
  readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith('.md'))
    .map((f) => ({ file: f, text: readFileSync(join(ROOT, dir, f), 'utf8') }));

describe('.claude descriptive files', () => {
  const agents = filesIn('.claude/agents');

  it.each(agents.map((a) => [a.file, a.text]))(
    'subagent %s has a valid frontmatter and a prompt',
    (file, text) => {
      const agent = SubagentSchema.parse(frontmatter(text));
      expect(`${agent.name}.md`).toBe(file);
    },
  );

  it.each(filesIn('.claude/commands').map((c) => [c.file, c.text]))(
    'command %s has a valid frontmatter, and every subagent it names exists',
    (_file, text) => {
      CommandSchema.parse(frontmatter(text));
      for (const named of text.match(/[a-z]+-reviewer/g) ?? []) {
        expect(agents.map((a) => a.file)).toContain(`${named}.md`);
      }
    },
  );

  it('rejects an invalid descriptive file', () => {
    expect(() => frontmatter('no frontmatter')).toThrow();
    expect(() => SubagentSchema.parse(frontmatter('---\nname: x\n---\nbody\n'))).toThrow();
    expect(() =>
      SubagentSchema.parse(frontmatter('---\nname: x\ndescription: d\nallowed_tools: Read\n---\nbody\n')),
    ).toThrow();
  });

  it('keeps .claude/settings.json valid JSON with permission rule lists', () => {
    const settings = JSON.parse(readFileSync(join(ROOT, '.claude/settings.json'), 'utf8')) as unknown;
    z.object({ permissions: z.object({ allow: z.array(z.string()), deny: z.array(z.string()) }) }).parse(
      settings,
    );
  });
});
