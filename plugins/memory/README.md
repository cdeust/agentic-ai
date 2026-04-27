# memory plugin

**Source:** `cdeust/Cortex` v3.14.8

Persistent memory for Claude Code. Install it once; it remembers everything across sessions
automatically via background hooks.

## What you get

- 47 MCP tools (`cortex:recall`, `cortex:remember`, `cortex:query_methodology`, etc.)
- 6 lifecycle hooks (SessionStart, UserPromptSubmit, PostToolUse x3, SessionEnd, Notification, SubagentStart)
- 14 skills (`/skill run cortex-recall`, `cortex-profile`, `cortex-wiki-author`, etc.)
- 1 command (`/methodology`)

## Dependencies

- Python 3.9+
- **CLI mode** (full feature set): PostgreSQL 15+ with the `pgvector` extension
- **Cowork/sandboxed mode** (automatic fallback): SQLite — no external DB required

Set `CORTEX_RUNTIME=cowork` or leave `DATABASE_URL` unset to force SQLite mode.

## First-run

On `SessionStart`, the hook runs `launcher.py mcp_server.hooks.session_start` which:
1. Verifies the DB connection (or initializes SQLite fallback)
2. Loads the cognitive profile for the current working directory
3. Injects the profile into the session context

If the DB is unreachable, Cortex logs a warning and continues in degraded mode (no
persistent memory, but tools remain available for the session).

## MCP tool prefix

After installation: `mcp__plugin_memory_cortex__<tool_name>`

Example: `mcp__plugin_memory_cortex__recall`
