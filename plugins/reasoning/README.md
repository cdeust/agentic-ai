# reasoning plugin

**Source:** `cdeust/zetetic-team-subagents` v2.13.1

97 genius reasoning patterns + 19 team specialist agents under one zetetic epistemic
standard. No MCP server required for the core functionality — the reasoning patterns
are CLAUDE.md agents installed into `~/.claude/` by the postInstall script.

## What you get

- 97 genius-pattern agents (Turing, Feynman, Shannon, Eco, Dijkstra, etc.) as CLAUDE.md-routed subagents
- 19 team specialist agents (engineer, architect, refactorer, test-engineer, security-auditor, etc.)
- 61 skills across 7 categories (analysis, architecture, compose, engineering, genius, research, zetetic)
- 25 commands across 9 categories (agent/, genius/, git/, quality/, research/, session/, skill/, zetetic/)
- 13 lifecycle hook scripts: PreToolUse gates (git commit/push, Edit/Write), PostToolUse recorders (difficulty, lab-notebook, balance, research-provenance), PostToolUseFailure routing, SessionStart (2 hooks), Stop, Notification

## Dependencies

- Bash (hooks)
- Python 3 (setup script)
- No external services

## First-run (postInstall)

The `postInstall` script runs `scripts/setup.sh install` which copies:
- Agent definitions to `~/.claude/agents/`
- Skills to `~/.claude/skills/`
- Commands to `~/.claude/commands/`
- Hook scripts to `~/.claude/hooks/`
- Rules to `~/.claude/rules/`

After postInstall, run `/reload-plugins` and then `/genius invoke <pattern>` to test.

If postInstall fails, the hooks will error on first run with "command not found".
Check: `ls ~/.claude/hooks/` — if empty, re-run `setup.sh install` manually.

## MCP server (optional)

A lightweight in-memory MCP server (`tools/memory-mcp-server.py`) is included.
It is a session-scoped tool, not a persistent store (use the `memory` plugin for that).

MCP tool prefix: `mcp__plugin_reasoning_memory__<tool_name>`
