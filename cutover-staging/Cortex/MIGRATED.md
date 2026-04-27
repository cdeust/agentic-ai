> **NOTICE: Cortex's runtime has moved to [agentic-ai](https://github.com/cdeust/agentic-ai).**
> The unified install is `@agentic/mcp-server-memory`. This repository will be
> archived on **2026-05-31** and is read-only after that date.
> **Exception: HTTP dashboard users — read the section below before acting.**

---

# Cortex has moved to agentic-ai

**Your question is: "I have a working Cortex install. What do I do now?"**
The answer depends on which part of Cortex you use. Find your row below.

---

## What you should do

### Path A — MCP-over-stdio user (most installs)

You run Cortex via the Claude Code marketplace and use tools like `recall`,
`remember`, `query_methodology`, `detect_domain`, or any of the 47 MCP tools
over stdio.

**Action:** Migrate to the unified package.

```bash
# Remove the old marketplace plugin
claude plugin uninstall cortex

# Install the unified server
npm install -g @agentic/mcp-server-memory

# Re-register in your .claude/settings.json
{
  "mcpServers": {
    "memory": {
      "command": "mcp-server-memory",
      "args": []
    }
  }
}
```

Then run `/cortex-setup-project` once in your Claude Code session. The 46 MCP
tool names are preserved verbatim (ADR-0011 confirmed no tool-name renames).
Your PostgreSQL database, your memories, and your cognitive profile travel with
you — the schema is unchanged.

### Path B — HTTP dashboard user

You use `python -m mcp_server.server.http_launcher` to view the 3D
graph / wiki / file-diff dashboard at `127.0.0.1`.

**Action: DO NOT migrate yet.**

The HTTP dashboard (15 files, 3 668 LOC) is deferred to post-cutover per
ADR-0011. The TypeScript port will ship as part of `@agentic/memory` v0.4.x.
Until that release:

- Keep this repo's Python install active for dashboard access.
- Use `@agentic/mcp-server-memory` for all MCP-over-stdio tool calls.
- Watch [github.com/cdeust/agentic-ai/releases](https://github.com/cdeust/agentic-ai/releases)
  for the v0.4.x announcement.

You may run both side by side: the monorepo MCP server and this repo's HTTP
server share the same PostgreSQL database without conflict.

### Path C — Hook user (SessionStart, UserPromptSubmit, PostToolUse, …)

You have lifecycle hooks registered, either manually or via `/cortex-setup-project`.

**Action:** The unified install replaces per-hook setup. After installing
`@agentic/mcp-server-memory` (Path A above), run `/cortex-setup-project` —
it re-registers all 9 hooks automatically. Manual hook files under
`~/.claude/hooks/` from the old install should be removed to avoid duplicates:

```bash
# List what the old install registered
ls ~/.claude/hooks/ | grep cortex

# Remove the old hook entries (replace with your actual filenames)
# The new install rewrites them as part of setup
```

---

## What changed

| Aspect | Cortex (this repo) | agentic-ai (`@agentic/mcp-server-memory`) |
|---|---|---|
| Runtime | Python 3.10+ | TypeScript / Node 20+ |
| Tool count | 47 MCP tools | 46 MCP tools |
| Tool names | (original names) | Preserved verbatim (ADR-0011) |
| Schema | PostgreSQL + pgvector | Unchanged — same schema |
| Hook count | 9 lifecycle hooks | 9 lifecycle hooks |
| HTTP dashboard | Available | Deferred — v0.4.x (ADR-0011) |
| Install method | `claude plugin install cortex` | `npm i -g @agentic/mcp-server-memory` |

**Breaking changes: none** for MCP-over-stdio users.
**Breaking change for HTTP dashboard users:** dashboard temporarily unavailable
in the unified install. Mitigation: stay on this repo for dashboard access
until v0.4.x (ADR-0011).

---

## Schedule

| Date | Event |
|---|---|
| 2026-04-27 | Phase 6 cutover begins; `@agentic/mcp-server-memory` published |
| 2026-05-31 | Final commit on this repo; issues closed |
| 2026-05-31 | Repo archived (read-only) on GitHub |
| 2026-07-31 | Last support cutoff — no further responses to issues on this repo |

---

## Where to file issues

- **New bugs in the unified install** → [github.com/cdeust/agentic-ai/issues](https://github.com/cdeust/agentic-ai/issues)
- **Issues filed on this repo before archive date** → will be triaged here through 2026-05-31
- **Issues filed after archive date** → please re-file at agentic-ai; this repo is read-only

---

*Cortex v3.14.2 is the final release on this repository.*
*The agentic-ai monorepo is the successor. ADR-0011 records the migration decision.*
