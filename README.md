<p align="center">
  <img src="docs/assets/banner.svg" alt="agentic-ai — one install: persistent memory + codebase intelligence + reasoning patterns + PRD pipeline, running natively in Claude Code" width="100%"/>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/TypeScript-5.6+-3178c6.svg" alt="TypeScript 5.6+">
  <img src="https://img.shields.io/badge/Node-20.x_·_22.x-339933.svg" alt="Node 20/22">
  <img src="https://img.shields.io/badge/Plugins-4-8A2BE2" alt="4 plugins">
  <img src="https://img.shields.io/badge/MCP_Tools-87+-orange" alt="87+ MCP tools">
  <img src="https://img.shields.io/badge/Tests-3500+_passing-brightgreen" alt="Tests">
  <img src="https://img.shields.io/badge/Cortex_LoCoMo-MRR_0.851-success" alt="LoCoMo MRR 0.851">
  <img src="https://img.shields.io/badge/Audit-0_critical_·_0_high-success" alt="Security audit clean">
</p>

<p align="center">
  <a href="#getting-started">Getting Started</a> · <a href="#what-you-get">What You Get</a> · <a href="#how-it-works">How It Works</a> · <a href="#verification">Verification</a> · <a href="#layout">Layout</a> · <a href="#license">License</a>
</p>

<p align="center">
  <strong>This monorepo unifies four projects:</strong><br>
  <a href="https://github.com/cdeust/Cortex">Cortex</a> — persistent memory with biological consolidation<br>
  <a href="https://github.com/cdeust/automatised-pipeline">automatised-pipeline</a> — Rust codebase-intelligence graph<br>
  <a href="https://github.com/cdeust/zetetic-team-subagents">zetetic-team-subagents</a> — 97 reasoning patterns + 19 team agents<br>
  <a href="https://github.com/cdeust/prd-spec-generator">prd-spec-generator</a> — stateless PRD reducer with multi-judge verification
</p>

---

Claude Code is powerful in one session and amnesiac the next. It can reason about a function but not the call graph it sits in. It can draft a PRD but not measure whether the PRD is actionable. Each of these problems has a project; each project has its own install, its own update path, its own MCP server, its own bug-report surface.

**agentic-ai** is the four projects merged into one TypeScript monorepo with a single Claude Code marketplace install. One `pnpm` command builds everything. One `/plugin install` enables any of the four capabilities. The MCP servers are wired against the unified TS/Rust outputs, not the original separate repos. The Cortex retrieval pipeline runs end-to-end in TypeScript and **exceeds the Python baseline** on the LoCoMo benchmark (MRR 0.851 vs 0.696, hit-rate 98.5% vs 95.9%).

**4 plugins. 87+ MCP tools across them. 3500+ tests. Real-subprocess parity verification against every source repo. `pnpm audit --prod` clean.**

---

## Getting Started

```text
/plugin marketplace add cdeust/agentic-ai
/plugin install memory@agentic-ai
/plugin install codebase@agentic-ai
/plugin install reasoning@agentic-ai
/plugin install prd@agentic-ai
```

That's it. Restart your Claude Code session and the four MCP servers (`cortex`, `ai-architect`, `reasoning`, `prd-gen`) are available. Install one or all four — they work independently.

Each plugin ships **self-contained** under its install path: an esbuild bundle (`dist/index.js`) for the JS plugins, the Cargo source (`src-rust/`) for the codebase plugin, and a `scripts/launch.sh` that resolves native deps on first launch. No monorepo checkout required client-side.

| Plugin | First launch behavior |
|---|---|
| `memory` | `npm install --omit=dev` runs once for native deps (better-sqlite3, onnxruntime-node, @xenova/transformers, pg, sqlite-vec) — then exec `node dist/index.js` |
| `codebase` | Tries `ai-architect-mcp` from PATH → plugin `bin/` → `src-rust/target/release/` → `cargo build --release` from `src-rust/` (requires Rust toolchain on the host) |
| `reasoning` | exec `node dist/index.js` directly — no native deps |
| `prd` | `npm install --omit=dev` runs once for `ajv`, then exec `node dist/index.js` |

The marketplace's `.claude-plugin/marketplace.json` is at the repo root, so the standard Anthropic plugin protocol resolves the four plugins automatically. `mcpServers` is declared inline in each plugin's `.claude-plugin/plugin.json`; no additional client-side configuration is needed.

---

## What You Get

### `memory` — persistent memory (port of Cortex)

Persistent memory for Claude Code with biological consolidation, intent-aware retrieval, and a thermodynamic heat/decay model. Sessions remember what you worked on, how you decided things, and why — and the right context surfaces when it's relevant rather than as a dumb text dump in every prompt.

- **45+ MCP tools** (recall, remember, anchor, narrative, wiki, consolidation, navigate, …)
- SQLite by default; PostgreSQL + pgvector when `DATABASE_URL` is set (Cortex's production stack)
- Cross-encoder reranking via FlashRank ONNX (`Xenova/ms-marco-MiniLM-L-12-v2`) — **score parity with Python flashrank verified within 1e-7** on 5 (query, passage) pairs
- 41 published-paper citations covering every numeric constant

### `codebase` — codebase intelligence (Rust binary wrapped)

The `ai-architect-mcp` Rust binary indexes Rust / Python / TypeScript codebases into a LadybugDB property graph. Resolves imports + call chains, detects communities via Leiden, traces execution flows from entry points. BM25 + TF-IDF + RRF hybrid search.

- **23 MCP tools** (`index_codebase`, `query_graph`, `get_symbol`, `impact_analysis`, `semantic_diff`, …)
- Strategy: wrap the Rust binary as a subprocess; never re-implement
- All 23 tools have real-subprocess round-trip parity tests against the binary
- 6 Zod schema drifts in the TS adapter were closed against `tool_schemas.rs` ground truth

### `reasoning` — 97 genius patterns + 19 team agents (port of zetetic-team-subagents)

97 reasoning patterns from history's greatest minds — Feynman, Liskov, Popper, Knuth, Lamport, Curie, Borges, Mendeleev, and so on — each with documented refusal conditions and a primary-paper citation. Plus 19 team specialist agents (architect, engineer, security-auditor, …) and 16 lifecycle hooks. Pre-tool / post-tool guards for git commit provenance, layer-check, research citation.

- **2 MCP tools** (`memory`, `memory_extensions`) ported from Python `memory-mcp-server.py` 1:1
- **Byte-equivalent JSON-RPC parity** with the Python source verified by real Python ↔ TS subprocess pair across initialize, `tools/list` (26 fields per tool), all 15 `tools/call` commands, validation errors, and concurrency
- 61 skills, 25 commands, 16 hooks — all preserved 1:1 from the source repo

### `prd` — PRD generation (move of prd-spec-generator)

Stateless reducer that turns a feature description into a 9-file PRD. Multi-judge verification with weighted-average + Bayesian consensus, calibrated against externally-grounded oracles (schema / math / code / spec). Phase 4 closed loop: per-judge Bayesian reliability calibration, Kaplan-Meier retry budgets, Clopper-Pearson KPI gates, mechanically-sealed held-out partitions, paired-bootstrap cross-arm comparisons.

- **17 MCP tools** + 10 pipeline steps
- 583 tests, all preserved from the source repo
- The only port of the four where the source itself was already TypeScript — imported as 10 sub-packages with `@prd-gen/*` → `@agentic/prd-*` namespace rewrite, zero logic changes

---

## How It Works

The core idea: every plugin's MCP server is a thin composition root over a domain layer that's pure logic. The four plugins share infrastructure (SqliteMemoryStore, recall pipeline, EmbeddingEngine, reasoning patterns) without depending on each other's MCP boundaries.

```
<plugin-root>/.claude-plugin/plugin.json   ← Anthropic plugin manifest (mcpServers inline)
<plugin-root>/scripts/launch.sh            ← First-launch native-dep installer (memory, prd, codebase)
<plugin-root>/dist/index.js                ← esbuild bundle (committed; ships with `git clone`)
       │
       ▼
packages/<domain>/src/...                  ← Domain logic, bundled into dist/ (pure, no I/O)
       │
       ▼
packages/core/src/ports/...                ← Ports/adapters interfaces
```

`<plugin-root>` is `plugins/memory/`, `plugins/codebase/`, `plugins/prd/`, or `packages/reasoning/` (the reasoning plugin's source root is the workspace package itself, since it ships agents/, skills/, commands/, hooks/, scripts/setup.sh alongside the MCP bundle).

When you `/plugin install`, Claude Code reads the marketplace manifest, resolves the plugin's inline `mcpServers` field, and starts the matching MCP server as a stdio JSON-RPC subprocess. The MCP server wires SQLite (or PostgreSQL when configured) + the embedding engine + the LLM client + the reasoning patterns through dependency injection at startup. Tool calls land in the same domain code paths a unit test exercises.

---

## Verification

Every port was verified against its source repo via **real-subprocess execution** — not unit tests with mocked SDKs, not "looks correct" claims:

| Port | Verification |
|---|---|
| Cortex | Real Python `flashrank` ↔ TS reranker score parity (5 pairs, all `<1e-7` diff). Real Python `pg_recall.py` ↔ TS `recall()` head-to-head on LoCoMo conversation 0 (197 questions). **TS exceeds Python baseline:** hit-rate 98.5% (+2.6pp), MRR 0.851 (+15.5pp), R@10 98.5% (+2.6pp). 178/196 questions ranked at-or-better than Python. |
| automatised-pipeline | Real Rust binary ↔ TS adapter subprocess round-trip for all 23 MCP tools. 6 Zod schema drifts found and fixed against `tool_schemas.rs` ground truth. Per-tool parity tests under `packages/codebase/__tests__/parity/`. |
| zetetic-team-subagents | Real Python ↔ TS MCP-server subprocess pair. JSON-RPC `initialize`, `tools/list` (26 fields per tool), all 15 `tools/call` commands, validation errors, concurrency — every response byte-identical. |
| prd-spec-generator | File-by-file diff against the source repo. 17/17 MCP tools, 58/58 tests, byte-identical Phase 4 statistics. Only delta is the intentional `@prd-gen/*` → `@agentic/prd-*` namespace rewrite. |

**Quality gates** (run `pnpm verify` to reproduce):

| Gate | Result |
|---|---|
| `pnpm build` | clean across every package |
| `pnpm typecheck` | clean across every package |
| `pnpm test` | 3500+ passing |
| `pnpm layer-check` | 0 violations on 636 files (Clean Architecture dependency rule) |
| `pnpm source-citation-check` | every `≥3 sig-digit` numeric constant cites a paper / benchmark / measurement |
| `pnpm audit --prod` | 0 critical · 0 high · 0 moderate · 0 low |
| Cross-platform portability | path separators, env vars, FS case sensitivity, monotonic clocks all platform-gated (Linux × macOS × Windows × Node 20/22/24) |

---

## Layout

```
agentic-ai/
├── .claude-plugin/marketplace.json  Canonical Anthropic marketplace manifest (4 plugins)
├── plugins/
│   ├── memory/                      Cortex plugin: dist/index.js + scripts/launch.sh + package.json (native deps)
│   ├── codebase/                    automatised-pipeline plugin: src-rust/ (Cargo source) + scripts/launch.sh
│   └── prd/                         prd-spec-generator plugin: dist/index.js + scripts/launch.sh + package.json (ajv)
├── packages/
│   ├── core/                        Pure domain types + ports (no I/O)
│   ├── memory/                      Cortex re-implementation in TS
│   ├── memory-dashboard/            Web dashboard (Graph / Knowledge / Board views)
│   ├── codebase/                    TS adapter wrapping the Rust binary
│   ├── codebase-rust/               The Rust binary (workspace dev source — also copied into plugins/codebase/src-rust/ for shipping)
│   ├── reasoning/                   reasoning plugin: agents/, skills/, commands/, hooks/, dist/index.js (this dir IS the plugin install root)
│   ├── prd-pipeline/packages/       10 sub-packages from prd-spec-generator
│   ├── mcp-servers/{memory,codebase,reasoning,prd}/   MCP composition roots (TS source bundled into plugin dist/)
│   ├── orchestrator/                Top-level CLI / agent SDK driver
│   ├── parity-runner/               Cross-language fixture parity test runner
│   └── parity-benchmark/            End-to-end LoCoMo benchmark harness
├── parity-oracle/                   Day-0 Python-captured fixtures + frozen baselines
└── docs/                            ADRs, audit reports, migration manifests
```

---

## License

[MIT](./LICENSE) — Copyright (c) 2026 Clement Deust.

The four source repos this monorepo unifies (Cortex, automatised-pipeline, zetetic-team-subagents, prd-spec-generator) are each individually MIT-licensed.
