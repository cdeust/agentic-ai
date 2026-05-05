# agentic-ai

Unified TypeScript monorepo merging four previously separate ai-architect ecosystem repos into a single install / one update path / one bug-report surface — backed by Anthropic's agent SDK + MCP + Skills.

| Source repo | Strategy | Location | Parity status |
|---|---|---|---|
| [`Cortex`](https://github.com/cdeust/Cortex) (Python) | port → TS | `packages/memory/` | At cortex@`ed33435` (v3.15.0) plus issue-#16 + issue-#18 fixes from v3.15.1 (cortex@`ff1a64a`). Issues #17, #19, #20 verified N/A in TS architecture (no FastMCP wrapper, no Claude hook scripts, no Dockerfile). |
| [`automatised-pipeline`](https://github.com/cdeust/automatised-pipeline) (Rust) | wrap as subprocess | `packages/codebase-rust/` + `packages/codebase/` | Rust binary kept verbatim; TS adapter wraps with parity tests. |
| [`zetetic-team-subagents`](https://github.com/cdeust/zetetic-team-subagents) (Bash + md) | port → TS modules + .md prompts | `packages/reasoning/` | Agents, skills, hooks, commands all ported. |
| [`prd-spec-generator`](https://github.com/cdeust/prd-spec-generator) (TypeScript) | move with full git history | `packages/prd-pipeline/` | Imported as 10 sub-packages (core, benchmark, ecosystem-adapters, meta-prompting, orchestration, skill, strategy, validation, verification, mcp-server). |

---

## Status — **Ready to use**

The repo has reached parity with all four source repos and is **ready for daily use**.

- ✅ `pnpm build` — clean across every package
- ✅ `pnpm typecheck` — clean across every package
- ✅ `pnpm test` — **3369 passed | 0 skipped | 0 todo**
- ✅ `pnpm layer-check` — Clean Architecture dependency rule enforced (core → domain → application → infrastructure → handlers)
- ✅ `pnpm source-citation-check` — every numeric constant traces to a paper, benchmark, or measured datapoint
- ✅ `pnpm parity` — TS adapter and Rust binary produce byte-identical `node_count`, `edge_count`, `files_indexed` on the small-python fixture

The previous Phase 0–6 plan completed on 2026-05-05; the original 10–14 day estimate held with parallel worktrees.

---

## Verifying the port works (benchmark parity)

The acceptance test for the consolidation: **run the same benchmark datasets the source repos used and verify the TS port reproduces their published scores within ±0.5 percentage points**. If the score holds, the port works. If it drops beyond tolerance, the port has a regression.

### Cortex — LoCoMo retrieval benchmark

The frozen Python baseline (cortex@`1ef1376`, 2026-04-17) on LoCoMo's 1,982 QA pairs:

| Metric | Python baseline |
|---|---|
| Recall@10 | 92.3% |
| MRR | 0.791 |

To run the same benchmark against the TS port:

```bash
# Locate the dataset (defaults to ../cortex/benchmarks/locomo/locomo10.json)
export CORTEX_LOCOMO_PATH=/path/to/cortex/benchmarks/locomo/locomo10.json

# Run the full 10-conversation benchmark (1982 questions)
pnpm bench:cortex

# Or run a small smoke test (1 conversation, ~196 questions)
pnpm bench:cortex --limit 1
```

The CLI loads the same `locomo10.json` Python uses, drives every QA through `recallHandler` against an in-memory `SqliteMemoryStore`, computes per-category MRR + Recall@5 + Recall@10, and diffs the result against the frozen baseline at `parity-oracle/cortex/baselines/locomo.json`. Exit 0 means every metric is within tolerance; exit 1 means at least one metric regressed.

The exact tolerance comes from the Cortex design doc §8: any floor failing by > 0.5 percentage points blocks the port. Improvements always pass (the gate is one-sided).

LongMemEval (500 questions, baseline MRR 0.881 / R@10 97.8%) runs the same way once a `longmemeval` runner is wired — see `parity-oracle/cortex/baselines/longmemeval.json` for the frozen scores.

### Codebase analysis (Rust binary parity)

The Rust binary `ai-architect-mcp` is wrapped, not ported, so parity is exact-equal (zero tolerance). The TS adapter and the binary must produce byte-identical `node_count`, `edge_count`, and `files_indexed` on the same fixture.

```bash
pnpm bench:codebase
```

This invokes `vitest run packages/codebase/__tests__/parity/index_codebase.parity.test.ts` which:

1. Indexes `parity-oracle/codebase/fixture-repos/small-python` once via the TS adapter.
2. Indexes the same fixture again by running the Rust binary directly (golden reference).
3. Asserts the three counts match exactly.
4. Validates the TS output against `IndexCodebaseOutputSchema` (zod).
5. Verifies `analyzeCodebase.totalElapsedMs` is provided by Rust (Lamport assertion: TS does not compute elapsed time itself — frozen `Date.now()` would still produce a positive value because the Rust binary owns the clock).

The frozen reference is documented at `parity-oracle/codebase/baselines/index_codebase.json`.

---

## Install

### 1. Build the workspace (one-time)

```bash
git clone https://github.com/cdeust/agentic-ai.git
cd agentic-ai
pnpm install
pnpm build
```

Requires Node 20+ and pnpm 10+. The Rust binary in `packages/codebase-rust/` builds via `cargo build --release` (run automatically as part of `pnpm -F @agentic/codebase-rust build`).

### 2a. Install via the Claude Code plugin marketplace (recommended)

The repo carries a canonical `.claude-plugin/marketplace.json` listing all four plugins. From any Claude Code session:

```text
/plugin marketplace add cdeust/agentic-ai
/plugin install memory@agentic-ai
/plugin install codebase@agentic-ai
/plugin install reasoning@agentic-ai
/plugin install prd@agentic-ai
```

Each plugin's bundled `.mcp.json` wires the corresponding MCP server (`cortex`, `ai-architect`, `reasoning`, `prd-gen`) to the unified TS / Rust outputs under `packages/`. No additional configuration is needed — `pnpm build` produces every artifact the plugins reference.

For local development against an unpublished branch, replace the `add` line with:

```text
/plugin marketplace add file:///absolute/path/to/agentic-ai
```

### 2b. Install MCP servers directly (without the marketplace)

The repo also ships a project-scoped `.mcp.json` at the root. Claude Code auto-detects it when the project directory is opened, exposing all four servers:

| MCP server name | Source | Description |
|---|---|---|
| `cortex` | `packages/mcp-servers/memory/` | Persistent memory (Cortex TS port) |
| `ai-architect` | `packages/codebase-rust/` | Codebase intelligence (Rust binary) |
| `reasoning` | `packages/mcp-servers/reasoning/` | Genius + team reasoning agents |
| `prd-gen` | `packages/mcp-servers/prd/` | PRD pipeline |

To register one server in a different project, follow Anthropic's official `claude mcp add` flow:

```bash
# Memory
claude mcp add cortex -- node /path/to/agentic-ai/packages/mcp-servers/memory/dist/index.js

# Codebase
claude mcp add ai-architect -- /path/to/agentic-ai/packages/codebase-rust/target/release/ai-architect-mcp

# Reasoning
claude mcp add reasoning -- node /path/to/agentic-ai/packages/mcp-servers/reasoning/dist/index.js

# PRD
claude mcp add prd-gen -- node /path/to/agentic-ai/packages/mcp-servers/prd/dist/index.js
```

---

## Layout

```
agentic-ai/
├── packages/
│   ├── core/                       Pure domain types + ports (no I/O)
│   ├── memory/                     Cortex re-implementation (TS) — main package, ~370 source files
│   ├── memory-dashboard/           Web dashboard for memory inspection
│   ├── codebase/                   Codebase intelligence — TS adapter
│   ├── codebase-rust/              Rust binary (ai-architect-mcp), kept as subprocess
│   ├── reasoning/                  zetetic team + genius reasoning patterns
│   ├── prd-pipeline/packages/      10 sub-packages from prd-spec-generator
│   │   ├── core/  benchmark/  ecosystem-adapters/  meta-prompting/
│   │   ├── orchestration/  skill/  strategy/  validation/  verification/
│   │   └── mcp-server/
│   ├── mcp-servers/
│   │   ├── memory/                 MCP server for memory
│   │   ├── codebase/               MCP server for codebase
│   │   ├── reasoning/              MCP server for reasoning agents
│   │   └── prd/                    MCP server for PRD pipeline
│   ├── orchestrator/               Top-level CLI / agent SDK driver
│   └── parity-runner/              Cross-language parity test runner
├── parity-oracle/                  Fixtures + harness for cortex / codebase / prd parity
├── worktrees/                      Local git-worktree mounts (gitignored)
├── scripts/
│   ├── spawn-worktree.sh           Create an isolated worktree for an engineer task
│   ├── dispatch-engineer.sh        Atomic worktree spawn + install + path print
│   ├── parity-dual-run.sh          Run TS + reference and diff outputs
│   ├── audit-migration.sh          Track port-pending markers across the codebase
│   ├── check-layer-imports.ts      Layer-rule enforcement
│   └── check-source-citations.sh   Numeric-constant citation audit
├── docs/
│   ├── CONTRIBUTING_WORKTREE_PROTOCOL.md   Worktree isolation protocol
│   ├── audits/                              Periodic genius audits (Liskov, Feynman, Cochrane, …)
│   └── ADR/                                 Decision records
├── .husky/
│   ├── pre-commit                  Source-citation + lint + typecheck gates
│   └── pre-push                    install + build + layer-check + citation + migration + test gates
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── vitest.config.ts
└── .github/workflows/
```

---

## Workflow — parallel engineer dispatches

Every parallel engineer dispatch runs in its own isolated git worktree under `worktrees/<branch>/` to prevent cross-contamination. Spawn one with:

```bash
bash scripts/dispatch-engineer.sh <branch>
# Prints: ENGINEER_WORKTREE_PATH=/.../worktrees/<slug>
```

The script aborts if the parent worktree is dirty (no contamination escapes), creates the worktree, runs `pnpm install`, and prints the path for the orchestrator to dispatch into. See [`docs/CONTRIBUTING_WORKTREE_PROTOCOL.md`](./docs/CONTRIBUTING_WORKTREE_PROTOCOL.md) for the full protocol enforced by the pre-commit and pre-push hooks.

---

## Pre-push gates (mirror CI)

`.husky/pre-push` runs the same gates CI runs, before the push leaves the laptop:

1. `pnpm install --frozen-lockfile` — lockfile sync assertion
2. `pnpm build` — TS + Rust workspace
3. `pnpm layer-check` — Clean Architecture dependency rule
4. `pnpm source-citation-check`
5. `pnpm audit-migration` — port-pending tracking
6. `pnpm test`

Bypass:
- `git push --no-verify` — one-off skip
- `PRE_PUSH_SKIP_TESTS=1 git push` — skip just `pnpm test` (~30s saved)
- `HUSKY=0 git push` — disable all hooks

---

## License

[MIT](./LICENSE) — Copyright (c) 2026 Clement Deust.

The four source repos this monorepo unifies (Cortex, automatised-pipeline, zetetic-team-subagents, prd-spec-generator) are each individually MIT-licensed. This unified repo carries the same license. See each `cutover-staging/*/MIGRATED.md` for per-repo attribution notes.
