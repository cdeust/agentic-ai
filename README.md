# agentic-ai

Unified TypeScript monorepo merging four previously separate ai-architect ecosystem repos:

| Source repo | Future location | Migration strategy |
|---|---|---|
| [`Cortex`](https://github.com/cdeust/Cortex) (Python) | `packages/memory/` | **port** Python → TS, dual-run, parity-tested |
| [`automatised-pipeline`](https://github.com/cdeust/automatised-pipeline) (Rust) | `packages/codebase-rust/` + `packages/codebase/` | **wrap** as subprocess; keep Rust binary, TS adapter |
| [`zetetic-team-subagents`](https://github.com/cdeust/zetetic-team-subagents) (Bash) | `packages/reasoning/` | **port** bash → TS modules + .md prompts |
| [`prd-spec-generator`](https://github.com/cdeust/prd-spec-generator) (TypeScript) | `packages/prd-pipeline/` | **move** with full git history |

Goal: one install, one update path, one bug-report surface — backed by Anthropic's agent SDK + MCP + Skills.

---

## Status

This repo is in **Phase 0 — staging**. It is private until parity with the four source repos is proven.

| Phase | Wall-clock | Description |
|---|---|---|
| 0 — Foundation | 1 day | Shared types, schemas, ports, parity oracle, worktree templates |
| 1 — Skeleton + CI | 2 days | pnpm workspace, tsconfig, ESLint, Vitest, single CI |
| 2 — Move TS repos preserving history | 3 days | prd-spec-generator + zetetic-team-subagents via `git subtree` |
| 3 — Wrap Rust as subprocess | 3 days | RustPipelineAdapter + parity tests on index_codebase |
| 4 — Cortex Python → TS port | 9 worktrees × 7 days parallel | The long pole; sharded across modules |
| 5 — Unified plugin manifest + Skills | 2 days | One `.claude-plugin/marketplace.json`, multiple plugin entries |
| 6 — Cutover, archive old repos | 4 days | Dual-run, parity check, redirect READMEs |

Total: **10–14 days wall-clock with parallel worktrees**, vs **6–10 weeks solo**.

---

## Layout

```
agentic-ai/
├── packages/
│   ├── core/                      Pure domain types + ports (no I/O)
│   ├── memory/                    Cortex re-implementation (TS)
│   ├── codebase/                  Codebase intelligence (TS adapter)
│   ├── codebase-rust/             Rust binary kept as subprocess
│   ├── reasoning/                 zetetic team + genius patterns
│   ├── prd-pipeline/              Stateless reducer + multi-judge verification
│   ├── shared-contracts/          Zod schemas shared across MCP servers
│   ├── mcp-servers/
│   │   ├── memory/
│   │   ├── codebase/
│   │   ├── reasoning/
│   │   └── prd/
│   ├── orchestrator/              Top-level CLI / agent SDK driver
│   └── plugin-distribution/       .claude-plugin manifests + marketplace.json
├── parity-oracle/                 Day-0 fixtures + harness for cross-language parity tests
├── worktrees/                     Local git-worktree mounts (gitignored)
├── docs/
│   ├── MIGRATION_MANIFEST.md      Every artifact from every source repo, with disposition
│   ├── WORKTREE_MISSION_TEMPLATE.md
│   ├── PHASE_PLAN.md
│   └── ADR/                       Decision records
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── .github/workflows/
```

---

## How parallel worktrees work in this repo

Each Cortex module being ported runs in its own git worktree under `worktrees/<branch>/`. Spawn one with:

```bash
./scripts/spawn-worktree.sh <module-name>
# e.g.
./scripts/spawn-worktree.sh recall
```

This creates `worktrees/port-cortex-recall/`, branched from `main`, with the worktree's mission file pre-populated.

Each worktree has its own genius panel + engineering review running per `docs/WORKTREE_MISSION_TEMPLATE.md`. Merge order is fixed in `docs/PHASE_PLAN.md` §4.

---

## License

[MIT](./LICENSE) — Copyright (c) 2026 Clement Deust.

The four source repos this monorepo unifies (Cortex, automatised-pipeline,
zetetic-team-subagents, prd-spec-generator) are each individually MIT-licensed.
This unified repo carries the same license. See each `cutover-staging/*/MIGRATED.md`
for per-repo attribution notes.
