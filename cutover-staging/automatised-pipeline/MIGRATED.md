> **NOTICE: automatised-pipeline's runtime has moved to [agentic-ai](https://github.com/cdeust/agentic-ai).**
> The unified install is `@agentic/mcp-server-codebase`. This repository will be
> archived on **2026-05-31** and is read-only after that date.

---

# automatised-pipeline has moved to agentic-ai

**Your question is: "I have a working automatised-pipeline install. What do I do now?"**

---

## What you should do

### Rust binary users

You built the binary with `cargo build --release` and registered it in
`.mcp.json` as `ai-architect`, pointing at the Rust process directly.

**Action:** Switch to the unified TypeScript adapter.

```bash
# Install the unified codebase MCP server
npm install -g @agentic/mcp-server-codebase

# Replace your .mcp.json entry
{
  "mcpServers": {
    "codebase": {
      "command": "mcp-server-codebase",
      "args": []
    }
  }
}
```

The TypeScript adapter wraps the same Rust binary as a managed subprocess
(ADR-0001: subprocess chain with explicit `SIGTERM` propagation to the LSP
grandchild; ADR-0002: serial queue for Phase 3, parallel pool deferred).
The Rust binary is shipped as a native dependency of `@agentic/mcp-server-codebase`
— you no longer need a separate `cargo build` step.

The 23 MCP tool names are preserved. Existing `analyze_codebase` calls,
`search_codebase` calls, and `validate_prd_against_graph` calls work
without schema changes.

### Users who call `validate_prd_against_graph` or `check_security_gates`

These two tools accept the optional `(run_id, finding_id, output_dir)` triple.
The TypeScript adapter enforces the all-or-nothing contract specified in ADR-0004:
providing `run_id` without `output_dir` is now a validation error at the TS layer
(previously silently ignored by the Rust binary). If you pass partial triples,
update your call sites to pass all three or none.

---

## What changed

| Aspect | automatised-pipeline (this repo) | agentic-ai (`@agentic/mcp-server-codebase`) |
|---|---|---|
| Runtime | Rust binary, registered directly | Rust binary wrapped via TS subprocess adapter |
| Tool count | 23 MCP tools | 23 MCP tools |
| Tool names | (original names) | Preserved verbatim |
| Concurrency | Tokio single-process | Serial queue (ADR-0002); parallel pool post-v0.5 |
| Preconditions | Semantic checks in Rust only | Shape-only checks in TS; semantic checks in Rust (ADR-0003) |
| Artifact triple | Partial triples silently ignored | Partial triples are a TS validation error (ADR-0004) |
| Build requirement | `cargo build --release` (user) | Binary bundled in npm package |
| Install method | `cargo build` + manual `.mcp.json` | `npm i -g @agentic/mcp-server-codebase` |

**Breaking change:** `(run_id, finding_id, output_dir)` partial triples now
return a validation error instead of silently no-oping (ADR-0004). All other
tool signatures are backward-compatible.

---

## ADR citations for this migration

- **ADR-0001** — LSP subprocess chain timeout and `SIGTERM` propagation.
  Defines how the Rust binary's child LSP processes are terminated when
  the TS adapter disposes or times out.
- **ADR-0002** — `analyze_codebase` concurrency: serial queue for Phase 3
  launch; parallel adapter pool deferred to Phase 6+.
- **ADR-0003** — Adapter preconditions must not be stronger than the Rust binary.
  TS adapter validates shape only; semantic validation is the Rust binary's authority.
- **ADR-0004** — Optional `(run_id, finding_id, output_dir)` triple typed as
  all-or-nothing. Partial presence is a contract defect; the TS adapter rejects it.

---

## Schedule

| Date | Event |
|---|---|
| 2026-04-27 | Phase 6 cutover begins; `@agentic/mcp-server-codebase` published |
| 2026-05-31 | Final commit on this repo; issues closed |
| 2026-05-31 | Repo archived (read-only) on GitHub |
| 2026-07-31 | Last support cutoff |

---

## Where to file issues

- **New bugs in the unified install** → [github.com/cdeust/agentic-ai/issues](https://github.com/cdeust/agentic-ai/issues)
- **Issues on this repo before archive date** → triaged here through 2026-05-31
- **Issues after archive date** → re-file at agentic-ai; this repo is read-only

---

*automatised-pipeline is the final release on this repository.*
*The agentic-ai monorepo is the successor. ADRs 0001–0004 record the migration decisions.*
