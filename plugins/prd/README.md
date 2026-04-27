# prd plugin

**Source:** `cdeust/prd-spec-generator` v0.3.0

Stateless reducer that turns a feature description into a 9-file PRD in one command.

## What you get

- 17 MCP tools: `start_pipeline`, `generate_prd`, `verify_prd`, `validate_hard_rules`,
  `select_strategy`, `multi_judge_review`, `bayesian_consensus`, and more
- 1 command: `/generate-prd <feature description>`
- No hooks

## Dependencies

- Node.js 18+
- SQLite (embedded — the EvidenceRepository is stored locally)

## First-run

On first run, `prd-gen` creates the EvidenceRepository at
`${CLAUDE_PLUGIN_ROOT}/.prd-gen/evidence.db`. This is a persistent SQLite database that
accumulates evidence scores across PRD generation runs, feeding the research-evidence-backed
strategy selector.

If `node` is not found, the MCP server fails to start. Claude Code will show:
`MCP server 'prd-gen' failed to start`.
Diagnosis: install Node.js 18+ via `nvm install 18` or `brew install node`.

## Usage

```
/generate-prd "Add OAuth2 social login with Google and GitHub providers"
```

Produces 9 files: requirements.md, architecture.md, api-spec.md, data-model.md,
test-plan.md, security.md, performance.md, migration.md, rollout.md.

## MCP tool prefix

After installation: `mcp__plugin_prd_prd-gen__<tool_name>`

Example: `mcp__plugin_prd_prd-gen__start_pipeline`
