# Worktree Mission — `port/plugin-manifest-design`

> This mission defines the unified `.claude-plugin/` manifest design for the agentic-ai
> monorepo. It consolidates four independently-published plugins into one marketplace
> entry with four independently-versioned sub-plugins.

---

## 1. Source

Four source repositories, each with an independent `.claude-plugin/` directory:

| Repo | Plugin name | Version (at migration) | `.claude-plugin/` files |
|---|---|---|---|
| `cdeust/Cortex` | `cortex` | `3.14.8` | `plugin.json`, `marketplace.json` |
| `cdeust/automatised-pipeline` | `automatised-pipeline` | `0.0.4` | `plugin.json`, `marketplace.json` |
| `cdeust/zetetic-team-subagents` | `zetetic-team-subagents` | `2.13.1` | `plugin.json`, `marketplace.json` |
| `cdeust/prd-spec-generator` | `prd-spec-generator` | `0.3.0` | `plugin.json`, `marketplace.json` |

**MCP server registrations (root `.mcp.json` in each repo):**

| Repo | Server key | Command | Notes |
|---|---|---|---|
| Cortex | `cortex` | `bash -c '...'` (Python launcher) | PostgreSQL/SQLite, bash-wrapper |
| automatised-pipeline | `ai-architect` | `bash -c '...'` (Rust binary) | bash-wrapper, cf85cfc fix |
| zetetic-team-subagents | `memory` | `python3 tools/memory-mcp-server.py` | Uses `${MEMORY_AGENT_ID:-unknown}` — BROKEN syntax |
| prd-spec-generator | `prd-gen` | `node ${CLAUDE_PLUGIN_ROOT}/mcp-server/index.js` | Node.js |

**Skills inventory:**
- Cortex: 15 skills under `skills/cortex-*/SKILL.md`; 1 command (`commands/methodology.md`)
- automatised-pipeline: 0 skills, 0 commands
- zetetic-team-subagents: 61 skills across 7 categories; 25 commands across 9 categories
- prd-spec-generator: 0 skills; 1 command (`commands/generate-prd.md`)

**Source languages:** Python (Cortex), Rust (automatised-pipeline), Bash+Python (zetetic), Node.js/TypeScript (prd-spec-generator)

---

## 2. Target

The unified `.claude-plugin/` layout in `cdeust/agentic-ai`:

```
.claude-plugin/
├── marketplace.json              # ONE marketplace, 4 plugin entries
├── memory/
│   ├── plugin.json               # cortex → memory plugin manifest
│   ├── .mcp.json                 # cortex MCP server registration
│   └── README.md
├── codebase/
│   ├── plugin.json               # automatised-pipeline → codebase plugin
│   ├── .mcp.json
│   └── README.md
├── reasoning/
│   ├── plugin.json               # zetetic-team-subagents → reasoning plugin
│   └── README.md
└── prd/
    ├── plugin.json               # prd-spec-generator → prd plugin
    ├── .mcp.json
    └── README.md
```

**Install model:** Individual installs per plugin via a shared marketplace:
```
/plugin marketplace add cdeust/agentic-ai
/plugin install memory@agentic-ai
/plugin install codebase@agentic-ai
/plugin install reasoning@agentic-ai
/plugin install prd@agentic-ai
```

**Rationale for individual over bundle:** see `plugins/UNIFIED_LAYOUT.md §Install Model`.

---

## 3. Acceptance Contract

This design worktree is **complete** when:

- [ ] All JSON files parse without error (`jq . <file>`)
- [ ] Every `.mcp.json` uses only plain `${CLAUDE_PLUGIN_ROOT}` (no `${VAR:-fallback}` syntax)
- [ ] `SURVEY.md` lists every source file accurately
- [ ] `UNIFIED_LAYOUT.md` justifies every structural decision
- [ ] `marketplace.json` has 4 plugin entries with independent versions
- [ ] `INSTALL_FLOW.md` covers all 5 steps and identifies open diagnostic gaps
- [ ] `MIGRATION_FROM_OLD_PLUGINS.md` provides complete uninstall + reinstall instructions

---

## 4. Known Risks / Open Questions

- The zetetic `.mcp.json` uses `${MEMORY_AGENT_ID:-unknown}` which is the broken fallback syntax. This must be rewritten in the target `.mcp.json`.
- The zetetic plugin's `plugin.json` does NOT declare `"mcpServers": "./.mcp.json"` — it only has a root-level `.mcp.json`. The unified manifest must add this reference.
- The `reasoning` plugin has no MCP server: the zetetic `memory` MCP server (`tools/memory-mcp-server.py`) is a lightweight in-memory tool, not a full MCP server on par with Cortex/codebase/prd. Decision: include as optional `.mcp.json` but mark as optional in `UNIFIED_LAYOUT.md`.
- Independent versioning across 4 plugins in one monorepo requires a clear release process (not designed here — deferred to implementation).

---

## 5. Daily Log

- **2026-04-26**: Initial design produced by `port/plugin-manifest-design` worktree. Survey of all 4 source repos. Unified layout, marketplace.json, per-plugin manifests, MCP configs, install flow, and migration guide written.
