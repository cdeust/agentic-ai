# Hooks Inventory

Source: `/Users/cdeust/Developments/zetetic-team-subagents/hooks/`
Count: 16 executable hook files (15 Bash `.sh` + 1 Python `.py`)
Excludes: `hooks/README.md` (documentation), `hooks/hooks.json` (config manifest), `hooks/__pycache__/` (compiled Python)

Discovery contracts:
- **`plugin.json`** (`.claude-plugin/plugin.json`): registers 15 hooks across 6 event types
- **`hooks.json`** (`hooks/hooks.json`): alternate registration format; registers all 16 hooks including `session-end-memory-drain.sh` and `pre-tool-secret-shield.py` which are absent from `plugin.json`

Source-tree irregularity: see COUNTS.md for the two hooks present in `hooks.json` but absent from `plugin.json`.

---

| File | Trigger Event | Matcher / Condition | Language | Lines | Reads | Writes | Purpose |
|---|---|---|---|---|---|---|---|
| `session-start.sh` | `SessionStart` | (all sessions) | Bash | 82 | `~/.claude/cortex-context.json`, `tools/session-store.sh`, `tools/agent-catalog.sh` | `~/.claude/session-cache.json`, stdout (context summary) | Loads cognitive context, current session metadata, active agent catalog at session start |
| `session-start-research.sh` | `SessionStart` | (all sessions, secondary) | Bash | 57 | `research/NOTEBOOK.md`, `research/PROVENANCE.md`, `research/SESSIONS/` | stdout (research-session context summary) | Loads research-session–specific context (notebook, provenance file, active sessions) if a research session is active |
| `session-end.sh` | `Stop` | (all sessions) | Bash | 20 | `~/.claude/session-cache.json` | `~/.claude/session-cache.json` (appends session record) | Records session context before exit; updates session cache |
| `session-end-memory-drain.sh` | `Stop` | (all sessions, secondary) | Bash | 33 | `~/.claude/memory-sync-queue.json` | stdout (queue depth warning if >0) | Surfaces pending memory sync queue depth at session end; advisory only |
| `notification-handler.sh` | `Notification` | (all notifications) | Bash | 22 | stdin (JSON notification payload) | stdout (formatted notification summary) | Handles subagent and background task completion notifications |
| `pre-commit-zetetic.sh` | `PreToolUse` | Bash, when `command contains 'git commit'` | Bash | 39 | stdin (JSON tool event), staged diff via `git diff --cached` | stderr (blocking message on violation) | Blocks commit if: invented constants detected, unsourced claims, or TODOs without difficulty-book references; enforces zetetic standard |
| `pre-push-review.sh` | `PreToolUse` | Bash, when `command contains 'git push'` | Bash | 47 | stdin (JSON), `git log`, `git diff` since last push | stderr (warning messages) | Checks for zetetic violations (magic numbers, unsourced algorithms) before push |
| `pre-push-provenance.sh` | `PreToolUse` | Bash, when `command contains 'git push'` | Bash | 75 | stdin (JSON), `research/PROVENANCE.md`, tracked research files | stderr (blocking message or warning) | Verifies provenance sidecars exist for research files before push; configurable: `PROVENANCE_STRICT=block` (default) or `warn` |
| `pre-edit-layer-check.sh` | `PreToolUse` | `Edit\|Write` | Bash | 25 | stdin (JSON with `file_path`), target file path | stderr (advisory warning) | Advisory check: warns if an edit to a `core/` file might add infrastructure imports; does not block |
| `pre-tool-claim-gate.sh` | `PreToolUse` | `Edit\|Write` | Bash | 73 | stdin (JSON), new file content (via stdin or temp file `$2`) | stderr (blocking message on violation) | Catches hardcoded constants, magic numbers, and unsourced algorithms in Write/Edit content before it lands; blocks on violation |
| `pre-tool-secret-shield.py` | `PreToolUse` | `Read\|Bash\|Grep\|Edit\|Write\|NotebookEdit` | Python 3 | 200 | stdin (JSON tool event: `tool_name`, `tool_input`) | stderr (blocking message with reason); exit code 2 to block | Blocks tool calls that would surface credential-bearing files (`.env`, secrets, key files, tokens); zero-friction pass-through for non-secret paths |
| `post-commit-difficulty.sh` | `PostToolUse` | Bash, when `command contains 'git commit'` | Bash | 37 | stdin (JSON), `tasks/difficulty-book.md`, commit message | stdout (advisory prompt) | After commit, checks whether difficulty books need updating based on commit content |
| `post-commit-lab-notebook.sh` | `PostToolUse` | Bash, when `command contains 'git commit'` | Bash | 47 | stdin (JSON), `research/NOTEBOOK.md` | stdout (advisory reminder) | Prompts for lab notebook entry after commit during an active research session |
| `post-edit-balance.sh` | `PostToolUse` | `Edit\|Write` | Bash | 19 | stdin (JSON with `file_path`) | stdout (advisory reminder) | After editing data-pipeline files, reminds about conservation checks (Lavoisier pattern) |
| `post-research-provenance.sh` | `PostToolUse` | `WebFetch\|WebSearch` | Bash | 61 | stdin (JSON with URL/query), `research/PROVENANCE.md` | `research/PROVENANCE.md` (appends entry) | Appends URL or search query to the active provenance file after research tool calls; silent no-op if no active provenance |
| `post-tool-error-routing.sh` | `PostToolUseFailure` | (all failures) | Bash | 66 | stdin (JSON error payload: `tool_name`, `error`, `output`) | stdout (suggested genius agent for diagnosis) | Suggests a diagnostic genius agent based on the type of tool failure; routes errors to appropriate reasoning pattern |

---

## Hook Event Summary

| Event | Hooks | Count |
|---|---|---|
| `SessionStart` | `session-start.sh`, `session-start-research.sh` | 2 |
| `Stop` | `session-end.sh`, `session-end-memory-drain.sh` | 2 |
| `Notification` | `notification-handler.sh` | 1 |
| `PreToolUse` | `pre-commit-zetetic.sh`, `pre-push-review.sh`, `pre-push-provenance.sh`, `pre-edit-layer-check.sh`, `pre-tool-claim-gate.sh`, `pre-tool-secret-shield.py` | 6 |
| `PostToolUse` | `post-commit-difficulty.sh`, `post-commit-lab-notebook.sh`, `post-edit-balance.sh`, `post-research-provenance.sh` | 4 |
| `PostToolUseFailure` | `post-tool-error-routing.sh` | 1 |
| **Total** | | **16** |

## Blocking vs Advisory

| Category | Files |
|---|---|
| **Blocking** (exit non-zero, stops tool call) | `pre-commit-zetetic.sh`, `pre-push-provenance.sh` (in strict mode), `pre-tool-claim-gate.sh`, `pre-tool-secret-shield.py` |
| **Advisory** (warn only, exit 0) | `pre-push-review.sh`, `pre-edit-layer-check.sh`, `post-commit-difficulty.sh`, `post-commit-lab-notebook.sh`, `post-edit-balance.sh`, `post-research-provenance.sh`, `post-tool-error-routing.sh`, `session-start.sh`, `session-start-research.sh`, `session-end.sh`, `session-end-memory-drain.sh`, `notification-handler.sh` |
