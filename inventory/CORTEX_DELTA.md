# Cortex Delta — since CORTEX_INVENTORY.md snapshot (2026-04-26)

**Source**: `/Users/cdeust/Developments/Cortex` (private)
**Snapshot baseline**: `inventory/CORTEX_INVENTORY.md` (2026-04-26, 361 .py files, ~78 461 LOC)
**Current HEAD**: `df141f5 release: v3.14.12 — fix MCP client deadlock on long upstream responses` (2026-04-28)
**Commits added since baseline**: 6 user-facing releases (v3.14.8 → v3.14.12) + supporting fixes

This file records what changed in Cortex Python AFTER the Phase-4 inventory
was taken, so the TS port in `packages/memory/src/` can be re-synchronized
in a Phase 4.5 follow-up worktree. None of these deltas block Phase 2/3
prd-spec or zetetic-team-subagents migration; they only affect future
Cortex re-port quality.

---

## Group 1 — `ingest_codebase` overhaul (v3.14.8 + v3.14.9)

**Affects TS port**: `packages/memory/src/codebase-analysis/handlers/ingest-codebase.ts` and helpers.

### Files changed in Cortex Python

- `mcp_server/handlers/ingest_codebase.py` — full-chain extraction added
- `mcp_server/handlers/ingest_codebase_cypher.py` — no caps + Rust-style qualified-name fallback (+75 lines)
- `mcp_server/handlers/ingest_codebase_schema.py` — schema simplification (-21 lines)
- `mcp_server/tool_registry_ingest.py` — registry updates

### Behavioural deltas to re-port

1. **No caps**: previous version capped node/edge counts during ingestion.
   v3.14.9 removes caps to support large codebases (the ones the user
   currently runs into 400K-node territory on — see "out of scope" below).
2. **Rust-style qualified-name fallback**: when LSP cannot resolve a symbol
   to a fully-qualified name, fall back to `crate::module::Symbol` style
   parsing. Required for the automatised-pipeline (Rust) target.
3. **Schema simplification**: 21 lines of dead schema-extraction logic
   removed. The TS port has the equivalent dead code; safe to remove
   when re-syncing.

### TS port status

`packages/memory/src/codebase-analysis/` was ported from Cortex HEAD as of
2026-04-26 and is now drift relative to the current Cortex HEAD. Specific
symbols affected: `IngestCodebaseHandler`, `cypher_query_builder`,
`schema_extractor` (names mapped from Python).

**Tracking**: add to `docs/PHASE_7_TRACKING.md` as Group H (Cortex re-sync).

---

## Group 2 — Marketplace-only install path (ADR-0050)

**Affects TS port**: nothing in `packages/memory/src/` (this is install/launch infra).

Cortex 2026-04-26..2026-04-28 dropped every `uvx` invocation and committed
exclusively to marketplace-style install. Cortex commits:

- `8f76f85 chore: remove every uvx invocation`
- `450824b docs(adr): ADR-0050 — marketplace is the only path, no uvx ever`

**Implication for monorepo**: the Cortex TS plugin (`plugins/memory/`) must
follow the same convention. A grep for `uvx` in the monorepo currently
returns nothing — already clean. No port-pending action.

---

## Group 3 — Self-locating plugin MCP launcher (v3.14.10)

**Affects TS port**: `plugins/memory/.mcp.json` and `plugins/memory/plugin.json`.

Cortex Python introduced a self-locating launcher: the `.mcp.json` reads
`installed_plugins.json` to find its own install path, eliminating the
fragile `${CLAUDE_PLUGIN_ROOT:-fallback}` pattern (the same one ADR-0010
forbids).

### TS port status

Already fully aligned — `plugins/memory/.mcp.json` uses bare
`${CLAUDE_PLUGIN_ROOT}` per ADR-0010. The new self-locating mechanism is
slightly different: it reads `~/.claude/installed_plugins.json` at runtime.
The TS launcher is `node dist/index.js` and does not have the same
self-location requirement (Node resolves its own bin path), so this is a
no-op for the monorepo.

---

## Group 4 — automatised-pipeline rename + pool allowlist (v3.14.11)

**Affects TS port**: `packages/codebase/` (when Phase 3 lands) — the Rust
binary rename from `ai-architect` → `automatised-pipeline` is already
captured in MIGRATION_MANIFEST.md.

Cortex commits touched:
- `mcp_server/infrastructure/ap_bridge.py` — adapter rename
- `mcp_server/infrastructure/mcp_client_pool.py` — allowlist fix
- `mcp_server/infrastructure/pipeline_installer.py` — rename references
- `mcp_server/server/http_launcher.py`, `http_standalone.py` — rename refs

**TS port status**: Phase 3 is unstarted; the rename is already documented
in the inventory at the binary level. No action required until Phase 3
lands `packages/codebase-rust/`.

---

## Group 5 — MCP client deadlock fix (v3.14.12)

**Affects TS port**: `packages/memory/src/infrastructure/mcp-client.ts` (when
infrastructure layer is wired in Phase 5/6 composition root).

Cortex Python fix: timeout + cancellation handling for long upstream MCP
responses. The TS port currently uses the official MCP SDK directly which
already has its own timeout handling — verify equivalence when wiring the
composition root.

**Action**: add to `docs/PHASE_7_TRACKING.md` Group D as a verification
item, NOT a re-port. The TS SDK may already cover the deadlock path.

---

## Out of scope for this monorepo

The user explicitly noted: "for graph we're still in the middle of nowhere
because now we have to solve a problem of showing 400K nodes." That is a
Cortex-side rendering performance problem (likely in the HTTP dashboard or
graph-visualization layer), not a port concern. ADR-0011 already defers
the Cortex HTTP server / dashboard to post-cutover. No action in
agentic-ai.

---

## Summary — what to add to PHASE_7_TRACKING.md

| Group | Source | Action | Tracking entry |
|---|---|---|---|
| H — Cortex re-sync (codebase-analysis) | v3.14.8/9 | Re-port `ingest_codebase*` from current Cortex HEAD | New: `[Phase 7] Cortex codebase-analysis re-sync (post-v3.14.9 ingest_codebase)` |
| (D extension) | v3.14.12 | Verify TS MCP SDK already covers the deadlock case | Update existing Group D |

All other Cortex deltas are no-ops or already aligned.
