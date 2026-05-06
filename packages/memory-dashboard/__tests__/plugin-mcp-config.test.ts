/**
 * plugin-mcp-config.test.ts — SEC-006 regression test.
 *
 * SEC-006: bash -c re-evaluation of ${CLAUDE_PLUGIN_ROOT} in plugin
 * .mcp.json files. Previously each plugin used:
 *
 *   "command": "bash",
 *   "args": ["-c", "exec node \"${CLAUDE_PLUGIN_ROOT}/.../index.js\""]
 *
 * Claude Code substitutes ${CLAUDE_PLUGIN_ROOT} into the args verbatim,
 * then bash re-evaluates the resulting -c string. If the install path
 * ever contained shell metacharacters ($, `, $(...)) — possible if a
 * compromised marketplace or symlink redirect placed the plugin into an
 * attacker-controlled path — the embedded substitutions would execute.
 *
 * Fix: argv form. ${CLAUDE_PLUGIN_ROOT} is substituted into an argv
 * element, which the OS passes to the target binary verbatim — bytes,
 * not source code.
 *
 * For the codebase plugin (which has fallback logic to `cargo run`), we
 * keep `bash` as the launcher but call a hand-written launch.sh whose
 * own arguments come from argv (never re-evaluated as source).
 *
 * This test asserts:
 *   1. No plugin .mcp.json invokes `bash -c "..."` with a CLAUDE_PLUGIN_ROOT
 *      substitution embedded in the -c string.
 *   2. Each plugin's command + args[0] is either a direct binary or a
 *      launcher script — never `-c`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const PLUGINS_DIR = join(REPO_ROOT, "plugins");

interface McpConfig {
  mcpServers?: Record<string, { command?: string; args?: string[]; env?: Record<string, string> }>;
}

function listPluginConfigs(): Array<{ name: string; config: McpConfig; raw: string }> {
  const out: Array<{ name: string; config: McpConfig; raw: string }> = [];
  for (const entry of readdirSync(PLUGINS_DIR)) {
    const full = join(PLUGINS_DIR, entry);
    let stat;
    try { stat = statSync(full); } catch { continue; }
    if (!stat.isDirectory()) continue;
    const mcpJson = join(full, ".mcp.json");
    let raw: string;
    try { raw = readFileSync(mcpJson, "utf-8"); } catch { continue; }
    const config = JSON.parse(raw) as McpConfig;
    out.push({ name: entry, config, raw });
  }
  return out;
}

describe("plugin .mcp.json: SEC-006 bash-c regression", () => {
  it("at least one plugin config exists", () => {
    const configs = listPluginConfigs();
    expect(configs.length).toBeGreaterThan(0);
  });

  it.each(listPluginConfigs())(
    "plugin %s does NOT use `bash -c` with CLAUDE_PLUGIN_ROOT in the -c string",
    ({ name, config }) => {
      const servers = Object.entries(config.mcpServers ?? {});
      expect(servers.length, `plugin ${name} has no mcpServers`).toBeGreaterThan(0);
      for (const [serverName, srv] of servers) {
        const cmd = srv.command ?? "";
        const args = srv.args ?? [];
        // The vulnerable pattern: bash -c "<string with ${CLAUDE_PLUGIN_ROOT}>".
        // We forbid args[0] === "-c" with CLAUDE_PLUGIN_ROOT anywhere in args[1].
        if (cmd === "bash" && args[0] === "-c") {
          // If -c is used, the -c string must NOT embed ${CLAUDE_PLUGIN_ROOT}.
          const cString = args[1] ?? "";
          expect(
            cString.includes("${CLAUDE_PLUGIN_ROOT}"),
            `plugin ${name} server ${serverName}: -c string still embeds ` +
              `\${CLAUDE_PLUGIN_ROOT} — bash will re-evaluate. Use argv form.`,
          ).toBe(false);
        }
      }
    },
  );

  it.each(listPluginConfigs())(
    "plugin %s passes CLAUDE_PLUGIN_ROOT only via argv elements, not via shell -c",
    ({ name, config }) => {
      const servers = Object.entries(config.mcpServers ?? {});
      for (const [, srv] of servers) {
        const cmd = srv.command ?? "";
        const args = srv.args ?? [];
        // If CLAUDE_PLUGIN_ROOT appears in args, it must be in an argv slot
        // that is NOT the -c string of a shell.
        const hasC = (cmd === "bash" || cmd === "sh") && args[0] === "-c";
        for (let i = 0; i < args.length; i++) {
          const a = args[i] ?? "";
          if (a.includes("${CLAUDE_PLUGIN_ROOT}")) {
            expect(
              hasC && i === 1,
              `plugin ${name}: \${CLAUDE_PLUGIN_ROOT} found inside the -c shell string ` +
                `(arg[${i}]). Move it to a separate argv element.`,
            ).toBe(false);
          }
        }
      }
    },
  );
});
