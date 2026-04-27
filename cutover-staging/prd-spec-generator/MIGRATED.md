> **NOTICE: prd-spec-generator has moved to [agentic-ai](https://github.com/cdeust/agentic-ai).**
> The unified install is `@agentic/mcp-server-prd`. This repository will be
> archived on **2026-05-31** and is read-only after that date.

---

# prd-spec-generator has moved to agentic-ai

**Your question is: "I have a working prd-spec-generator install. What do I do now?"**

---

## What you should do

### Marketplace users

You installed via `claude plugin marketplace add cdeust/prd-spec-generator` and
use tools like `start_pipeline`, `submit_action_result`, `validate_prd_section`.

**Action:** Migrate to the unified PRD server.

```bash
# Remove the old marketplace plugin
claude plugin uninstall prd-spec-generator

# Install the unified PRD MCP server
npm install -g @agentic/mcp-server-prd

# Register in your .claude/settings.json
{
  "mcpServers": {
    "prd": {
      "command": "mcp-server-prd",
      "args": []
    }
  }
}
```

All 17 MCP tool names are preserved. The stateless reducer semantics
(`step(state, result?) → next_state, action`) are unchanged. Existing
`run_id` values from in-flight pipelines are not portable across the migration;
restart any in-progress pipeline runs after switching.

### Users with the esbuild bundle (`mcp-server/index.js`)

The bundle committed to this repo is preserved byte-for-byte in the monorepo
migration (ADR-0006). The monorepo's CI bundle-freshness gate will detect
any drift on the first merge that touches the PRD pipeline source. You do not
need to rebuild the bundle manually — `@agentic/mcp-server-prd` ships a
pre-built bundle as part of its npm package.

### Users who call Hard Output Rule validators directly

`validate_prd_section` and `validate_prd_document` are unchanged. All Hard
Output Rule regex patterns and scoring logic migrated verbatim. Zero validator
behaviour changes.

---

## What changed

| Aspect | prd-spec-generator (this repo) | agentic-ai (`@agentic/mcp-server-prd`) |
|---|---|---|
| Runtime | TypeScript / Node 20+ | TypeScript / Node 20+ (unchanged) |
| Package namespace | `@prd-gen/*` | `@agentic/prd-*` |
| MCP tool count | 17 tools | 17 tools |
| MCP tool names | (original names) | Preserved verbatim |
| Bundle | `mcp-server/index.js` (committed) | Preserved byte-for-byte (ADR-0006) |
| Git history | Original SHAs (`342f15f`, etc.) | Rewritten via filter-repo (ADR-0005); pre-migration SHAs in `migration/PRE_MIGRATION_COMMIT_GRAPH.txt` |
| Test count | 267 tests | ≥ 267 tests (parity contract) |
| Install method | `claude plugin install prd-spec-generator` | `npm i -g @agentic/mcp-server-prd` |

**Breaking changes: none** for MCP-over-stdio users.
**Non-breaking change:** internal package names renamed from `@prd-gen/*` to
`@agentic/prd-*` (ADR-0005). This only affects direct `import` statements in
consumer code that imports prd-spec-generator's TypeScript packages directly
(unusual; most users interact only through MCP tools).

---

## ADR citations for this migration

- **ADR-0005** — `prd-spec-generator` migration approach: `git filter-repo
  --to-subdirectory-filter` over `git subtree add`. Preserves per-file `git log
  --follow` traceability. Original SHAs frozen in
  `worktrees/port-migrate-prd-spec/migration/PRE_MIGRATION_COMMIT_GRAPH.txt`.
- **ADR-0006** — `mcp-server/index.js` bundle preserved byte-for-byte through
  migration. Bundle correctness is enforced by CI's bundle-freshness gate on
  every subsequent merge.

---

## Schedule

| Date | Event |
|---|---|
| 2026-04-27 | Phase 6 cutover begins; `@agentic/mcp-server-prd` published |
| 2026-05-31 | Final commit on this repo; issues closed |
| 2026-05-31 | Repo archived (read-only) on GitHub |
| 2026-07-31 | Last support cutoff |

---

## Where to file issues

- **New bugs in the unified install** → [github.com/cdeust/agentic-ai/issues](https://github.com/cdeust/agentic-ai/issues)
- **Issues on this repo before archive date** → triaged here through 2026-05-31
- **Issues after archive date** → re-file at agentic-ai; this repo is read-only

---

*prd-spec-generator v0.2.1 is the final release on this repository.*
*The agentic-ai monorepo is the successor. ADR-0005 and ADR-0006 record the migration decisions.*
