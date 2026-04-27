# Plugin Survey — Four Source Repositories

Survey date: 2026-04-26. All data lifted verbatim from source repos (read-only).

---

## 1. Cortex (memory plugin)

**Repo:** `cdeust/Cortex` at `/Users/cdeust/Developments/Cortex/`

### `.claude-plugin/plugin.json`
| Field | Value |
|---|---|
| name | `cortex` |
| version | `3.14.8` |
| description | Persistent memory for Claude Code — remembers across sessions automatically. Scientific retrieval backed by 41 published papers. |
| keywords | memory, persistent, mcp, claude-code, neuroscience, agents |
| mcpServers | `./.mcp.json` |

### `.claude-plugin/marketplace.json`
| Field | Value |
|---|---|
| name | `cortex-plugins` |
| metadata.version | `3.14.5` (note: behind plugin.json 3.14.8 — version drift) |
| plugins[0].name | `cortex` |
| plugins[0].category | `productivity` |
| plugins[0].runtime | `["cli", "cowork"]` |
| plugins[0].runtime_notes | CLI requires PostgreSQL 15+ with pgvector; Cowork falls back to SQLite automatically |

### `.mcp.json`
- **Server key:** `cortex`
- **Command:** `bash`
- **Args:** `["-c", "PY=$(command -v python3 || command -v python) && ROOT=\"${CLAUDE_PLUGIN_ROOT:-$PWD}\" && \"$PY\" \"$ROOT/scripts/launcher.py\" mcp_server"]`
- **Env:**
  - `DATABASE_URL`: `postgresql://localhost:5432/cortex`
  - `CORTEX_RUNTIME`: `""`
  - `CORTEX_MEMORY_AP_ENABLED`: `"1"`
- **Bug note:** Uses `${CLAUDE_PLUGIN_ROOT:-$PWD}` — this is the known broken syntax (cf85cfc). Claude Code substitutes only plain `${CLAUDE_PLUGIN_ROOT}`; the `:-$PWD` fallback is passed literally to bash. **Must be fixed in unified target.**

### Hooks declared
| Event | Count | Description |
|---|---|---|
| `SessionStart` | 1 | `launcher.py mcp_server.hooks.session_start` — loads cognitive profile |
| `UserPromptSubmit` | 1 | `launcher.py mcp_server.hooks.auto_recall` — auto-injects memory context |
| `PostToolUse` | 3 | post_tool_capture + preemptive_context + pipeline_impact_bump |
| `SessionEnd` | 1 | `launcher.py mcp_server.hooks.session_lifecycle` — EMA update |
| `Notification` | 1 | matcher: `compacted` — compaction_checkpoint |
| `SubagentStart` | 1 | agent_briefing |

All hooks use the bash-wrapper pattern:
```bash
bash -c 'PY=$(command -v python3 || command -v python) && ROOT="${CLAUDE_PLUGIN_ROOT:-$PWD}" && "$PY" "$ROOT/scripts/launcher.py" <target>'
```
Note: `ROOT` in hooks also uses the broken `:-$PWD` fallback. All hooks must be rewritten in target.

### Skills shipped
| Path | Count |
|---|---|
| `skills/cortex-automate/SKILL.md` | 1 |
| `skills/cortex-consolidate/SKILL.md` | 1 |
| `skills/cortex-debug-memory/SKILL.md` | 1 |
| `skills/cortex-explore-memory/SKILL.md` | 1 |
| `skills/cortex-import/SKILL.md` | 1 |
| `skills/cortex-navigate-knowledge/SKILL.md` | 1 |
| `skills/cortex-profile/SKILL.md` | 1 |
| `skills/cortex-recall-global/SKILL.md` | 1 |
| `skills/cortex-recall/SKILL.md` | 1 |
| `skills/cortex-remember-global/SKILL.md` | 1 |
| `skills/cortex-remember/SKILL.md` | 1 |
| `skills/cortex-setup-project/SKILL.md` | 1 |
| `skills/cortex-visualize/SKILL.md` | 1 |
| `skills/cortex-wiki-author/SKILL.md` | 1 |
| **Total** | **14 skills** |

### Commands shipped
- `commands/methodology.md` (1 command)

### Current install command
```
/plugin marketplace add cdeust/Cortex
/plugin install cortex
```

---

## 2. automatised-pipeline (codebase plugin)

**Repo:** `cdeust/automatised-pipeline` at `/Users/cdeust/Developments/anthropic/ai-automatised-pipeline/`

### `.claude-plugin/plugin.json`
| Field | Value |
|---|---|
| name | `automatised-pipeline` |
| version | `0.0.4` |
| description | Rust MCP server that indexes Rust/Python/TypeScript codebases into a LadybugDB property graph. 23 MCP tools. |
| keywords | mcp, claude-code, rust, codebase-intelligence, property-graph, call-graph, community-detection, leiden, ladybugdb, ai-architect |
| mcpServers | `./.mcp.json` |

### `.claude-plugin/marketplace.json`
| Field | Value |
|---|---|
| name | `automatised-pipeline-marketplace` |
| metadata.version | `0.0.4` |
| plugins[0].name | `automatised-pipeline` |
| plugins[0].category | `development` |
| plugins[0].description | 23 MCP tools · LadybugDB property graph · Leiden communities · BM25+TF-IDF+RRF search · 220 tests |

### `.mcp.json`
- **Server key:** `ai-architect`
- **Command:** `bash`
- **Args:** `["-c", "BIN=\"${CLAUDE_PLUGIN_ROOT}/target/release/ai-architect-mcp\" && if [ -x \"$BIN\" ]; then exec \"$BIN\"; else exec cargo run --quiet --release --manifest-path \"${CLAUDE_PLUGIN_ROOT}/Cargo.toml\"; fi"]`
- **Env:** none declared
- **Status:** CORRECT — uses plain `${CLAUDE_PLUGIN_ROOT}` throughout. This is the cf85cfc canonical fix. No env-var fallback syntax.

### Hooks declared
None declared in `plugin.json`.

### Skills shipped
None (`skills/` directory does not exist).

### Commands shipped
None (`commands/` directory does not exist).

### Current install command
```
/plugin marketplace add cdeust/automatised-pipeline
/plugin install automatised-pipeline
```

---

## 3. zetetic-team-subagents (reasoning plugin)

**Repo:** `cdeust/zetetic-team-subagents` at `/Users/cdeust/Developments/zetetic-team-subagents/`

### `.claude-plugin/plugin.json`
| Field | Value |
|---|---|
| name | `zetetic-team-subagents` |
| version | `2.13.1` |
| description | 97 genius reasoning patterns from history's greatest minds. One epistemic standard none of them can bypass. |
| keywords | research, reasoning, epistemology, zetetic, genius-agents, scientific-method, claude-code |
| mcpServers | NOT declared — only root `.mcp.json` exists; `plugin.json` has no `mcpServers` field |
| postInstall.command | `bash ${CLAUDE_PLUGIN_ROOT}/scripts/setup.sh install` |
| postInstall.message | Installing zetetic agents, skills, commands, and hooks to ~/.claude/ ... |

### `.claude-plugin/marketplace.json`
| Field | Value |
|---|---|
| name | `zetetic-marketplace` |
| metadata.version | `2.13.1` |
| plugins[0].name | `zetetic-team-subagents` |
| plugins[0].category | `research` |
| plugins[0].description | Complete system: 97 genius agents, 19 team agents (incl. refactorer), 63 skills, 24 commands, 18 tools, 16 hooks, authoritative coding-standards rules |

### `.mcp.json` (root-level, not referenced by plugin.json)
- **Server key:** `memory`
- **Command:** `python3`
- **Args:** `["tools/memory-mcp-server.py"]` — **BROKEN: no path anchoring, relies on cwd**
- **Env:**
  - `MEMORY_AGENT_ID`: `"${MEMORY_AGENT_ID:-unknown}"` — **BROKEN: uses fallback syntax**
- **Two bugs:**
  1. `args` are relative paths with no `${CLAUDE_PLUGIN_ROOT}` anchor. Will break unless cwd happens to be the plugin root.
  2. `env` value uses `${MEMORY_AGENT_ID:-unknown}` — Claude Code only substitutes `${CLAUDE_PLUGIN_ROOT}`, not arbitrary env vars with fallback syntax. The literal string `${MEMORY_AGENT_ID:-unknown}` will be passed to the process as-is.

### Hooks declared (in plugin.json)
| Event | Matcher | Hook script |
|---|---|---|
| `PreToolUse` | `Bash` / `git commit` | `hooks/pre-commit-zetetic.sh` |
| `PreToolUse` | `Bash` / `git push` | `hooks/pre-push-review.sh` |
| `PreToolUse` | `Bash` / `git push` | `hooks/pre-push-provenance.sh` |
| `PreToolUse` | `Edit\|Write` | `hooks/pre-edit-layer-check.sh` |
| `PreToolUse` | `Edit\|Write` | `hooks/pre-tool-claim-gate.sh` |
| `PostToolUse` | `Bash` / `git commit` | `hooks/post-commit-difficulty.sh` |
| `PostToolUse` | `Bash` / `git commit` | `hooks/post-commit-lab-notebook.sh` |
| `PostToolUse` | `Edit\|Write` | `hooks/post-edit-balance.sh` |
| `PostToolUse` | `WebFetch\|WebSearch` | `hooks/post-research-provenance.sh` |
| `PostToolUseFailure` | (all) | `hooks/post-tool-error-routing.sh` |
| `SessionStart` | (all) | `hooks/session-start.sh` + `hooks/session-start-research.sh` |
| `Stop` | (all) | `hooks/session-end.sh` |
| `Notification` | (all) | `hooks/notification-handler.sh` |

All hooks use `${CLAUDE_PLUGIN_ROOT}/hooks/<name>.sh` — correct plain substitution (no fallback). **These are safe.**

### Skills shipped
61 skill files across 7 categories:
- `analysis/` (6): audit-integrity, balance, benchmark, estimate, experiment, investigate
- `architecture/` (8): adr, api-design-review, architecture-review, contract, database-design-review, decompose, evaluate-tool, spec, system-design-document
- `compose/` (9): anomaly-to-explanation, argument-construction, conjecture-to-code, failure-resilient-design, migrate-system, new-tool-design, onboarding-curriculum, performance-investigation, product-quality-audit, statistical-intervention, sunset-decision, translation-across-systems
- `engineering/` (includes debug, refactor, test, etc.)
- `genius/` (invocation patterns)
- `research/` (research skills)
- `zetetic/` (epistemic verification skills)

### Commands shipped
25 commands across 9 categories:
- `agent/`: list, spawn, status
- `genius/`: compose, index, invoke, route
- `git/`: clean, commit, pr
- `quality/`: pre-commit, pre-push
- `research/`: notebook, session
- `session/`: memory-audit, memory-sync, recall, save
- `skill/`: run
- `zetetic/`: difficulty, estimate, integrity, provenance, review, verify

### Current install command
```
/plugin marketplace add cdeust/zetetic-team-subagents
/plugin install zetetic-team-subagents
```

---

## 4. prd-spec-generator (prd plugin)

**Repo:** `cdeust/prd-spec-generator` at `/Users/cdeust/Developments/prd-spec-generator/`

### `.claude-plugin/plugin.json`
| Field | Value |
|---|---|
| name | `prd-spec-generator` |
| version | `0.3.0` |
| description | Stateless reducer that turns a feature description into a 9-file PRD. Multi-judge verification with weighted-average + Bayesian consensus. |
| keywords | prd, product-requirements, mcp, claude-code, verification, validation, consensus, multi-judge, stateless-reducer, ai-architect |
| mcpServers | `./.mcp.json` |

### `.claude-plugin/marketplace.json`
| Field | Value |
|---|---|
| name | `prd-spec-generator-marketplace` |
| metadata.version | `0.3.0` |
| plugins[0].name | `prd-spec-generator` |
| plugins[0].category | `documentation` |
| plugins[0].description | 10 packages · 17 MCP tools · 9 pipeline steps · multi-judge verification · 248 tests · every constant sourced |

### `.mcp.json`
- **Server key:** `prd-gen`
- **Command:** `node`
- **Args:** `["${CLAUDE_PLUGIN_ROOT}/mcp-server/index.js"]`
- **Env:**
  - `PRD_GEN_SKILL_CONFIG`: `"${CLAUDE_PLUGIN_ROOT}/packages/skill/skill-config.json"`
  - `PRD_GEN_EVIDENCE_DB`: `"${CLAUDE_PLUGIN_ROOT}/.prd-gen/evidence.db"`
- **Bug note:** The `args` entry `"${CLAUDE_PLUGIN_ROOT}/mcp-server/index.js"` uses `${CLAUDE_PLUGIN_ROOT}` in an args string (not a bash `-c` arg). Whether Claude Code expands this in `args[]` needs verification — if not, this breaks. The safe fix is to wrap in `bash -c` like the cortex/codebase plugins do.

### Hooks declared
None.

### Skills shipped
None.

### Commands shipped
- `commands/generate-prd.md` (1 command)

### Current install command
```
/plugin marketplace add cdeust/prd-spec-generator
/plugin install prd-spec-generator
```

---

## Cross-cutting observations

1. **Version drift**: Cortex `plugin.json` is at `3.14.8` but its own `marketplace.json` says `3.14.5`. The unified marketplace starts fresh from `plugin.json` versions as the authoritative source.

2. **`${CLAUDE_PLUGIN_ROOT}` bug surface**: Three of four repos have some form of the bug:
   - Cortex `.mcp.json` hooks: `${CLAUDE_PLUGIN_ROOT:-$PWD}` — broken
   - Zetetic `.mcp.json` args: relative path with no anchor — broken
   - Zetetic `.mcp.json` env: `${MEMORY_AGENT_ID:-unknown}` — broken (though different var)
   - prd-spec-generator `.mcp.json` args: `${CLAUDE_PLUGIN_ROOT}` in plain args (not bash -c) — risk

3. **`mcpServers` field missing from zetetic `plugin.json`**: Must be added in unified target.

4. **Marketplace name inconsistency**: Each repo uses a different top-level `name` for its marketplace.json (`cortex-plugins`, `automatised-pipeline-marketplace`, `zetetic-marketplace`, `prd-spec-generator-marketplace`). The unified marketplace has one canonical name: `agentic-ai-marketplace`.

5. **Category vocabulary**: `productivity`, `development`, `research`, `documentation` — four different categories for four plugins. These are preserved as-is in the unified manifest.
