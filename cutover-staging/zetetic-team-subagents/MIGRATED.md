> **NOTICE: zetetic-team-subagents has moved to [agentic-ai](https://github.com/cdeust/agentic-ai).**
> The unified install is `@agentic/mcp-server-reasoning`. This repository will be
> archived on **2026-05-31** and is read-only after that date.

---

# zetetic-team-subagents has moved to agentic-ai

**Your question is: "I use the genius reasoning agents (or the pre-commit hook).
What do I do now?"**

---

## What you should do

### Agent users (Claude Code slash commands, `/paper-vs-code-audit`, `/autoresearch-loop`, …)

You have the agents registered in your `~/.claude/agents/` directory, either
cloned manually or installed via the Claude Code marketplace.

**Action:** Migrate to the unified reasoning server.

```bash
# Remove the old marketplace plugin (if installed that way)
claude plugin uninstall zetetic-team-subagents

# Install the unified reasoning MCP server
npm install -g @agentic/mcp-server-reasoning

# Register in your .claude/settings.json
{
  "mcpServers": {
    "reasoning": {
      "command": "mcp-server-reasoning",
      "args": []
    }
  }
}
```

All 97 genius reasoning agents and all 19 team-role agents (116 total) migrated
as `.md` prompt files under `packages/reasoning/src/agents/`. There is no
behaviour change — the agent logic is pure prompt; no executable code was
ported. The same slash commands, the same refusal conditions, the same
primary-source citations are present.

### Pre-commit hook users (zetetic-checker)

You have `hooks/pre-commit-zetetic.sh` and `tools/zetetic-checker.sh` installed
in a repository. The hook blocks commits where floating-point constants lack
`# source:` annotations.

**Action:** The hook is available as a standalone script in the monorepo.

```bash
# Fetch the updated hook from the monorepo
curl -sSL https://raw.githubusercontent.com/cdeust/agentic-ai/main/packages/reasoning/hooks/pre-commit-zetetic.sh \
  -o .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

The hook behaviour is unchanged. `ZETETIC_PROFILE=strict` still promotes
warnings to blocking errors.

### Skills and memory users

Skills (under `skills/`) and memory templates (under `memory/`) migrated
verbatim as `.md` files. If you have custom skill files, place them under
`packages/reasoning/src/skills/` in the monorepo, or keep them locally in
`~/.claude/skills/` — the Claude Code skills directory is not affected by
this migration.

---

## What changed

| Aspect | zetetic-team-subagents (this repo) | agentic-ai (`@agentic/mcp-server-reasoning`) |
|---|---|---|
| Genius agents | 97 patterns + 19 team agents = 116 total | 116 total — preserved verbatim as `.md` |
| Agent behaviour | Prompt files with refusal conditions | Identical — no behaviour change |
| Pre-commit hook | `hooks/pre-commit-zetetic.sh` | Available at monorepo `packages/reasoning/hooks/` |
| Skills | `skills/*.md` | `packages/reasoning/src/skills/*.md` |
| Memory templates | `memory/*.md` | `packages/reasoning/src/memory/*.md` |
| Primary source citations | Per agent, in agent `.md` files | Preserved verbatim |
| Install method | Clone + `~/.claude/agents/` copy | `npm i -g @agentic/mcp-server-reasoning` |

**Breaking changes: none.** All 116 agents migrated with no content changes.
All 16 lifecycle hook registrations preserved. The `.md` format means no
compiled artifact — the agents ARE the files.

---

## Schedule

| Date | Event |
|---|---|
| 2026-04-27 | Phase 6 cutover begins; `@agentic/mcp-server-reasoning` published |
| 2026-05-31 | Final commit on this repo; issues closed |
| 2026-05-31 | Repo archived (read-only) on GitHub |
| 2026-07-31 | Last support cutoff |

---

## Where to file issues

- **New bugs or agent additions** → [github.com/cdeust/agentic-ai/issues](https://github.com/cdeust/agentic-ai/issues)
- **Issues on this repo before archive date** → triaged here through 2026-05-31
- **Issues after archive date** → re-file at agentic-ai; this repo is read-only

---

*zetetic-team-subagents is the final release on this repository.*
*The agentic-ai monorepo is the successor. 97 genius patterns + 19 team agents: all present, no gaps.*
