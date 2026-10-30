// PreToolUse guard of the builder-guard plugin (brick 1a.0, decision 2). Run by node, types stripped natively.
// Reads the hook input on stdin, applies rules.json, and denies with exit code 2 and the reason on stderr
// (code.claude.com/docs/en/hooks, "Exit code 2": blocks the tool call, stderr is shown to Claude).
// A reduction layer beside srt, not a boundary: an obfuscated command or a script started by npm escapes it.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Rule {
  id: string;
  pattern: string;
  reason: string;
  tools?: string[];
}
export interface Rules {
  description: string;
  bash: Rule[];
  paths: Rule[];
}
export interface HookInput {
  tool_name?: unknown;
  tool_input?: unknown;
}
export type Decision = { allow: true } | { allow: false; rule: string; reason: string };

const PATH_FIELDS = ['file_path', 'notebook_path', 'path', 'pattern'];

export function loadRules(file = join(dirname(fileURLToPath(import.meta.url)), 'rules.json')): Rules {
  const rules = JSON.parse(readFileSync(file, 'utf8')) as Rules;
  for (const rule of [...rules.bash, ...rules.paths]) new RegExp(rule.pattern, 'i');
  return rules;
}

export function decide(input: HookInput, rules: Rules): Decision {
  const tool = typeof input.tool_name === 'string' ? input.tool_name : '';
  const args = (
    typeof input.tool_input === 'object' && input.tool_input !== null ? input.tool_input : {}
  ) as Record<string, unknown>;
  const deny = (rule: Rule): Decision => ({ allow: false, rule: rule.id, reason: rule.reason });
  if (tool === 'Bash') {
    const command = typeof args['command'] === 'string' ? args['command'] : '';
    for (const rule of rules.bash) if (new RegExp(rule.pattern, 'i').test(command)) return deny(rule);
    return { allow: true };
  }
  const values = PATH_FIELDS.map((field) => args[field]).filter((v): v is string => typeof v === 'string');
  for (const rule of rules.paths) {
    if (rule.tools !== undefined && !rule.tools.includes(tool)) continue;
    if (values.some((value) => new RegExp(rule.pattern, 'i').test(value))) return deny(rule);
  }
  return { allow: true };
}

function main(): void {
  let input: HookInput;
  try {
    input = JSON.parse(readFileSync(0, 'utf8')) as HookInput;
  } catch {
    process.stderr.write('builder-guard: unreadable hook input, call refused\n');
    process.exit(2);
  }
  const decision = decide(input, loadRules());
  if (!decision.allow) {
    process.stderr.write(`builder-guard [${decision.rule}]: ${decision.reason}\n`);
    process.exit(2);
  }
  process.exit(0);
}

if (import.meta.main) main();
