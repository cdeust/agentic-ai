# ADR-0010 — `${CLAUDE_PLUGIN_ROOT}` expansion semantics in `.mcp.json` and `plugin.json`

**Status:** Accepted (verified empirically)
**Date:** 2026-04-26
**Originated:** `port/plugin-manifest-design` (OQ-4 CRIT) and observed bug in
`cdeust/automatised-pipeline` commit `cf85cfc`
**Affects:** All four plugin manifests; Phase 5 unified install

## Context

Claude Code expands `${CLAUDE_PLUGIN_ROOT}` differently in different
manifest fields. The `port/plugin-manifest-design` worktree flagged
OQ-4 CRIT: if `${CLAUDE_PLUGIN_ROOT}` is NOT exported during postInstall
execution, the `reasoning` plugin's 13 hooks silently fail to install.
Resolving this is a precondition for the unified install flow.

The behaviour was discovered the hard way during the 2026-04-25
wiki-grooming PRD run when `automatised-pipeline`'s `.mcp.json` used
the bash parameter-expansion pattern `${CLAUDE_PLUGIN_ROOT:-$PWD}`.
Claude Code substitutes `${CLAUDE_PLUGIN_ROOT}` literally as a regex
match — it does NOT support compound parameter-expansion forms like
`${VAR:-default}`. The literal pattern was passed unsubstituted to the
spawned binary, which then resolved via `$PWD` (the user's project
directory, not the plugin install path).

## Empirical verification

### `.mcp.json` `args[]` array elements

Claude Code DOES substitute the EXACT pattern `${CLAUDE_PLUGIN_ROOT}` in
arg array elements. Observed: `prd-spec-generator/.mcp.json` ships with
`"args": ["${CLAUDE_PLUGIN_ROOT}/mcp-server/index.js"]` and works.
Claude Code does NOT support `${VAR:-fallback}` syntax — the broader
parameter-expansion grammar is not implemented. Fix from
`cdeust/automatised-pipeline` commit `cf85cfc`: wrap in `bash -c "..."`
so the shell — not Claude Code's template engine — does the expansion.

### `plugin.json` `postInstall.command` string

Claude Code DOES substitute `${CLAUDE_PLUGIN_ROOT}` in the `postInstall.command`
field. Verified empirically: `zetetic-team-subagents/.claude-plugin/plugin.json`
ships with:
```json
"postInstall": {
  "command": "bash ${CLAUDE_PLUGIN_ROOT}/scripts/setup.sh install"
}
```
This pattern is in active use for the zetetic plugin and the setup script
runs successfully on every install (the 13 hooks are correctly written
to `~/.claude/`). Source path:
`/Users/cdeust/Developments/zetetic-team-subagents/.claude-plugin/plugin.json`
line 21–24.

### `plugin.json` `hooks[].hooks[].command` string

Same behaviour. Zetetic's `pre-commit-zetetic.sh` hook uses
`${CLAUDE_PLUGIN_ROOT}/hooks/pre-commit-zetetic.sh` and works.

## Decision

Three manifest-level rules, applied to every `plugin.json` and `.mcp.json`
in the agentic-ai monorepo:

1. **Use the bare form `${CLAUDE_PLUGIN_ROOT}/path/to/file`** — never
   `${CLAUDE_PLUGIN_ROOT:-$PWD}` or any other parameter-expansion variant.
2. **For commands that need shell semantics (loops, env-var conditionals,
   PIPESTATUS, etc.)**, wrap the entire command in `bash -c "..."`. The
   `${CLAUDE_PLUGIN_ROOT}` substitution still happens (Claude Code rewrites
   the args before the binary spawn) and bash inside the wrapper handles
   the rest.
3. **The `postInstall.command` field is a SINGLE STRING** (not an args
   array). Claude Code expands `${CLAUDE_PLUGIN_ROOT}` in the string and
   passes the result to a shell. This means:
   - `"command": "bash ${CLAUDE_PLUGIN_ROOT}/scripts/setup.sh install"` works.
   - `"command": "${CLAUDE_PLUGIN_ROOT}/scripts/setup.sh install"` works
     IFF `setup.sh` is executable and a shebang resolves it.
   - Both patterns are supported; prefer the explicit `bash` form for
     clarity and platform compatibility.

## Consequences for the unified install (Phase 5)

- The four unified manifests (`memory`, `codebase`, `reasoning`, `prd`)
  must all use the bare form. The `port/plugin-manifest-design` worktree
  has already drafted them this way; Phase 5 implementation copies the
  drafts verbatim.
- OQ-4 is RESOLVED: `CLAUDE_PLUGIN_ROOT` IS exported (or substituted)
  during postInstall. The reasoning plugin's setup script will run
  successfully on first install.
- Document this rule in `CONTRIBUTING.md` so future contributors don't
  re-introduce the `${VAR:-fallback}` bug.

## Verification

- Manifest-level lint: a CI step in `.github/workflows/ci.yml` greps every
  `plugin.json` and `.mcp.json` under `plugins/` for `\$\{[A-Z_]+:-` (the
  parameter-expansion fallback pattern) and fails the build if any matches are
  found. The rule is named `no-shell-fallback-in-claude-plugin-template`.
  - Path note (2026-04-27): the lint scans `plugins/`, not a top-level
    `.claude-plugin/`. An earlier version of this section pointed at the
    wrong directory which made the gate vacuously pass on every run. Source:
    docs/audits/FINAL_CROSS_AUDIT.md §F-HIGH-001 (Borges, 2026-04-27).
- Install smoke-test: a Phase-5 deliverable script that performs a fresh
  install of the unified plugin against a clean Claude Code session and
  asserts the `reasoning` setup script's side-effects (hooks present in
  `~/.claude/agents/`, etc.).
