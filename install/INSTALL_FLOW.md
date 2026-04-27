# Install Flow — Model Reader Artifact

## Model Reader Definition

Before designing this document, we must define who reads it. A first-time user of the
unified agentic-ai plugin system:

**Competencies assumed:**
- Knows Claude Code is running and functional
- Has used `/plugin marketplace add <repo>` at least once (or has read the Claude Code plugin docs)
- Understands that MCP tools appear as callable functions in Claude's context
- Does NOT know what Cortex, automatised-pipeline, or zetetic-team-subagents are
- Does NOT know PostgreSQL, pgvector, Rust, or LadybugDB are required for some plugins
- Will interpret silence as success: if nothing errors, they assume everything works

**Interpretive moves the user makes at each step:**
1. "I ran the command — what should I expect to see?"
2. "Something appeared — is that correct, or is something still missing?"
3. "A tool is available — what do I call first?"
4. "Nothing happened at SessionStart — did the plugin install correctly?"
5. "An error appeared — which plugin caused it, and how do I fix it?"

**The semiotic standard:** Every move that lacks a clear, unambiguous answer is a
defect in the install design. The unified plugin must be MORE discoverable than four
separate plugins were.

---

## Step 1: Add the marketplace

```
/plugin marketplace add cdeust/agentic-ai
```

**What the user expects:** A confirmation that the marketplace was added.

**What actually happens:** Claude Code fetches `.claude-plugin/marketplace.json` from
`github.com/cdeust/agentic-ai` and registers it locally. The user now has a local
registry of 4 available plugins.

**What the user should see:**
```
Marketplace 'agentic-ai-marketplace' added.
4 plugins available: memory, codebase, reasoning, prd
Run /plugin list agentic-ai to see details.
```

**What could go wrong:**
- Network error: `failed to fetch marketplace from github.com/cdeust/agentic-ai`
  → Diagnosis: check internet connectivity; check the repo is public
- Repo not found (404): the repo name `agentic-ai` is wrong or private
  → Diagnosis: verify `gh repo view cdeust/agentic-ai` works
- `marketplace.json` parse error: invalid JSON in the manifest
  → Diagnosis: `jq . .claude-plugin/marketplace.json` in the local repo

**Proactive surface:** The marketplace listing should immediately show all 4 plugins
with one-line descriptions so the user can decide what to install without reading docs.

---

## Step 2: List and inspect available plugins

```
/plugin list agentic-ai
```

**What the user expects:** A list of 4 plugins with descriptions.

**What should appear:**
```
Plugins from agentic-ai-marketplace (cdeust/agentic-ai):

  memory     v3.14.8    Persistent memory across sessions (47 MCP tools)
             Category: productivity | Runtime: cli, cowork
             Requires: PostgreSQL 15+ with pgvector (cli) or SQLite (cowork)

  codebase   v0.0.4     Codebase intelligence: call graphs, impact analysis (23 MCP tools)
             Category: development | Runtime: cli
             Requires: Rust toolchain for first-run compilation

  reasoning  v2.13.1    97 genius reasoning patterns + 19 team agents (61 skills, 25 commands)
             Category: research | Runtime: cli, cowork
             Requires: Bash, Python 3

  prd        v0.3.0     Generate 9-file PRDs from feature descriptions (17 MCP tools)
             Category: documentation | Runtime: cli, cowork
             Requires: Node.js 18+
```

**Model Reader failure mode:** If the listing does not show runtime requirements,
the user will install `memory` and then be confused when Claude Code says the cortex
MCP server failed to start because PostgreSQL is missing. The dependency information
MUST appear in the listing, not just in the README.

**Open question OQ-1:** Does the Claude Code `/plugin list` command display the
`runtime_notes` field from `marketplace.json`? If not, the runtime requirements are
invisible to the user at this step. The implementer must either: (a) confirm the field
is surfaced, or (b) add it to `description` as a parenthetical.

---

## Step 3: Install plugins (individually)

Install each plugin separately. The user selects based on their needs.

### 3a. Install memory (Cortex)

```
/plugin install memory@agentic-ai
```

**What should happen:**
1. Claude Code downloads the plugin sources from `cdeust/Cortex`
2. Sets `CLAUDE_PLUGIN_ROOT` to the install directory
3. Registers the MCP server `cortex` using `.claude-plugin/memory/.mcp.json`
4. Registers hooks: SessionStart, UserPromptSubmit, PostToolUse (×3), SessionEnd, Notification, SubagentStart

**What the user should see:**
```
Installing memory@agentic-ai (cortex v3.14.8)...
MCP server 'cortex' registered.
Hooks registered: SessionStart, UserPromptSubmit, PostToolUse, SessionEnd, Notification, SubagentStart
Run /reload-plugins to activate.
```

**What could go wrong and how the user diagnoses it:**

| Failure | Error message | Diagnosis |
|---|---|---|
| PostgreSQL not running | `MCP server 'cortex' failed to start: connection refused` | Start PostgreSQL: `brew services start postgresql` or set `CORTEX_RUNTIME=cowork` in `.mcp.json` env |
| pgvector not installed | `extension "vector" does not exist` | `psql cortex -c 'CREATE EXTENSION vector'` |
| Python not found | `python3: command not found` | Install Python 3.9+ |
| Wrong CLAUDE_PLUGIN_ROOT | Tools load but `launcher.py` not found | Symptom of the `${CLAUDE_PLUGIN_ROOT:-$PWD}` bug — ensure the fixed `.mcp.json` is used |

**Proactive surface:** The `memory` plugin README and `runtime_notes` field must state
upfront: "CLI mode requires PostgreSQL 15+ with pgvector. To skip PostgreSQL, add
`CORTEX_RUNTIME=cowork` to the env in `.claude-plugin/memory/.mcp.json`."

**Model Reader move gap:** The user has no way to know they should set `CORTEX_RUNTIME=cowork`
without reading the README. The install flow should ask: "Do you have PostgreSQL running?
[y/N] → N: installing in Cowork (SQLite) mode." This interactive prompt is not part of
the current Claude Code plugin install protocol.
**Open question OQ-2:** Does Claude Code support interactive prompts during plugin install?
If not, the default must be SQLite (cowork) mode, with CLI mode as opt-in.

### 3b. Install codebase (automatised-pipeline)

```
/plugin install codebase@agentic-ai
```

**What could go wrong:**

| Failure | Symptom | Diagnosis |
|---|---|---|
| Rust not installed | `MCP server 'ai-architect' failed to start: cargo: command not found` | Install Rust: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| First-run compilation | Long pause (2–5 min) with no feedback | Normal; binary is being compiled. Claude Code should show a progress indicator. |
| Compilation fails | `error[E0xxx]: ...` | Check `cargo build --release` output manually |

**Open question OQ-3:** Does the MCP server start process have a timeout? A 5-minute
compile will exceed most MCP startup timeouts. The recommended mitigation is to
pre-build the binary as part of a `postInstall` script. Currently no `postInstall` is
declared in `codebase/plugin.json`. The implementer should add one.

### 3c. Install reasoning (zetetic-team-subagents)

```
/plugin install reasoning@agentic-ai
```

**What should happen:**
1. Plugin sources installed
2. `postInstall` script runs: `scripts/setup.sh install` → copies agents/skills/commands/hooks to `~/.claude/`
3. MCP server `memory` registered (optional)

**What could go wrong:**

| Failure | Symptom | Diagnosis |
|---|---|---|
| postInstall fails silently | Hooks run but scripts not found | `ls ~/.claude/hooks/` — if empty, run `bash <plugin-root>/scripts/setup.sh install` manually |
| CLAUDE_PLUGIN_ROOT not set in postInstall | setup.sh uses wrong path | Verify that Claude Code passes `CLAUDE_PLUGIN_ROOT` to the postInstall environment |
| agents/ not found by Claude Code | `/genius invoke feynman` unknown command | Check `~/.claude/agents/` exists and was populated by setup.sh |

**Open question OQ-4:** Does Claude Code set `CLAUDE_PLUGIN_ROOT` during `postInstall`
command execution? If not, `bash ${CLAUDE_PLUGIN_ROOT}/scripts/setup.sh install` will
fail — `${CLAUDE_PLUGIN_ROOT}` will be empty. This is a critical gap. The postInstall
command string uses `${CLAUDE_PLUGIN_ROOT}` but if the variable isn't exported to the
install-time shell environment, the setup.sh never runs and the user gets hooks that
silently fail.

### 3d. Install prd (prd-spec-generator)

```
/plugin install prd@agentic-ai
```

**What could go wrong:**

| Failure | Symptom | Diagnosis |
|---|---|---|
| Node.js not installed | `MCP server 'prd-gen' failed to start: node: command not found` | Install Node.js 18+: `nvm install 18` or `brew install node` |
| Wrong Node.js version | `SyntaxError: Unexpected token` or similar | `node --version` must show ≥18. Upgrade via nvm. |
| EvidenceDB init failure | First `/generate-prd` fails with SQLite error | Check `${CLAUDE_PLUGIN_ROOT}/.prd-gen/` directory exists and is writable |

---

## Step 4: Reload plugins

```
/reload-plugins
```

**What the user expects:** All installed plugins become active.

**What should happen:** Claude Code restarts MCP servers, re-registers hooks, re-loads
skills and commands.

**What the user should see (verification):**
```
Plugins reloaded.
Active MCP servers: cortex (47 tools), ai-architect (23 tools), prd-gen (17 tools), memory (N tools)
Active hooks: [list]
```

**Verification checklist (what the user should check):**

1. Run `/mcp` or equivalent to list active MCP tools.
   Expected prefixes:
   - `mcp__plugin_memory_cortex__*` (47 tools: recall, remember, query_methodology, etc.)
   - `mcp__plugin_codebase_ai-architect__*` (23 tools: index_codebase, query_graph, etc.)
   - `mcp__plugin_prd_prd-gen__*` (17 tools: start_pipeline, generate_prd, etc.)
   - `mcp__plugin_reasoning_memory__*` (N tools: from zetetic memory server, if installed)

2. Check skills: `/skill list` should show skills from `memory/` and `reasoning/` categories.

3. Check commands: `/help` or similar should show `methodology`, `generate-prd`, and all
   reasoning commands.

**Open question OQ-5:** What is the exact MCP tool prefix format in Claude Code?
The assumed format `mcp__plugin_<plugin-id>_<server-key>__<tool>` has not been
verified against the actual Claude Code plugin resolution. If wrong, the user will not
find the tools. The implementer must verify this by installing one plugin and running
`/mcp` to inspect the actual prefix.

---

## Step 5: First-run verification per plugin

### memory

On next `SessionStart`, Cortex runs `session_start` hook. The user should see
(in the Claude Code session output):
```
[cortex] Session started. Cognitive profile loaded for <cwd>.
[cortex] 0 prior memories found. Clean session.
```
(Or a count of prior memories if not the first session.)

If nothing appears: the `SessionStart` hook is not firing.
Diagnosis: check `~/.claude/settings.json` hooks configuration; verify the hook
command resolves correctly.

**First memory test:**
```
/skill run cortex-remember "This is a test memory"
```
Then: `/skill run cortex-recall "test"` — should return the stored memory.

### codebase

First use requires indexing:
```
mcp__plugin_codebase_ai-architect__index_codebase { "path": "." }
```
This may take 30–120 seconds for a large repo.

**Open question OQ-6:** Is `index_codebase` called automatically on first install, or
does the user have to call it manually? If manual, the first-run experience is a blank
graph with no discoverable next action. The install flow should print:
"To index your current codebase, call: `mcp__plugin_codebase_ai-architect__index_codebase { \"path\": \".\" }`"

### reasoning

After `postInstall`, the user can invoke any genius pattern:
```
/genius invoke feynman
```
Or spawn a team agent:
```
/agent spawn architect
```

**First-run test:** `/genius index` — should list all 97 patterns.
If this command is unknown: `postInstall` did not copy commands to `~/.claude/commands/`.

### prd

```
/generate-prd "Add user authentication"
```
This is the entry point. Should produce 9 files in the current working directory.

**Open question OQ-7:** Where does `prd` write its output files? The current working
directory? A configurable output path? If the user is in `/` or a read-only directory,
the command will fail without a clear error. The `plugin.json` or `README.md` should
specify the output location and how to configure it.

---

## What the install flow MUST proactively surface

The following information must appear WITHOUT the user needing to diagnose:

| # | Information | Where to surface it |
|---|---|---|
| 1 | `memory` requires PostgreSQL OR cowork mode | `marketplace.json` runtime_notes + install step confirmation |
| 2 | `codebase` requires Rust + long first-compile | `marketplace.json` runtime_notes + README first-run section |
| 3 | `reasoning` requires postInstall to complete successfully | Explicit success/failure message from postInstall |
| 4 | `prd` requires Node.js 18+ | `marketplace.json` runtime_notes |
| 5 | `codebase` requires manual `index_codebase` call before any tools work | README + install confirmation message |
| 6 | MCP tool prefix format | `/reload-plugins` output should list active tools with their full prefixes |
| 7 | `${CLAUDE_PLUGIN_ROOT}` must be set at hook runtime (not just MCP spawn time) | Internal implementation concern; surfaced only if hooks fail |

---

## Open Questions Summary

| ID | Question | Blocking? |
|---|---|---|
| OQ-1 | Does `/plugin list` surface `runtime_notes` from marketplace.json? | High — hidden dependencies |
| OQ-2 | Does Claude Code support interactive prompts during install? (default cowork mode for memory) | High — PostgreSQL friction |
| OQ-3 | Does the MCP startup have a timeout that would kill cargo build? | High — codebase first-run |
| OQ-4 | Is `CLAUDE_PLUGIN_ROOT` set during `postInstall` command execution? | Critical — reasoning hooks never install |
| OQ-5 | What is the exact MCP tool prefix format after plugin install? | Medium — discoverability |
| OQ-6 | Is `index_codebase` called automatically or must the user trigger it? | Medium — codebase first-run UX |
| OQ-7 | Where does `prd` write output files, and is it configurable? | Medium — prd first-run UX |

OQ-4 is the most critical: if `CLAUDE_PLUGIN_ROOT` is not exported to the postInstall
environment, the entire `reasoning` plugin's hook system silently fails to install.
