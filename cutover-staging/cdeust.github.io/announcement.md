---
title: "Four repos, one install: introducing agentic-ai"
date: 2026-04-27
---

<!-- PLACEHOLDER: publish path unknown. This file is staged here for the
     cutover operator to place at the correct path in cdeust.github.io before
     the archive date. If the site uses Jekyll, this goes in _posts/.
     If it uses Hugo, it goes in content/posts/. Adjust front-matter as needed. -->

---

## Who is this for?

This announcement has three audiences. Find yours.

**I am a curious developer** who came across one of the four repos (Cortex,
automatised-pipeline, zetetic-team-subagents, or prd-spec-generator) and wants
to understand what happened. Start with "The short version" below.

**I have an existing install** of one or more of these tools and I need to know
what to do without breaking my workflow. Start with "What existing users should
do" below.

**I want to contribute** to the successor project. Start with "For contributors"
below.

---

## The short version

Four repos that were always designed to work together have been unified into a
single TypeScript monorepo: **[agentic-ai](https://github.com/cdeust/agentic-ai)**.

| Old repo | New install |
|---|---|
| `cdeust/Cortex` | `@agentic/mcp-server-memory` |
| `cdeust/automatised-pipeline` | `@agentic/mcp-server-codebase` |
| `cdeust/zetetic-team-subagents` | `@agentic/mcp-server-reasoning` |
| `cdeust/prd-spec-generator` | `@agentic/mcp-server-prd` |

All four old repos will be **archived** (not deleted) on 2026-05-31. They remain
readable. Nothing disappears.

---

## What existing users should do

Each archived repo contains a `MIGRATED.md` at its root with exact migration
instructions for your install type. The one-sentence version:

- **Cortex MCP-over-stdio users:** `npm install -g @agentic/mcp-server-memory`, then `/cortex-setup-project`.
- **Cortex HTTP dashboard users:** stay on the Cortex repo until `@agentic/memory` v0.4.x ships (the dashboard port is in progress; see ADR-0011).
- **automatised-pipeline Rust binary users:** `npm install -g @agentic/mcp-server-codebase` — the Rust binary is bundled; no `cargo build` needed.
- **zetetic-team-subagents users:** `npm install -g @agentic/mcp-server-reasoning` — all 116 agents migrated, no behaviour change.
- **prd-spec-generator users:** `npm install -g @agentic/mcp-server-prd` — all 17 tools preserved, zero breaking changes for MCP users.

No data loss. No tool renames. No schema changes. The four tools work together
more smoothly than before because they share a single dependency graph, a single
CI run, and a single release cycle.

---

## Why unify?

Each tool was always a consumer of the others. Cortex called `run_pipeline` in
automatised-pipeline. prd-spec-generator consumed Cortex memory and the
codebase graph. zetetic-team-subagents were routed by Cortex. Four repos meant
four version matrices, four install steps, four update cycles, and four places
to file a bug that turned out to span two repos.

The monorepo is not a rewrite. It is an honest representation of what was
already true: these are one system.

---

## For contributors

The monorepo is at [github.com/cdeust/agentic-ai](https://github.com/cdeust/agentic-ai).

Architecture decisions are documented in `docs/ADR/` (11 ADRs at time of writing).
The package layout follows Clean Architecture with strict inward-only dependency
rules enforced at import-lint time. The full migration history for each source
repo is preserved — `git log --follow` traces files back through the original
repositories.

Open issues from the four source repos that are not closed before the archive
date will be triaged to agentic-ai. If you filed an issue on one of the source
repos, check [github.com/cdeust/agentic-ai/issues](https://github.com/cdeust/agentic-ai/issues)
after 2026-05-31.

---

## One thing that is NOT ready yet

The Cortex HTTP dashboard (the 3D graph / wiki / file-diff viewer at
`127.0.0.1`) is not included in the initial unified release. It is a
follow-up port (approximately 3 weeks of work) scheduled for `@agentic/memory`
v0.4.x. If you use the dashboard, keep the Cortex repo active alongside the
new unified install — they share the same PostgreSQL database without conflict.

---

*All four source repos archive on 2026-05-31.*
*The successor is [github.com/cdeust/agentic-ai](https://github.com/cdeust/agentic-ai).*
