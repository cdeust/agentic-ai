# Strict Counts — zetetic-team-subagents

Source: `/Users/cdeust/Developments/zetetic-team-subagents`
Counted: 2026-04-26
Method: `find`, `wc -l`, `ls` on source repo (read-only)

These counts are the CI gate for Phase 6 cutover. Under-counting = silent loss.

---

## Primary Counts

| Category | Count | Source Path | Counting Method |
|---|---|---|---|
| Genius patterns | **97** | `agents/genius/*.md` (excl. `INDEX.md`) | `ls agents/genius/*.md \| grep -v INDEX.md \| wc -l` |
| Team agents | **19** | `agents/*.md` (top-level only) | `ls agents/*.md \| wc -l` |
| Hook scripts | **16** | `hooks/*.sh` + `hooks/*.py` | `ls hooks/*.sh hooks/*.py \| wc -l` |
| Rule files | **1** | `rules/*.md` | `ls rules/ \| wc -l` |
| Tool scripts (.sh) | **18** | `tools/*.sh` | `ls tools/*.sh \| wc -l` |
| Tool scripts (.py) | **1** | `tools/memory-mcp-server.py` | `ls tools/*.py \| wc -l` |
| Tool scripts (total) | **19** | `tools/` (excl. `tests/`) | `ls tools/*.sh tools/*.py \| wc -l` |
| Slash commands | **25** | `commands/**/*.md` (excl. `_index.md`) | `find commands -name "*.md" -not -name "_index.md" \| wc -l` |
| Skills | **61** | `skills/**/*.md` (excl. `_index.md`, `_template.md`) | `find skills -name "*.md" -not -name "_index.md" -not -name "_template.md" \| wc -l` |
| Scripts (scripts/) | **10** | `scripts/*.sh` | `ls scripts/ \| wc -l` |
| **Total .md files** | **234** | entire repo (excl. `.git/`) | `find . -name "*.md" -not -path "*/.git/*" \| wc -l` |
| **Total .sh files** | **45** | entire repo (excl. `.git/`) | `find . -name "*.sh" -not -path "*/.git/*" \| wc -l` |

---

## Detailed Breakdown

### Genius Agents (97)

Files in `agents/genius/`:
- 97 agent `.md` files (one per historical pattern)
- 1 navigation index `INDEX.md` (excluded from count — not an agent; 1066 lines)
- `.DS_Store` (macOS artifact — excluded)

### Team Agents (19)

Files in `agents/` (top-level):
architect, code-reviewer, data-scientist, dba, devops-engineer, engineer, experiment-runner, frontend-engineer, latex-engineer, mlops, orchestrator, paper-writer, professor, refactorer, research-scientist, reviewer-academic, security-auditor, test-engineer, ux-designer

Marketplace metadata (`marketplace.json`) states "19 team agents (incl. refactorer)" — confirmed.

### Hooks (16)

| File | Language |
|---|---|
| `notification-handler.sh` | Bash |
| `post-commit-difficulty.sh` | Bash |
| `post-commit-lab-notebook.sh` | Bash |
| `post-edit-balance.sh` | Bash |
| `post-research-provenance.sh` | Bash |
| `post-tool-error-routing.sh` | Bash |
| `pre-commit-zetetic.sh` | Bash |
| `pre-edit-layer-check.sh` | Bash |
| `pre-push-provenance.sh` | Bash |
| `pre-push-review.sh` | Bash |
| `pre-tool-claim-gate.sh` | Bash |
| `session-end-memory-drain.sh` | Bash |
| `session-end.sh` | Bash |
| `session-start-research.sh` | Bash |
| `session-start.sh` | Bash |
| `pre-tool-secret-shield.py` | Python 3 |

### Tool Scripts (19)

18 Bash `.sh` files + 1 Python `.py` file:

| File | Language | Lines |
|---|---|---|
| `agent-catalog.sh` | Bash | 70 |
| `agent-definition-auditor.sh` | Bash | 170 |
| `balance-auditor.sh` | Bash | 37 |
| `difficulty-book-manager.sh` | Bash | 86 |
| `docker-runner.sh` | Bash | 188 |
| `genius-invoker.sh` | Bash | 154 |
| `hook-runner.sh` | Bash | 23 |
| `lab-notebook-manager.sh` | Bash | 98 |
| `live-preview.sh` | Bash | 281 |
| `memory-tool.sh` | Bash | 1284 |
| `mlx-compute.sh` | Bash | 271 |
| `profile-runner.sh` | Bash | 35 |
| `provenance-manager.sh` | Bash | 105 |
| `research-session-manager.sh` | Bash | 209 |
| `session-store.sh` | Bash | 41 |
| `shape-router.sh` | Bash | 49 |
| `skill-runner.sh` | Bash | 50 |
| `worktree-manager.sh` | Bash | 55 |
| `zetetic-checker.sh` | Bash | 248 |
| `memory-mcp-server.py` | Python 3 | 441 |

Note: `tools/tests/` is a subdirectory (test scripts) — not counted in the 19 tool scripts. It is counted in `scripts/` totals.

### Slash Commands (25)

Organized in subdirectories under `commands/`:

| Dir | Commands | Count |
|---|---|---|
| `commands/agent/` | `list.md`, `spawn.md`, `status.md` | 3 |
| `commands/genius/` | `compose.md`, `index.md`, `invoke.md`, `route.md` | 4 |
| `commands/git/` | `clean.md`, `commit.md`, `pr.md` | 3 |
| `commands/quality/` | `pre-commit.md`, `pre-push.md` | 2 |
| `commands/research/` | `notebook.md`, `session.md` | 2 |
| `commands/session/` | `memory-audit.md`, `memory-sync.md`, `recall.md`, `save.md` | 4 |
| `commands/skill/` | `run.md` | 1 |
| `commands/zetetic/` | `difficulty.md`, `estimate.md`, `integrity.md`, `provenance.md`, `review.md`, `verify.md` | 6 |
| **Total** | | **25** |

### Skills (61)

Organized in subdirectories under `skills/`:

| Dir | Count |
|---|---|
| `skills/analysis/` | varies |
| `skills/architecture/` | varies |
| `skills/compose/` | varies |
| `skills/engineering/` | varies |
| `skills/genius/` | varies |
| `skills/research/` | varies |
| `skills/zetetic/` | varies |

Total verified by: `find skills -name "*.md" -not -name "_index.md" -not -name "_template.md" | wc -l` = **61**

### Scripts/ (10)

Files in `scripts/`:
`setup.sh`, `spawn-agent.sh`, `test-agent-id-propagation.sh`, `test-memory-concurrency.sh`, `test-memory-e2e.sh`, `test-memory-mcp.sh`, `test-memory-pii-expanded.sh`, `test-memory-pii.sh`, `test-memory-stale-lock.sh`, `test-spawn-agent.sh`

These are primarily setup and test scripts for the plugin installer and memory MCP server — not hooks or tools.

---

## Source-Tree Irregularities

| ID | Severity | Description | Impact on Port |
|---|---|---|---|
| IRR-001 | MEDIUM | `hooks/session-end-memory-drain.sh` appears in `hooks/hooks.json` (Stop event, secondary) but is **absent** from `.claude-plugin/plugin.json`. It will not be installed by the plugin installer. | Port must decide whether to include this hook in `plugin.json` or treat it as optional. Count it in the 16 hook total regardless. |
| IRR-002 | MEDIUM | `hooks/pre-tool-secret-shield.py` appears in `hooks/hooks.json` (PreToolUse: `Read\|Bash\|Grep\|Edit\|Write\|NotebookEdit`) but is **absent** from `.claude-plugin/plugin.json`. It provides blocking secret protection but is invisible to the standard installer. | Port must either add it to `plugin.json` (recommended — it is a security hook) or document the omission. |
| IRR-003 | LOW | `agents/genius/INDEX.md` sits in the genius agent directory but is a navigation index (1066 lines), not an agent. Its frontmatter does not have `name:` / `shapes:` fields. | Exclude from the 97 genius agent count. Register it separately as a navigation artifact. |
| IRR-004 | LOW | `tools/memory-mcp-server.py` is a Python file in the `tools/` directory. All other tools are Bash. This is an MCP server implementation that runs as a separate process — not a CLI tool. | Port separately from tool scripts; it has a different lifecycle (long-running server vs one-shot script). |
| IRR-005 | LOW | `tools/tests/` subdirectory exists under `tools/` — it contains test scripts for the memory MCP server. These are not tool scripts. The marketplace metadata says "18 tools" but there are 19 files if `memory-mcp-server.py` is included. | Count: 18 Bash tool scripts + 1 Python MCP server = 19 total tool-area files. |
| IRR-006 | INFO | The `commands/_index.md` and `skills/_index.md` and `skills/_template.md` are scaffolding files, not commands or skills. They are excluded from the 25 command / 61 skill counts. | No impact — counts are correct as stated. |

---

## Plugin Discovery Summary

Claude Code discovers this plugin via `.claude-plugin/plugin.json`. Key fields:
- `postInstall.command`: `bash ${CLAUDE_PLUGIN_ROOT}/scripts/setup.sh install` — copies agents, skills, commands, hooks to `~/.claude/`
- Hook registration: 15 hooks across 6 events (see HOOKS.md — `plugin.json` registers 15; `hooks.json` registers 16)
- Agent discovery: agents are copied to `~/.claude/agents/` by `setup.sh`; Claude Code finds them there at runtime
- Version: 2.13.1
