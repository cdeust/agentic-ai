# Cortex Hooks — Exhaustive Inventory

**Source directory**: `/Users/cdeust/Developments/Cortex/mcp_server/hooks/`
**Extracted**: 2026-04-26

NOTE: PHASE_PLAN.md §4 says "5 files". Actual count is **9 files (8 non-empty)**. Four hooks are unaccounted-for — see MISSION.md F-004.

Each hook is a standalone Python script invoked by Claude Code's hooks system.
Entry point: `python3 -m mcp_server.hooks.<name>` or via `settings.json`.
All hooks write diagnostics to **stderr only**. Nothing written to stderr reaches Claude Code.
Stdout is the injection channel for hooks where context injection applies.

---

## Hook 1: `session_start.py`

**Source**: `/Users/cdeust/Developments/Cortex/mcp_server/hooks/session_start.py` (697 LOC)

### Trigger event
`SessionStart` — fires when Claude Code starts a new session.

### Reads
- PostgreSQL `memories` table: anchored memories (`is_protected=TRUE`, `no_decay=TRUE`) up to `CORTEX_SESSION_START_ANCHOR_LIMIT` (default 5)
- PostgreSQL `memories` table: hot memories (`heat >= CORTEX_SESSION_START_MIN_HEAT`, default 0.4) up to `CORTEX_SESSION_START_LIMIT` (default 8)
- PostgreSQL `checkpoints` table: most recent active checkpoint for the session
- Environment variables: `DATABASE_URL`, `CORTEX_SESSION_START_LIMIT`, `CORTEX_SESSION_START_MIN_HEAT`, `CORTEX_SESSION_START_ANCHOR_LIMIT`, `CLAUDE_PLUGIN_ROOT`
- `~/.claude/projects/<hash>/` — project JSONL files to detect session history for backfill suggestion
- Codebase graph TTL metadata (triggers `ingest_codebase_background` if stale)

### Writes
- **stdout**: Markdown context block injected into Claude Code session (anchored memories + hot memories + checkpoint)
- **stderr**: diagnostic logs only
- Spawns `mcp_server.hooks.ingest_codebase_background` as a detached subprocess if graph is stale

### Exit-code semantics
- `exit 0` with stdout content → Claude Code injects stdout into session context window
- `exit 0` with empty stdout → no injection, no error
- No `exit 1` / `exit 2` path in this hook (failures log to stderr and fall through to `exit 0`)

### Timeout
- Subprocess calls with `timeout=15` (seconds)
- Cold-start DB setup script called with its own timeout
- The hook itself has no explicit wall-clock timeout declared; Claude Code's session-start hook budget applies

---

## Hook 2: `auto_recall.py`

**Source**: `/Users/cdeust/Developments/Cortex/mcp_server/hooks/auto_recall.py` (255 LOC)

### Trigger event
`UserPromptSubmit` — fires when the user submits a message.

### Reads
- User message from stdin (JSON)
- Cortex MCP `recall` tool via subprocess/MCP call: top-K memories matching the user prompt
- Environment variables: `DATABASE_URL` (indirect, via MCP call)

### Writes
- **stdout**: Compact Markdown snippet of top recalled memories, injected into Claude Code context before the user prompt is processed
- **stderr**: diagnostic logs

### Exit-code semantics
- `exit 0` (with stdout) → context injected
- `exit 0` (empty stdout) → no injection (if recall returns nothing relevant)
- `exit 1` → no injection (error path; hook failed silently)

### Timeout
- Must complete within **3 seconds** (Claude Code `UserPromptSubmit` hook budget)
- Comment in source: `"Must complete within 3s (hook timeout)"`, `"timeout": 3`

### Paper backing
- Smith & Vela (2001) context reinstatement d=0.28 (~15-20% recall boost)
- Bar (2007) proactive brain
- Collins & Loftus (1975) spreading activation

---

## Hook 3: `post_tool_capture.py`

**Source**: `/Users/cdeust/Developments/Cortex/mcp_server/hooks/post_tool_capture.py` (312 LOC)

### Trigger event
`PostToolUse` — fires after each tool call completes.

### Reads
- Tool call result from stdin (JSON): `tool_name`, `tool_input`, `tool_result`
- Tool filter classification:
  - **High-value** (full truncated output stored): `Edit`, `Write`, `Bash`, `MultiEdit`, `NotebookEdit`
  - **Light-value** (input reference only): `Read`, `NotebookRead`, `Glob`, `Grep`
  - **Conditional**: others, filtered by content-signal keywords

### Writes
- Cortex `remember` MCP tool call: stores tool output as a memory
- Invariant: **non-blocking** (async, best-effort)
- Invariant: **idempotent** via predictive-coding write gate (duplicate content suppressed)
- **stderr**: diagnostic logs only

### Exit-code semantics
- Always `exit 0` — non-blocking, never blocks tool execution
- `exit 2` is explicitly reserved for validation hooks (not used here)

### Timeout
- No explicit timeout declared; Claude Code's `PostToolUse` budget applies (typically 5s)

---

## Hook 4: `agent_briefing.py`

**Source**: `/Users/cdeust/Developments/Cortex/mcp_server/hooks/agent_briefing.py` (379 LOC)

### Trigger event
`SubagentStart` — fires when the orchestrator spawns a subagent.

### Reads
- Subagent task context from stdin (JSON): task description, agent ID
- Cortex `recall` tool: task-relevant memories + team decisions
- Transactive Memory Systems (Wegner 1987): retrieves "directory knowledge" (who knows what)

### Writes
- **stdout**: Agent briefing Markdown — task-relevant memories + prior team decisions
- **NOTE**: Whether `SubagentStart` stdout is injected into the agent context is not fully documented in Claude Code. The hook warms access timestamps regardless (improving subsequent recall).
- **stderr**: diagnostic logs

### Exit-code semantics
- `exit 0` → briefing written to stdout (may or may not be injected depending on Claude Code version)
- `exit 0` (empty) → no briefing if no relevant memories found

### Timeout
- Same as `UserPromptSubmit` budget (typically 3s)

### Paper backing
- Smith & Vela (2001) context reinstatement d=0.28
- Wegner (1987) Transactive Memory Systems

---

## Hook 5: `compaction_checkpoint.py`

**Source**: `/Users/cdeust/Developments/Cortex/mcp_server/hooks/compaction_checkpoint.py` (112 LOC)

### Trigger event
`Notification` with `matcher: "compacted"` — fires when Claude Code compacts the context window.

### Reads
- Event data from stdin (single JSON line): `session_id`, notification type
- Current working directory via `$PWD` or event data

### Writes
- Cortex `checkpoint` MCP tool call with `action="save"`: saves current working state before compaction
- **stderr**: diagnostic logs

### Exit-code semantics
- `exit 0` → checkpoint saved successfully
- Falls through on failure (non-blocking)

### Timeout
- **5 seconds** (explicit in `settings.json` example: `"timeout": 5`)
- Design doc: non-blocking, exits quickly even if checkpoint fails

---

## Hook 6: `session_lifecycle.py` *(UNACCOUNTED-FOR in PHASE_PLAN §4)*

**Source**: `/Users/cdeust/Developments/Cortex/mcp_server/hooks/session_lifecycle.py` (241 LOC)

### Trigger event
`SessionEnd` — fires when a Claude Code session ends.

### Reads
- Session event data from stdin (JSON): `session_id`, `domain`, `tools_used`, `duration`, `turn_count`, `keywords`
- Existing methodology profiles from disk (JSON files)

### Writes
- Profile JSON files: incremental EMA (Exponential Moving Average) update of the methodology profile for the detected domain
- Session log: appends session entry (capped at `MAX_SESSION_LOG_ENTRIES`)
- Optionally triggers memory consolidation if `turn_count` is high

### Exit-code semantics
- `exit 0` → success
- `exit 1` → failure (profile update failed); logged to stderr

### Timeout
- No explicit timeout; runs synchronously after session ends

---

## Hook 7: `preemptive_context.py` *(UNACCOUNTED-FOR in PHASE_PLAN §4)*

**Source**: `/Users/cdeust/Developments/Cortex/mcp_server/hooks/preemptive_context.py` (194 LOC)

### Trigger event
`PostToolUse` — fires after each tool call (specifically Read/Edit/Write).

### Reads
- Tool call result from stdin: `tool_name`, `tool_input.path` (file path being read/edited)
- PostgreSQL `memories` table: memories with `directory_context` or `tags` matching the file path prefix

### Writes
- PostgreSQL: updates `heat_base` (+boost, capped at 1.0) on matched memories — implements spreading activation (Collins & Loftus 1975) from file path as cue node
- Does NOT write to stdout (PreToolUse exit 0 does not inject context per Claude Code lesson 10)
- **stderr**: diagnostic logs

### Exit-code semantics
- `exit 0` always (non-blocking)
- Source: `phase-3-a3-migration-design.md §3.4`

### Timeout
- Non-blocking design; no explicit timeout

### Paper backing
- Bar (2007) proactive brain
- Collins & Loftus (1975) spreading activation
- Smith & Vela (2001) context reinstatement d=0.28

---

## Hook 8: `pipeline_impact_bump.py` *(UNACCOUNTED-FOR in PHASE_PLAN §4)*

**Source**: `/Users/cdeust/Developments/Cortex/mcp_server/hooks/pipeline_impact_bump.py` (228 LOC)

### Trigger event
`PostToolUse` — fires after `Edit`, `Write`, or `MultiEdit` tool calls.

### Reads
- Tool call result from stdin: edited file path(s)
- AI-automatised-pipeline MCP `detect_changes` tool: resolves which code symbols are impacted by the edit (requires pipeline server to be installed)
- PostgreSQL `memories` table: memories tagged with impacted symbol names

### Writes
- PostgreSQL: targeted `heat_base` bump on memories tagged with impacted symbols (more precise than `preemptive_context`)
- Coexists with `preemptive_context`: they compose — preemptive is path-based (broad); this is graph-based (precise)
- Cooldown mechanism: skips if file was already bumped recently

### Exit-code semantics
- `exit 0` always
- Skips cleanly if pipeline MCP server is not installed

### Timeout
- Non-blocking; no explicit timeout

### Paper backing
- Collins & Loftus (1975) spreading activation
- Smith & Vela (2001) context reinstatement d=0.28

---

## Hook 9: `ingest_codebase_background.py` *(UNACCOUNTED-FOR in PHASE_PLAN §4)*

**Source**: `/Users/cdeust/Developments/Cortex/mcp_server/hooks/ingest_codebase_background.py` (68 LOC)

### Trigger event
Not a direct Claude Code hook. Spawned as a **detached subprocess** by `session_start.py` when the cached codebase graph is stale or missing.

**Invocation**: `python -m mcp_server.hooks.ingest_codebase_background /path/to/project`

### Reads
- `project_root` from command-line argument (argv[1])
- Project codebase files (via `ingest_codebase` handler)

### Writes
- Cortex `ingest_codebase` MCP tool: full codebase graph rebuild
- Stdout redirected to a log file by the spawning `session_start.py`

### Exit-code semantics
- `exit 0` → success
- `exit 1` → recoverable error (logged, does not crash the session)
- `exit 2` → fatal error (no `project_root` argument provided)

### Timeout
- No timeout; runs to completion in background, detached from parent

---

## Summary Table

| Hook | Trigger | Reads | Writes | Exit codes | Timeout |
|---|---|---|---|---|---|
| `session_start.py` | `SessionStart` | PG memories + checkpoints | stdout: context block | 0 (always) | subprocess 15s |
| `auto_recall.py` | `UserPromptSubmit` | PG memories via recall | stdout: memories snippet | 0/1 | 3s |
| `post_tool_capture.py` | `PostToolUse` | stdin: tool result | PG: remember call | 0 (always) | hook budget ~5s |
| `agent_briefing.py` | `SubagentStart` | PG memories via recall | stdout: briefing | 0 (always) | ~3s |
| `compaction_checkpoint.py` | `Notification(compacted)` | stdin: event JSON | PG: checkpoint save | 0 (always) | 5s |
| `session_lifecycle.py` | `SessionEnd` | stdin: session event | Profile JSON files | 0 / 1 | none (sync) |
| `preemptive_context.py` | `PostToolUse` | PG memories (path match) | PG: heat bump | 0 (always) | none (non-blocking) |
| `pipeline_impact_bump.py` | `PostToolUse` | AP pipeline + PG memories | PG: heat bump | 0 (always) | none (non-blocking) |
| `ingest_codebase_background.py` | Subprocess (from session_start) | Codebase files | PG: graph ingest | 0 / 1 / 2 | none (background) |
