import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { Given, ROOT, Then, stored } from './helpers.js';

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

interface Described {
  path: string;
  text: string;
}

Given('the committed file {string}', function (path: string) {
  this.state['described'] = { path, text: readFileSync(join(ROOT, path), 'utf8') } satisfies Described;
});

Then('it has a valid subagent frontmatter and a prompt', function () {
  const described = stored<Described>(this, 'described');
  this.state['subagent'] = SubagentSchema.parse(frontmatter(described.text));
});

Then('its subagent name is the name of the file', function () {
  const agent = stored<z.infer<typeof SubagentSchema>>(this, 'subagent');
  assert.equal(`${agent.name}.md`, basename(stored<Described>(this, 'described').path));
});

Then('it has a valid command frontmatter and a prompt', function () {
  CommandSchema.parse(frontmatter(stored<Described>(this, 'described').text));
});

Then('every subagent it names exists in .claude\\/agents', function () {
  const agents = readdirSync(join(ROOT, '.claude/agents')).filter((f) => f.endsWith('.md'));
  for (const named of stored<Described>(this, 'described').text.match(/[a-z]+-reviewer/g) ?? []) {
    assert.ok(agents.includes(`${named}.md`), `subagent ${named} does not exist`);
  }
});

Then('a text without frontmatter is rejected', function () {
  assert.throws(() => frontmatter('no frontmatter'));
});

Then('a subagent frontmatter without description is rejected', function () {
  assert.throws(() => SubagentSchema.parse(frontmatter('---\nname: x\n---\nbody\n')));
});

Then('a subagent frontmatter with the misspelt field allowed_tools is rejected', function () {
  assert.throws(() =>
    SubagentSchema.parse(frontmatter('---\nname: x\ndescription: d\nallowed_tools: Read\n---\nbody\n')),
  );
});

Then('the committed .claude\\/settings.json is valid JSON with permission rule lists', function () {
  const settings = JSON.parse(readFileSync(join(ROOT, '.claude/settings.json'), 'utf8')) as unknown;
  z.object({ permissions: z.object({ allow: z.array(z.string()), deny: z.array(z.string()) }) }).parse(
    settings,
  );
});
