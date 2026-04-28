# Phase 3 Plan — Wrap the Rust automatised-pipeline as a TS subprocess adapter

**Status:** RESEARCH — proposed plan, no code written.
**Branch:** `port/phase-3-plan`
**Author:** architect agent (Cortex orchestrator), 2026-04-27
**Phase reference:** `docs/PHASE_PLAN.md` §"Phase 3 — Wrap Rust (automatised-pipeline) as subprocess (3 days)"

## Sources consulted (top-of-file citation manifest)

The following files are referenced multiple times in this plan. Per-section citations point back here.

- `docs/PHASE_PLAN.md` — Phase 3 deliverables, genius gates, merge order context.
- `inventory/RUST_INVENTORY.md` — module-by-module Rust source inventory (12 150 LOC across 27 files).
- `inventory/MCP_TOOLS.md` — 23 MCP tools, full input/output schemas, error-code catalogue.
- `docs/ADR/0001-lsp-resolve-subprocess-chain.md` — three-process pipeline (TS → Rust → LSP), `setsid` PGID, per-call LSP isolation.
- `docs/ADR/0002-analyze-codebase-serial-vs-parallel.md` — single subprocess + serial queue for Phase 3 launch.
- `docs/ADR/0003-adapter-precondition-strength.md` — TS adapter validates only syntactic shape; Rust is the semantic authority.
- `docs/ADR/0004-validation-tool-optional-triple.md` — `ArtifactWriteSpec | undefined` discriminated bundle.
- `docs/ADR/0007-better-sqlite3-native-build.md` — pnpm `onlyBuiltDependencies` precedent for native modules.
- `docs/ADR/0009-tsconfig-nodenext.md` — module resolution baseline.
- `/Users/cdeust/Developments/anthropic/ai-automatised-pipeline/Cargo.toml` — workspace + dependency manifest of the source repo.
- `/Users/cdeust/Developments/anthropic/ai-automatised-pipeline/src/main.rs:1-80` — wire-protocol contract (newline-delimited JSON-RPC 2.0).
- `packages/parity-runner/src/runners/codebase.ts:50-104` — already-shipped reference for spawnSync + JSON-RPC against the Rust binary.
- `packages/mcp-servers/codebase/src/index.ts` — Phase-5 stub composition root that this work unblocks.
- `parity-oracle/codebase/{inputs,expected}/` — five fixtures already captured (`health_check`, `index_codebase_smallrepo`, `query_graph_simple`, `get_symbol_known`, `search_codebase_keyword`).
- `coding-standards.md` §1, §2, §5, §7 — SOLID, Clean Architecture, reverse DI, local reasoning. Binding rules.

---

## Section 1 — Source repo survey

**Citations:** `Cargo.toml`, `inventory/RUST_INVENTORY.md`, `inventory/MCP_TOOLS.md`, `src/main.rs`, `tests/`, `benches/harness/Cargo.toml`.

### 1.1 Source location and resolution

The "automatised-pipeline" repo named in the Phase 3 deliverable is on disk at:

```
/Users/cdeust/Developments/anthropic/ai-automatised-pipeline/
```

This is the canonical Rust source. The path `parity-oracle/RUNBOOK.md` §0 still names the legacy location `/Users/cdeust/Developments/automatised-pipeline` (which does not exist on this machine). RUNBOOK and PHASE_PLAN should be updated to the verified location during Phase 3 implementation.

### 1.2 Cargo workspace layout

The Cargo manifest (`Cargo.toml`) defines a two-member workspace:

```toml
[workspace]
members = [".", "benches/harness"]
```

- **Member `.`** — the `ai-architect-mcp` binary crate (Rust 2021, version `0.0.4`). Source under `src/`. Bin target `ai-architect-mcp` resolves to `src/main.rs`. Library target `src/lib.rs` re-exports modules so the integration tests in `tests/` can import them without going through `main.rs`.
- **Member `benches/harness`** — separate `bench-end-result` crate. Stage-3b-v2 §2 evaluation harness. Pulls `clap`, `tempfile` deps that should not contaminate the binary. **Out of scope for the agentic-ai monorepo** — keeps the ported workspace lean.

The Rust 2021 edition + `lto = "thin"` `release` profile are inherited verbatim by the relocated workspace.

### 1.3 External dependency manifest

| Crate | Version | Role | Source citation |
|---|---|---|---|
| `serde` | 1 | Derive macros | — (de-facto stdlib) |
| `serde_json` | 1 | JSON serialisation | wire layer |
| `sha2` | 0.10 | SHA-256 transcript digest | `stages/stage-2.md §12.4` |
| `lbug` | 0.15 | LadybugDB embedded property graph (Cypher) | `stages/stage-3.md §7` |
| `tree-sitter` | 0.24 | Parser runtime | `stages/stage-3.md §3a` |
| `tree-sitter-rust` | 0.23 | Rust grammar | `stages/stage-3.md §3a` |
| `tree-sitter-python` | 0.23 | Python grammar | multi-language support |
| `tree-sitter-typescript` | 0.23 | TypeScript/TSX grammar | multi-language support |
| `tantivy` | 0.22 | BM25 index | `stages/stage-3-research.md §2` |

Notable absences: **no MCP SDK** (the wire layer is hand-rolled; see §1.6), **no async runtime** (`std::io::stdin().lock()` blocking read loop), **no LSP client crate** (`lsp_client.rs` rolls its own subprocess transport).

### 1.4 LOC by module (top contributors only)

Source: `find … -name '*.rs' -exec wc -l +`. Total: **17 749 LOC** including tests; **12 150 LOC** in `src/` (excluding `benches/harness`, `tests/`, generated). Headline numbers:

| File | LOC | Role |
|---|---|---|
| `src/main.rs` | 3 489 | Wire layer + stage-1/stage-2 + dispatch |
| `src/graph_store.rs` | 1 111 | LadybugDB wrapper |
| `src/parser/rust.rs` | 1 071 | Tree-sitter Rust extractor |
| `src/search/mod.rs` | 1 028 | BM25 + RRF + symbol resolver |
| `src/resolver.rs` | 962 | Cross-file edge resolution |
| `src/parser/typescript.rs` | 944 | Tree-sitter TS/TSX extractor |
| `src/clustering.rs` | 880 | Louvain + C2 + process tracing |
| `src/lsp_client.rs` | 728 | LSP subprocess transport |
| `src/indexer.rs` | 678 | File walk + parse + persist |
| `src/semantic_diff.rs` | 673 | Stage 9 graph diff |
| `src/parser/python.rs` | 637 | Tree-sitter Python extractor |
| `src/prd_validator.rs` | 605 | Stage 6 PRD validation |
| `src/tool_schemas.rs` | 600 | JSON-Schema-as-data for `tools/list` |
| `src/git_diff.rs` | 570 | Git diff → symbol impact |
| `src/prd_input.rs` | 555 | Stage 4 bundle preparation |
| `src/security_gates.rs` | 534 | Stage 8 (S1–S5 gates) |
| `src/search/vector.rs` | 515 | Sparse TF-IDF vector |
| `src/lsp_resolver.rs` | 457 | LSP-enhanced edge resolution |

The remaining ~4 000 LOC sit in `parser/mod.rs`, `resolver_layers.rs`, `search/{bm25,rrf}.rs`, `stdlib_index/*.rs`, `macro_expansion/*.rs`, plus `lib.rs`, `rust_parser.rs` (legacy, kept for back-compat), and the now-deprecated `prd_input` helpers.

**Implication for the port:** `main.rs` is a 3 500-LOC god file. It carries the wire layer **and** stages 1–2. Splitting it during the port is high-stakes (file rewrite + git history) and explicitly **out of scope for Phase 3**. The Rust source is relocated *as-is* (see Section 2). Refactoring `main.rs` is a future ADR.

### 1.5 The 23 MCP tools — crate hosting + schema source-of-truth

All 23 tools dispatch in a single match arm at `src/main.rs::handle_tool_call` (lines 3261–3314). All 23 input schemas are pure data in `src/tool_schemas.rs::tools_list()`. The TS adapter MUST treat these two files as the dual source of truth for the contract. JSON-Schema for inputs is verbatim available in `inventory/MCP_TOOLS.md`. Output schemas are documented in the same file.

| # | Tool | Stage | Hosting module(s) | Input shape | Output shape |
|---|---|---|---|---|---|
| 1 | `health_check` | 0 | `main.rs` (no module) | `{}` | `{stage, name, status, server, version, protocol, stages_registered, tools_count}` |
| 2 | `extract_finding` | 1a | `main.rs` | `{finding: object \| string-path, output_dir, run_id?}` | `{stage:1, status, finding_id, artifact_path, run_id, bytes_written, extractor_version}` |
| 3 | `refine_finding` | 1b | `main.rs` | `{run_id, finding_id, output_dir, refined_prompt, refinement}` | `{stage:1, status, …, orchestrator_version, orchestrator_contract_version}` |
| 4 | `start_verification` | 2a | `main.rs` | `{run_id, finding_id, output_dir}` | `{stage:2, state:"open", schema_ok, …}` |
| 5 | `append_clarification` | 2b | `main.rs` | `{run_id, finding_id, output_dir, kind, content, meta?}` | `{stage:2, state, seq, turn_count}` |
| 6 | `finalize_verification` | 2c | `main.rs` | `{run_id, finding_id, output_dir}` | `{stage:2, state:"finalized", verified, verified_kind, verified_path, transcript_digest, …}` |
| 7 | `abort_verification` | 2d | `main.rs` | `{run_id, finding_id, output_dir, reason?}` | `{stage:2, state:"aborted", aborted_at, …}` |
| 8 | `index_codebase` | 3a | `indexer.rs` + `parser/*` + `graph_store.rs` | `{path, language?, output_dir}` | `{stage:3, graph_path, node_count, edge_count, files_indexed, elapsed_ms}` |
| 9 | `query_graph` | 3a | `graph_store.rs` | `{graph_path, query}` | `{columns, rows, result, elapsed_ms}` |
| 10 | `get_symbol` | 3a | `graph_store.rs` + `search/mod.rs::resolve_qualified_name` | `{graph_path, qualified_name}` | `{node, edges_out, edges_in}` or `{status:"error", reason:"symbol_not_found", did_you_mean}` |
| 11 | `resolve_graph` | 3b | `resolver.rs` + `resolver_layers.rs` | `{graph_path}` | `{imports_resolved, calls_resolved, implements_resolved, extends_resolved, uses_resolved, total_edges, total_refs, resolution_rate, unresolved_count, elapsed_ms}` |
| 12 | `cluster_graph` | 3c | `clustering.rs` | `{graph_path, resolution_param?}` | `{community_count, modularity, process_count, clusters[], total_memberships, clusters_truncated_at?, elapsed_ms}` |
| 13 | `get_processes` | 3c | `clustering.rs` | `{graph_path}` | `{process_count, processes[]}` |
| 14 | `get_impact` | 3c | `clustering.rs` | `{graph_path, qualified_name}` | `{communities, communities_affected, processes, processes_affected}` |
| 15 | `search_codebase` | 3d | `search/{mod,bm25,rrf,vector}.rs` | `{graph_path, query, limit?, label_filter?}` | `{result_count, results[], elapsed_ms}` |
| 16 | `get_context` | 3d | `search/mod.rs::get_context` | `{graph_path, qualified_name}` | `{symbol, relationships, community, processes}` or `{status:"error", reason:"symbol_not_found", did_you_mean}` |
| 17 | `analyze_codebase` | 3 (composite) | `indexer.rs` + `resolver.rs` + `clustering.rs` + `search/*` (+ optional `lsp_resolver.rs`) | `{path, language?, output_dir, resolution_param?, lsp?}` | `{graph_path, index, resolve, cluster, search_index, lsp_resolve\|null, total_elapsed_ms}` |
| 18 | `detect_changes` | 3e | `git_diff.rs` | `{graph_path, diff_text? OR codebase_path+base_ref+head_ref}` | `{files_changed, symbols_affected[], …, risk_score}` |
| 19 | `lsp_resolve` | 3b-v2 | `lsp_resolver.rs` + `lsp_client.rs` | `{graph_path, codebase_path, language?, lsp_command?, timeout_ms?}` | `{resolved_count, failed_count, skipped_count, elapsed_ms}` — **four distinct error reason codes** |
| 20 | `prepare_prd_input` | 4 | `prd_input.rs` | `{run_id, finding_id, output_dir, graph_path}` | `{artifact_path, prepared_at, matched_symbol_count, impacted_community_count, impacted_process_count, preparer_version}` |
| 21 | `validate_prd_against_graph` | 6 | `prd_validator.rs` | `{prd_path, graph_path, affected_symbols_path?, output_dir?, run_id?, finding_id?}` — **all-or-nothing artifact triple (ADR-0004)** | `{validation_status, extraction_mode, contract_missing, summary, artifact_path?, report}` |
| 22 | `check_security_gates` | 8 | `security_gates.rs` | `{graph_path, changed_symbols[], output_dir?, run_id?, finding_id?}` — **same artifact triple** | `{checked_at, gates_passed, summary, artifact_path?, report}` |
| 23 | `verify_semantic_diff` | 9 | `semantic_diff.rs` | `{before_graph_path, after_graph_path, report_path?}` | `{summary, regression_score, verdict, report, report_path?}` |

**Schema preservation invariant:** the TS adapter must round-trip the Rust outputs **byte-for-byte** in the success path. The fixture `parity-oracle/codebase/expected/index_codebase_smallrepo.json` is the canonical baseline for the Phase 3 parity test. Schema drift = parity gate failure.

### 1.6 Wire protocol (verified at `src/main.rs:1-17` and confirmed by working code in `parity-runner/src/runners/codebase.ts:74-82`)

- **Transport:** stdio (no TCP, no HTTP).
- **Framing:** **newline-delimited JSON** — one JSON object per line on stdout / stdin. NOT length-prefixed; NOT MCP-SDK-mediated.
- **Methods handled by the binary:** `initialize`, `notifications/initialized` (no-op), `tools/list`, `tools/call`.
- **Request shape:** `{ "jsonrpc": "2.0", "id": <any>, "method": "<string>", "params": <object> }`
- **Response shape (success):** `{ "jsonrpc": "2.0", "id": <id>, "result": <value> }`
- **Response shape (error):** `{ "jsonrpc": "2.0", "id": <id>, "error": { "code": <int>, "message": "<string>" } }`
- **Tool-call envelope:** `tools/call` results are wrapped: `{"content": [{"type":"text", "text":"<JSON-string of payload>"}]}`. The adapter must parse the inner `text` field to recover the structured payload. Unknown tool returns `{"isError": true, "content": [{"type":"text", "text":"Unknown tool: <name>"}]}`.
- **Error reason codes** (per-tool, inside the `text` payload): documented exhaustively in `inventory/MCP_TOOLS.md`. **Critical**: `lsp_resolve` has FOUR distinct codes (`lsp_command_not_allowed` carrying `allowed[]`, `lsp_not_found`, `lsp_probe_failed`, `lsp_resolve_failed`) that callers branch on. ADR-0003 mandates the adapter preserve these verbatim.

The unmediated text-envelope wrapping is unique to the Rust binary's MCP implementation. The adapter MUST unwrap it; callers see the inner payload.

### 1.7 Build commands and produced artifacts

The release build is verified locally — `target/release/ai-architect-mcp` already exists at the time of writing this plan, indicating the source repo compiles cleanly on the agent's host (Apple Silicon macOS).

```
# Standard release build (≈2–4 minutes cold; <30 s incremental)
cargo build --release
# Produces: target/release/ai-architect-mcp (single statically-linked binary,
# no shared-library dependencies beyond the standard system libc).
```

There is no `cargo install` step in the existing workflow; the binary is invoked directly from `target/release/`.

**Cross-compilation reality check:** the binary uses `tree-sitter`, `tantivy`, and `lbug` — all pure-Rust crates with `cc`-built native sub-deps. Linux x86_64, macOS arm64+x86_64, Windows x86_64 all work; **WASM does not** (Tantivy depends on `mmap`).

### 1.8 Open questions blocking immediate port

1. **LSP server availability in CI.** `lsp_resolve` requires `rust-analyzer` / `pyright` / `typescript-language-server` to be installed. The Phase 3 parity test for `lsp_resolve` must either (a) skip when LSP is absent, (b) install the LSP in the GitHub Actions runner, or (c) use a deliberately-failing `lsp_command_not_allowed` fixture as the parity probe. **Default recommendation: (c) — covers the error-path parity that ADR-0001 says is the load-bearing test.**
2. **Tree-sitter grammar pinning.** The Rust crate pulls `tree-sitter-rust@0.23`, `tree-sitter-python@0.23`, `tree-sitter-typescript@0.23`. These are pre-compiled to `.rlib` at `cargo build` time; the relocated workspace inherits the lockfile. **No vendoring decision needed for v0.1** — Cargo's existing `Cargo.lock` does the pinning.
3. **`lbug` (LadybugDB) crate publish status.** It is on crates.io as of Cargo's resolution at this commit (`lbug = "0.15"` resolves cleanly per the existing `Cargo.lock`). If the upstream were ever yanked, the port is at risk. **Mitigation: vendor `lbug` via `cargo vendor` only if upstream availability becomes an issue.** Not blocking v0.1.
4. **`ai-architect-mcp` binary name vs `@agentic` namespace conflict.** The Rust binary identifies itself as `serverInfo.name = "ai-architect"` in the `initialize` response. The TS adapter must NOT rename this — downstream MCP clients may match on the name. **Decision: preserve `serverInfo.name = "ai-architect"`; the TS package wrapping the adapter is the renamed surface (`@agentic/codebase`).**
5. **Search index discovery side-effect.** `src/main.rs::run_search_codebase` calls `std::env::set_var("AA_SEARCH_INDEX_DIR", …)` (Finding F-003 in inventory). This is a process-global mutation. **In a long-lived adapter subprocess this is benign (the same process keeps overwriting its own env var per call), but the adapter must not co-locate other tools that read `AA_SEARCH_INDEX_DIR`.** Document on the `CodebasePort.searchCodebase` JSDoc.

---

## Section 2 — Target layout in the agentic-ai monorepo

**Citations:** `pnpm-workspace.yaml`, `package.json` (root), `tsconfig.base.json`, `docs/ADR/0007-better-sqlite3-native-build.md`, `docs/ADR/0009-tsconfig-nodenext.md`, existing `packages/codebase/`, `packages/codebase-rust/`, `packages/mcp-servers/codebase/`.

### 2.1 Directory plan (final shape)

```
packages/
  codebase-rust/                     # NEW — Rust workspace (was empty)
    package.json                     # Workspace marker. `build` script invokes cargo.
    Cargo.toml                       # Workspace root [+ binary crate]
    Cargo.lock                       # Pinned exact version graph from upstream
    rust-toolchain.toml              # NEW — pin toolchain (1.94 stable)
    src/                             # Verbatim copy of upstream src/
      main.rs
      lib.rs
      ... (27 .rs files)
    tests/                           # Verbatim copy of upstream tests/
      stage{3b,3b_v2,3c,3d,3d_hybrid_search,4,6,8,9}_integration.rs
      scalability_bench.rs
    target/                          # gitignored — build output
    README.md                        # NEW — points to packages/codebase/ for the JS surface

  codebase/                          # EXISTING (empty) — TS port of the Rust binary
    package.json                     # @agentic/codebase
    tsconfig.json
    src/
      index.ts                       # Public API: createCodebaseAdapter(config)
      ports/
        codebase-port.ts             # CodebasePort interface (the Liskov contract)
        types.ts                     # All input/output Zod schemas + inferred types
        errors.ts                    # CodebaseValidationError, CodebaseTimeoutError, …
      adapters/
        rust-pipeline-adapter.ts     # The subprocess JSON-RPC bridge (THE deliverable)
        rust-binary-resolver.ts      # Locates the Rust binary on disk (CI vs dev vs published)
      internal/
        json-rpc-client.ts           # Newline-delimited JSON-RPC client (line-buffer reader)
        serial-queue.ts              # ADR-0002 — head-of-line FIFO
        process-supervisor.ts        # ADR-0001 — setsid + PGID + dispose
        envelope.ts                  # Unwrap MCP {"content":[{"type":"text","text":"..."}]}
    __tests__/
      adapter-precondition-passthrough.test.ts   # ADR-0003
      lsp-timeout.parity.test.ts                 # ADR-0001
      serial-queue.parity.test.ts                # ADR-0002
      validate-prd-with-artifacts.parity.test.ts # ADR-0004
      index-codebase.parity.test.ts              # core 100-file fixture (Phase 3 deliverable)
```

### 2.2 Why `packages/codebase-rust/` lives inside the pnpm workspace

The pnpm workspace is the universal build coordinator for the monorepo. It does NOT compile Rust itself; it dispatches a `build` script per package. Putting the Rust workspace inside `packages/codebase-rust/` with a thin `package.json` whose `scripts.build` is `cargo build --release --manifest-path Cargo.toml` lets the existing `pnpm -r build` orchestration call cargo without special-casing.

Pros:
- Zero changes to `pnpm-workspace.yaml` (already globs `packages/*`).
- `pnpm -F @agentic/codebase-rust build` invokes cargo directly.
- The Rust source lives next to the TS adapter that wraps it — Conway's-Law alignment.
- CI matrix already uses `pnpm install --frozen-lockfile && pnpm build` (CI workflow lines 51, 60). When the Rust package's `build` script does `cargo build --release`, CI gets it for free **after we install the Rust toolchain step.**

Cons (each with mitigation):
- pnpm tries to install Node-style dependencies into `node_modules/` — solved by giving `codebase-rust/package.json` empty `dependencies` and `devDependencies`.
- `pnpm -r --workspace-concurrency=1 build` (from root `package.json` line 12) builds packages in dependency order. Cargo's compile time (~2 min cold) becomes a critical-path step. **Mitigation:** Cargo's incremental builds + `actions/cache` keyed on `Cargo.lock` reduce this to <30 s on warm CI. Documented in §3.4.
- Including `target/` in pnpm's hashing introduces noise — solved by `.gitignore` + a per-package `pnpm` config exclusion.

### 2.3 The `package.json` for `packages/codebase-rust/`

```json
{
  "name": "@agentic/codebase-rust",
  "version": "0.1.0",
  "private": true,
  "description": "Rust workspace housing the ai-architect-mcp binary. Built via cargo; consumed via @agentic/codebase subprocess adapter.",
  "scripts": {
    "build": "cargo build --release --manifest-path Cargo.toml",
    "build:debug": "cargo build --manifest-path Cargo.toml",
    "test": "cargo test --release --manifest-path Cargo.toml",
    "clean": "cargo clean --manifest-path Cargo.toml",
    "binary-path": "node -e \"console.log(require('path').join(__dirname,'target','release','ai-architect-mcp'))\""
  },
  "files": [
    "Cargo.toml",
    "Cargo.lock",
    "rust-toolchain.toml",
    "src",
    "tests"
  ],
  "license": "MIT"
}
```

The `scripts.binary-path` helper exposes the binary location to the adapter without hardcoding paths inside TS source — keeping `coding-standards.md §7` (local reasoning) intact.

### 2.4 The `package.json` for `packages/codebase/`

```json
{
  "name": "@agentic/codebase",
  "version": "0.1.0",
  "private": true,
  "description": "TS adapter for the Rust automatised-pipeline binary. Implements CodebasePort.",
  "type": "module",
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" },
    "./ports": { "import": "./dist/ports/index.js", "types": "./dist/ports/index.d.ts" }
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc --project tsconfig.json",
    "typecheck": "tsc --noEmit --project tsconfig.json",
    "test": "vitest run",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@agentic/core": "workspace:*",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@agentic/codebase-rust": "workspace:*",
    "@types/node": "^20.0.0",
    "typescript": "^5.6.0",
    "vitest": "^4.1.0"
  },
  "license": "MIT"
}
```

`@agentic/codebase-rust` is a **devDependency**, not a dependency. The runtime dependency is the *binary* on disk, not the workspace package. The devDependency exists only so:
- `pnpm -F @agentic/codebase build` triggers `@agentic/codebase-rust build` first via topology.
- Tests in `__tests__/` can call `require.resolve("@agentic/codebase-rust/package.json")` to discover the binary path.

The `@agentic/core` runtime dependency exists because `CodebasePort` lives in `@agentic/core/ports/codebase` (see §2.6).

### 2.5 How `pnpm build` orchestrates `cargo build`

The root `package.json` already declares `build: pnpm -r --workspace-concurrency=1 build`. With `packages/codebase-rust/package.json` declaring its `build` script as `cargo build --release`, pnpm automatically:

1. Runs `cargo build --release` inside `packages/codebase-rust/`.
2. Then runs `tsc --build` inside every dependent TS package.
3. The TS adapter's `__tests__` discover the binary via `require.resolve("@agentic/codebase-rust/package.json")` → `path.join(packageDir, "target/release/ai-architect-mcp")`.

There is no separate `rscript` workspace package or build orchestrator — pnpm's existing topology gives us what we need.

### 2.6 The `CodebasePort` interface — final home

The Phase-3 deliverable says the adapter implements `CodebasePort`. The interface lives in `@agentic/core/ports/codebase`:

```
packages/core/src/
  ports/
    codebase.ts          # NEW — the CodebasePort interface
    memory.ts            # (Phase 4 follow-up; not blocking)
  index.ts               # Re-exports ports + types
```

`@agentic/core` is currently an empty placeholder per `packages/core/src/index.ts:1-24`. Phase 0 deferred it. Phase 3 may bootstrap it minimally — define `CodebasePort` only — without pulling in the full `port/core-types` design. **Hand-off note:** Phase 4's `port/core-types` merge will add the Memory and Reasoning ports next to it; Phase 3 must NOT pre-define those.

### 2.7 Sketched `CodebasePort` interface

```typescript
// packages/core/src/ports/codebase.ts
//
// source: docs/PHASE_PLAN.md §"Phase 3"
// source: inventory/MCP_TOOLS.md — 23 tools with input/output schemas
// source: docs/ADR/0001-…  — LSP timeout + PGID
// source: docs/ADR/0002-…  — serial queue
// source: docs/ADR/0003-…  — preconditions are syntactic only
// source: docs/ADR/0004-…  — ArtifactWriteSpec discriminated bundle

import { z } from "zod";

// ─── Common ────────────────────────────────────────────────────────────────
export const ArtifactWriteSpecSchema = z.object({
  runId: z.string().min(1),
  findingId: z.string().min(1),
  outputDir: z.string().min(1),
});
export type ArtifactWriteSpec = z.infer<typeof ArtifactWriteSpecSchema>;

export const LanguageSchema = z.enum(["auto", "rust", "python", "typescript"]);
export type Language = z.infer<typeof LanguageSchema>;

// ─── Inputs (one per tool — abridged here; full set in adapter source) ─────
export const HealthCheckInputSchema = z.object({}).strict();
export const IndexCodebaseInputSchema = z.object({
  path: z.string().min(1),
  language: LanguageSchema.default("auto"),
  outputDir: z.string().min(1),
}).strict();
export const QueryGraphInputSchema = z.object({
  graphPath: z.string().min(1),
  query: z.string().min(1),
}).strict();
// … 20 more, one per tool …

// ─── Outputs (validated when crossing the adapter boundary) ────────────────
export const IndexCodebaseOutputSchema = z.object({
  graphPath: z.string(),
  nodeCount: z.number().int().nonnegative(),
  edgeCount: z.number().int().nonnegative(),
  filesIndexed: z.number().int().nonnegative(),
  elapsedMs: z.number().nonnegative(),
}).strict();
// … 22 more …

// ─── Errors ────────────────────────────────────────────────────────────────
export class CodebaseValidationError extends Error {
  constructor(
    message: string,
    readonly reason: string,
    readonly raw: Record<string, unknown>,
  ) { super(message); this.name = "CodebaseValidationError"; }
}
export class CodebaseTimeoutError extends Error { /* … */ }
export class CodebaseSubprocessError extends Error { /* … */ }
export class CodebaseLspError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "lsp_command_not_allowed"
      | "lsp_not_found"
      | "lsp_probe_failed"
      | "lsp_resolve_failed",
    readonly allowed?: readonly string[],
  ) { super(message); this.name = "CodebaseLspError"; }
}

// ─── The port ──────────────────────────────────────────────────────────────
export interface CodebasePort {
  // Stage 0
  healthCheck(input: z.infer<typeof HealthCheckInputSchema>):
    Promise<HealthCheckOutput>;

  // Stage 1
  extractFinding(input: ExtractFindingInput): Promise<ExtractFindingOutput>;
  refineFinding(input: RefineFindingInput): Promise<RefineFindingOutput>;

  // Stage 2
  startVerification(input: StartVerificationInput): Promise<StartVerificationOutput>;
  appendClarification(input: AppendClarificationInput): Promise<AppendClarificationOutput>;
  finalizeVerification(input: FinalizeVerificationInput): Promise<FinalizeVerificationOutput>;
  abortVerification(input: AbortVerificationInput): Promise<AbortVerificationOutput>;

  // Stage 3 — graph intelligence (the load-bearing surface)
  indexCodebase(input: IndexCodebaseInput): Promise<IndexCodebaseOutput>;
  queryGraph(input: QueryGraphInput): Promise<QueryGraphOutput>;
  getSymbol(input: GetSymbolInput): Promise<GetSymbolOutput | NotFoundOutput>;
  resolveGraph(input: ResolveGraphInput): Promise<ResolveGraphOutput>;
  clusterGraph(input: ClusterGraphInput): Promise<ClusterGraphOutput>;
  getProcesses(input: GetProcessesInput): Promise<GetProcessesOutput>;
  getImpact(input: GetImpactInput): Promise<GetImpactOutput>;
  searchCodebase(input: SearchCodebaseInput): Promise<SearchCodebaseOutput>;
  getContext(input: GetContextInput): Promise<GetContextOutput | NotFoundOutput>;
  analyzeCodebase(input: AnalyzeCodebaseInput): Promise<AnalyzeCodebaseOutput>;
  detectChanges(input: DetectChangesInput): Promise<DetectChangesOutput>;

  // Stage 3b-v2 — LSP-augmented resolution (ADR-0001)
  lspResolve(input: LspResolveInput): Promise<LspResolveOutput>;

  // Stage 4
  preparePrdInput(input: PreparePrdInputInput): Promise<PreparePrdInputOutput>;

  // Stage 6 — ADR-0004 applies
  validatePrdAgainstGraph(input: ValidatePrdAgainstGraphInput): Promise<ValidatePrdAgainstGraphOutput>;

  // Stage 8 — ADR-0004 applies
  checkSecurityGates(input: CheckSecurityGatesInput): Promise<CheckSecurityGatesOutput>;

  // Stage 9
  verifySemanticDiff(input: VerifySemanticDiffInput): Promise<VerifySemanticDiffOutput>;

  // Lifecycle
  dispose(): Promise<void>;          // ADR-0001 — sends SIGTERM-then-SIGKILL to PGID
}
```

Notes on the sketch:
- **Method naming** uses TS conventions (`indexCodebase`, not `index_codebase`). The adapter translates camelCase ↔ snake_case at the JSON-RPC boundary.
- **ADR-0004 in code:** `ValidatePrdAgainstGraphInput` and `CheckSecurityGatesInput` accept `artifacts: ArtifactWriteSpec | undefined` — NOT three independent optional strings.
- **ADR-0003 in code:** input Zod schemas use `.min(1)` for non-empty checks but do NOT validate semantic things like path safety. Errors from the binary surface as typed `CodebaseValidationError` with `raw` preserving the full Rust response.
- **ADR-0001 in code:** `dispose()` is part of the port. Implementations MUST kill the LSP subprocess via PGID semantics. Documented in JSDoc.
- **`NotFoundOutput`** is a discriminated branch for `getSymbol` and `getContext` — they return success-with-suggestions, not exception. Matches Rust binary's `did_you_mean` output.

### 2.8 Pure-TS reimplementation vs subprocess vs deferred — the matrix

| Tool | Strategy | Rationale |
|---|---|---|
| `health_check` | Subprocess | Must round-trip Rust `serverInfo` to keep parity. |
| `extract_finding` … `abort_verification` (stage 1+2) | Subprocess | File-format-coupled (atomic writes of `stage-1.*.json`, `stage-2.session.json`); reimplementing in TS would diverge from the Rust file format. |
| `index_codebase` | Subprocess | Owns LadybugDB write; reimplementing requires a TS LadybugDB driver (does not exist). |
| `query_graph` | Subprocess | Cypher dialect is `lbug` 0.15-specific; reimplementation impractical. |
| `get_symbol`, `get_context`, `search_codebase` | Subprocess | Depend on Tantivy index format. |
| `resolve_graph`, `cluster_graph`, `get_processes`, `get_impact` | Subprocess | Louvain + C2 + BFS over LadybugDB — same coupling as above. |
| `analyze_codebase` | Subprocess | Composes the above; serial queue per ADR-0002. |
| `detect_changes` | Subprocess | Reads LadybugDB. Could in principle use a TS git-diff lib + TS resolver, but reimplementation risk dwarfs benefit. |
| `lsp_resolve` | Subprocess | LSP transport already in `lsp_client.rs`; reimplementing in TS is a Phase-7+ initiative. |
| `prepare_prd_input`, `validate_prd_against_graph`, `check_security_gates`, `verify_semantic_diff` | Subprocess | Read both LadybugDB and on-disk artifacts atomically. Subprocess preserves atomicity. |

**Verdict: 100% subprocess for v0.1.** No tool is reimplemented in pure TS. This is a deliberate Liskov contract: the port admits exactly one production adapter (Rust subprocess) plus an in-memory test double. Future migrations to pure-TS reimplementations are per-tool ADRs.

**Deferred:** none. Every tool is in v0.1.

---

## Section 3 — Decomposition decisions

**Citations:** `coding-standards.md §1, §2, §5, §7`, `docs/ADR/0001`, `docs/ADR/0002`, `docs/ADR/0003`, `packages/parity-runner/src/runners/codebase.ts`.

### 3.1 Layer assignment (Clean Architecture §2.2)

The codebase area introduces five distinct layer roles. Mapping each to the standard layer vocabulary in `coding-standards.md §2.2`:

| Component | Layer | Allowed dependencies |
|---|---|---|
| `@agentic/core/ports/codebase` (interface + Zod schemas) | **Core / Domain** | stdlib + `zod` only. No I/O, no `child_process`, no filesystem. |
| `@agentic/codebase/src/ports/` (re-exports of `@agentic/core` ports) | **Core / Domain** (vendored) | same as above |
| `@agentic/codebase/src/internal/` (json-rpc, queue, supervisor) | **Infrastructure** | stdlib + `node:child_process` + `node:stream` + `@agentic/core` (for typed errors) |
| `@agentic/codebase/src/adapters/rust-pipeline-adapter.ts` | **Infrastructure** (specifically, an *adapter* implementing `CodebasePort`) | `@agentic/core/ports/codebase` + `./internal/*` + `./ports/types` |
| `@agentic/codebase/src/index.ts` (factory `createCodebaseAdapter(config)`) | **Composition root** (small one) | All of the above |
| `@agentic/codebase-rust/` | **Infrastructure (binary artifact)** | Cargo-managed; does not participate in TS dependency graph |
| `@agentic/mcp-servers/codebase` | **Composition root / handler** (already exists as a stub) | `@agentic/codebase` + MCP SDK |

The script `scripts/check-layer-imports.ts` already enforces these rules transitively. Phase 3 adds **no new layer**, only new modules within established layers.

### 3.2 Dependency direction audit (preview)

```
@agentic/mcp-servers/codebase   ──► @agentic/codebase  ──► @agentic/core
                                             │
                                             ▼
                                    (spawns subprocess)
                                             │
                                             ▼
                                  packages/codebase-rust/
                                  target/release/ai-architect-mcp
                                  (a binary on disk; no TS import)
```

All arrows point inward (handlers → infrastructure → core). The `(spawns subprocess)` arrow is NOT a TypeScript import — it is a runtime `spawn()` call to a binary path resolved via `require.resolve("@agentic/codebase-rust/package.json")`. **No layer violation.**

The `@agentic/codebase` package's `devDependencies` listing of `@agentic/codebase-rust` is a build-time dependency only. The TS source does not `import` from `@agentic/codebase-rust` — it `spawn()`s the binary discovered via path resolution. The layer-import linter sees no edge.

### 3.3 The TS adapter's place in the layer hierarchy

`rust-pipeline-adapter.ts` is **infrastructure**, specifically the `Adapters` sub-layer in §2.3 (Ports and Adapters). It implements `CodebasePort` (declared in core), wires `internal/*` (json-rpc, queue, supervisor — all infrastructure), and is the **one and only place** the system spawns the Rust subprocess.

Per coding-standards.md §5.2, the **factory** `createCodebaseAdapter(config)` lives in `packages/codebase/src/index.ts`. It is the composition root for this subsystem. The MCP server (`packages/mcp-servers/codebase/`) is a *higher* composition root that wires this factory + the MCP transport.

### 3.4 Stdio framing — DECISION: newline-delimited JSON (matches the Rust binary)

The Rust binary at `src/main.rs:1-17` and the read loop already implemented at lines 3174–3236 (per the inventory) use:

```rust
let stdin = io::stdin();
let stdout = io::stdout();
for line in stdin.lock().lines() {
    let line = line?;
    if line.trim().is_empty() { continue; }
    let req: Request = serde_json::from_str(&line)?;
    let resp = handle_request(req);
    let mut out = stdout.lock();
    writeln!(out, "{}", serde_json::to_string(&resp)?)?;
    out.flush()?;
}
```

**Three options were considered:**

| Option | Pros | Cons |
|---|---|---|
| A. Newline-delimited JSON (NDJSON) | Matches what the Rust binary already speaks; trivial line-buffer reader; debuggable with `cat \| binary` | Cannot embed unescaped newlines (irrelevant — `serde_json::to_string` uses `\n` escapes) |
| B. JSON-RPC 2.0 over MCP-style length-prefixed framing (`Content-Length: <n>\r\n\r\n<body>`) | Matches LSP and MCP-SDK patterns | Requires changing the Rust binary's read loop; out of scope |
| C. JSON-RPC 2.0 over MCP SDK | Standard library; future-proof | Same as B; would also force the Rust binary to depend on the Rust MCP SDK (not currently a dependency) |

**Decision: Option A — NDJSON.** This matches what the Rust binary speaks today; rejecting B/C is justified because changing the Rust wire layer is a separate one-way-door change with its own ADR. The TS adapter's `internal/json-rpc-client.ts` implements a minimal NDJSON reader on top of `child.stdout` using a line buffer that handles partial reads. The reference implementation in `parity-runner/src/runners/codebase.ts:74-104` already proves this works.

**Genius gate (`dijkstra`) compliance:** the line-buffer reader must handle partial frames (chunk arrives mid-line), back-pressure (writer slower than reader), and concurrent writes (forbidden by the serial queue per §3.5). The implementation is a single private function with a max heap size of 1 line buffer, no shared state, no locks — local-reasoning OK.

### 3.5 Concurrency — DECISION: serial FIFO queue (per ADR-0002)

ADR-0002 explicitly chose Option A (serial single-process queue) for Phase 3 launch. The ADR's rationale stands:

- The Rust binary's `tools/call` dispatcher acquires a global `RwLock<GraphState>`, so concurrent JSON-RPC requests serialize at the lock anyway. Adding parallelism on the TS side gains nothing.
- Cortex memory dominates the latency budget; codebase queries tolerate seconds of queuing.
- `analyze_codebase` is checkpointed, so a long-running call can be cancelled cleanly via the dispose path.

**Implementation:** `internal/serial-queue.ts` is a 30-LOC FIFO promise-chained queue. New calls append a `next.then(() => doRpcCall(...))` to the chain. The queue's `depth` and `wait_ms` per ADR-0002's telemetry requirement are exposed via `adapter.metrics()`.

The genius gate (`lamport`) compliance: there is no global "now" assumption between TS host and Rust child. The queue uses a monotonic sequence number for JSON-RPC `id`; each request's `id` is a strict-monotonic local integer. The Rust child echoes `id` back; the TS host correlates the response by matching `id` against the head of the queue. **No clock dependency.**

### 3.6 Subprocess lifecycle (per ADR-0001)

`internal/process-supervisor.ts` owns the Rust subprocess lifetime. Pseudocode:

```
class ProcessSupervisor {
  spawn(): { spawns binary with detached:true (POSIX) or { detached: true } (Windows shim) }
  send(line: string): { writes line to child.stdin }
  onLine(handler): { binds line-by-line listener to child.stdout }
  dispose(): {
    process.kill(-this.pgid, 'SIGTERM');
    setTimeout(() => process.kill(-this.pgid, 'SIGKILL'), 5_000);
    await child.exited;
  }
}
```

The PGID approach (`-this.pgid`) is the load-bearing piece of ADR-0001. On macOS and Linux this propagates SIGTERM to the LSP grandchild even when the Rust binary fails to forward it. **Windows behaves differently** — see §4.1.

### 3.7 SOLID compliance audit (preview)

| Principle | Compliance | Notes |
|---|---|---|
| **SRP** | Pass | `json-rpc-client.ts` parses framing; `serial-queue.ts` orders calls; `process-supervisor.ts` owns lifetime; `rust-pipeline-adapter.ts` orchestrates. Each has one reason to change. |
| **OCP** | Pass | Adding a new tool requires (a) extend the Zod schema set, (b) add one method to the adapter that calls `client.call("<tool_name>", input)`. Adapter base class doesn't change. |
| **LSP** | Pass (per ADR-0003) | Preconditions are syntactic only. An in-memory test double can satisfy `CodebasePort` without strengthening preconditions. |
| **ISP** | Pass | `CodebasePort` is wide (23 methods) but cohesive: every method is a graph-intelligence operation. Splitting (e.g. `GraphPort` + `PrdPort`) would fracture cohesion. **Documented decision: keep wide.** Re-examine in Phase 7. |
| **DIP** | Pass | The adapter depends on the `CodebasePort` abstraction. The MCP-server composition root injects the adapter. No reverse coupling. |

### 3.8 Coupling & cohesion measurement (Move 1)

Since `packages/codebase` and `packages/codebase-rust` are empty, formal Ca/Ce numbers are zero. The **proposed** module shape has the following internal coupling:

- `rust-pipeline-adapter.ts` → `internal/json-rpc-client.ts`, `internal/serial-queue.ts`, `internal/process-supervisor.ts`, `internal/envelope.ts` (Ce=4)
- `internal/*` → no other internals; only stdlib + `@agentic/core` types (Ce=1 each)
- `index.ts` (factory) → adapters/* + ports/* (Ce=2)

No internal cycles. Communication is one-way: factory → adapter → internal client → process. This is the canonical hexagonal-architecture shape.

**Cohesion check (Move 1.4):** each `internal/*` file owns exactly one concern. `json-rpc-client` is wire framing; `serial-queue` is ordering; `process-supervisor` is lifecycle; `envelope` is MCP `{content:[…]}` unwrap. All names are 2–3 words. **No utility grab-bag** (`utils.ts` would be a refusal trigger).

---

## Section 4 — Risks and mitigations

**Citations:** ADR-0001, ADR-0002, ADR-0007, `.github/workflows/ci.yml`, `coding-standards.md §10` (stakes-calibrated).

### 4.1 Cross-platform Rust build

**Status:** CI matrix today is Linux-only (`runs-on: ubuntu-latest` per ci.yml line 16). The Rust toolchain works on macOS and Windows but isn't exercised in CI.

**Phase 3 default:** **accept Linux-only CI for v0.1.** Mac developers get the binary via local `cargo build` (which already works — `target/release/ai-architect-mcp` exists on the agent's host). Windows is out of scope until a downstream user requests it.

**Justification:** the Rust binary is read-only intelligence. A macOS dev cannot ship a corrupted graph by skipping CI; the worst case is "the binary fails to spawn" which surfaces immediately at adapter init.

**Mitigation if a Mac/Windows user reports breakage:**
- Add a CI matrix axis for `os: [ubuntu-latest, macos-latest]`. Cargo + tree-sitter + tantivy + lbug all support both. Estimate: +5 minutes of CI time per push (acceptable).
- Windows is a Phase-7+ ADR (`setsid` doesn't exist on Windows; ADR-0001 already flagged "equivalent on Windows" without specifying — needs a native-job-object impl).

**Open question for the user:** "Add macOS to the CI matrix in Phase 3, or defer to Phase 6?" Default: **defer**. Cost is one ADR-revision later. (Listed in §7.)

### 4.2 Long-running subprocess: backpressure, timeout, deadlock

**Backpressure** — Node's `child.stdin.write()` returns `false` when the kernel buffer is full. The serial queue (§3.5) means we issue exactly one request at a time, so backpressure cannot accumulate on stdin (there's never more than one in-flight write).

**Timeout** — Per ADR-0001, every method has its own outer timeout. `lspResolve` is 32 s (LSP_TIMEOUT_MS=30_000 + 2_000ms overhead). `analyzeCodebase` is 5 minutes (5 000 files × ~36 ms/file p99 from upstream benchmarks). Other Stage-3 tools default to 60 s. All timeouts surface as typed `CodebaseTimeoutError`.

**Deadlock**:
- *TS host writes, Rust child never reads* — impossible because the Rust binary's read loop is unconditionally line-buffered (`stdin.lock().lines()` runs on every iteration).
- *TS host reads, Rust child never writes* — bounded by the per-method outer timeout.
- *Cross-process deadlock via shared resource* — none exist; the adapter has no shared state with the Rust child beyond stdio.

The genius gate (`dijkstra`) audit: each concurrent code path is traceable to a fixed sequence of read/write operations under a single mutex (the queue). No two paths can hold-and-wait on each other. **Provably deadlock-free under the assumption that the Rust binary continues to read stdin.**

### 4.3 Schema drift: Rust serde_json output vs TS Zod input — who owns the contract?

**Contract owner: Rust** (per ADR-0003).

The flow is:
1. Adapter Zod-validates inputs at the JS boundary (`CodebasePort` type-checks).
2. Adapter serialises the camelCase TS types to snake_case JSON-RPC params.
3. Rust binary owns semantic validation; errors come back as typed `{status:"error", reason, message, …}` payloads.
4. Adapter parses Rust output, validates with output Zod schemas, and returns the typed result.

**If Rust output drifts from TS expectation**:
- Output Zod parsing fails → `CodebaseSubprocessError` with the raw output preserved.
- The parity test at `packages/codebase/__tests__/index-codebase.parity.test.ts` (the 100-file fixture from the deliverable) will fail loudly: TS's parsed shape will not match the captured `parity-oracle/codebase/expected/*.json`.
- This is by design — schema drift detection IS the parity gate.

**Mitigation against silent drift:**
- Output Zod schemas are `.strict()` (reject unknown keys). If the Rust binary adds a new field, TS rejects until the schema is updated. **Forces visibility** rather than silent acceptance.
- The 23 tools each have a parity fixture in `parity-oracle/codebase/expected/`. Currently 5 are captured; the Phase 3 implementation adds the other 18 plus the 100-file `index_codebase` deliverable.

### 4.4 Phase 7 / Group H f2b9f99 — does Rust need a corresponding update?

**Verdict (verified): NO.**

Phase 7 Group H commit `f2b9f99` (per the deliverable description) introduces:
- `Import as symbol label` — a *Cortex-side* representation choice.
- `Cartesian edge enum` — a *Cortex-side* edge categorisation.

The Rust binary's node labels (`NODE_DIRECTORY`, `NODE_FILE`, `NODE_MODULE`, `NODE_FUNCTION`, `NODE_METHOD`, `NODE_STRUCT`, `NODE_ENUM`, `NODE_VARIANT`, `NODE_TRAIT`, `NODE_FIELD`, `NODE_CONSTANT`, `NODE_TYPE_ALIAS`, `NODE_IMPORT`, `NODE_CALL_SITE`, `NODE_COMMUNITY`, `NODE_PROCESS`, `NODE_STDLIB_SYMBOL` — per `inventory/RUST_INVENTORY.md` lines 105–108) ALREADY include `NODE_IMPORT`. Cortex's "Import as symbol label" change is consuming the Rust binary's existing emission, not requesting a new one.

Edge kinds (`EDGE_CONTAINS`, `EDGE_DEFINES`, `EDGE_HAS_METHOD`, `EDGE_HAS_FIELD`, `EDGE_HAS_VARIANT` per inventory line 110-111) are also stable. The "Cartesian edge enum" reorganisation is a Cortex consumer change, not an emitter change.

**Action: no Rust changes required for Phase 7 Group H.** This is documented for traceability but does not block Phase 3.

### 4.5 Stakes classification (per coding-standards.md §10)

This whole effort is **HIGH STAKES**:

- Adds new subprocess deployable (Rust binary lifecycle).
- Adds new bounded context (`@agentic/codebase` + `@agentic/codebase-rust`).
- Touches 4 ADRs (0001–0004) — all already accepted but freshly applied here.
- Affects future MCP server composition (`packages/mcp-servers/codebase`).
- Crosses a process / trust boundary (Rust subprocess writes to disk).

**Discipline level: full Moves 1–8 + Move 7 self-verify.** This plan is the Move-1 + Move-2 + Move-4 + Move-5 + Move-6 deliverable. The implementation worktrees in §5 must produce the Move-3 dependency audit and Move-7 self-verify before merging to main.

---

## Section 5 — Worktree roster

**Citations:** `docs/PHASE_PLAN.md` §"Phase 4" (worktree precedent), `scripts/spawn-worktree.sh`.

### 5.1 Recommended split: TWO worktrees

The Phase 3 work has two distinguishable concerns:

1. **Relocate Rust source + wire CI** — `port/codebase-rust`. Pure copy-and-pnpm-glue; no TS code; touches `.github/workflows/ci.yml` and `pnpm-workspace.yaml` (no change to globs but a verification pass).
2. **Build the TS adapter + parity test** — `port/codebase-ts-adapter`. All TS source in `packages/codebase/`, depends on `@agentic/codebase-rust` being present.

### 5.2 Why two worktrees, not one

Three reasons:
- **Different reviewer audience.** `port/codebase-rust` requires a Cargo-fluent reviewer. `port/codebase-ts-adapter` requires a TS+stdio-fluent reviewer. Splitting halves the review surface per PR.
- **Different blast radius (Move 4).** Worktree #1 touches CI YAML and adds ~12 000 LOC of Rust source. Its parity gate is "binary builds + binary's own integration tests pass." Worktree #2 touches the codebase package and adds ~1 500 LOC of TS. Its parity gate is "100-file fixture parity test passes." Distinct verification.
- **Different reversibility class (Move 6).** Worktree #1 is Type-1 (relocating the Rust source is hard to reverse — git history of the Rust commits gets fused into agentic-ai's history). Worktree #2 is Type-2 (TS code is easy to revert; the adapter is one folder).

### 5.3 Dependency between them

**Worktree #1 must merge first.** Worktree #2's `package.json` declares `@agentic/codebase-rust` as a workspace devDependency; pnpm install will fail until #1 is on main.

**Practical order:**
1. Spawn `port/codebase-rust`.
2. Land it (Rust workspace exists, CI green, binary builds in CI).
3. Spawn `port/codebase-ts-adapter` from updated main.
4. Land it (TS adapter exists, all 23 methods stubbed-then-implemented, parity test green).

**Parallelism note:** the two worktrees CANNOT run in parallel because of the workspace dependency — pnpm's `--frozen-lockfile` install will fail in #2 if `@agentic/codebase-rust` isn't yet a real workspace member. Compare with Phase 4's 13 cortex-* worktrees, which were independent because each ported a distinct subset of Cortex Python source with no cross-worktree imports.

### 5.4 Scope per worktree

#### `port/codebase-rust` (1.5 days)

- [ ] Copy `Cargo.toml`, `Cargo.lock`, `src/`, `tests/` from `/Users/cdeust/Developments/anthropic/ai-automatised-pipeline/` to `packages/codebase-rust/`.
- [ ] Drop `benches/harness/` (out of scope; reduces dependencies).
- [ ] Edit `Cargo.toml` to remove the `members = [".", "benches/harness"]` workspace section — make the package a single-crate Cargo workspace OR keep the workspace declaration without harness.
- [ ] Add `rust-toolchain.toml` pinning to `1.94.0` (per upstream README badge).
- [ ] Create `packages/codebase-rust/package.json` with `build: cargo build --release`.
- [ ] Create `packages/codebase-rust/README.md` pointing at `@agentic/codebase`.
- [ ] Update `.github/workflows/ci.yml` to add a "Setup Rust" step (`actions-rust-lang/setup-rust-toolchain@v1`, with `rustflags: ""` and `Cargo.lock` cache key) BEFORE the `pnpm build` step.
- [ ] Update `.gitignore` to ignore `packages/codebase-rust/target/`.
- [ ] Verify `pnpm install --frozen-lockfile && pnpm -F @agentic/codebase-rust build` succeeds locally on Linux + macOS (test by running locally; the CI run validates Linux).
- [ ] Verify `pnpm -F @agentic/codebase-rust test` (i.e. `cargo test --release`) passes.

**Hand-off artifact:** the binary at `packages/codebase-rust/target/release/ai-architect-mcp` is reachable from any TS package via `require.resolve("@agentic/codebase-rust/package.json")` + `path.join(...)`.

**Risks specific to #1:**
- `tantivy` downloads `cc`-built C dependencies on first build → CI cache key must include the host OS.
- `lbug` 0.15 is a small crate; if upstream were yanked between research and merge, fall back to `cargo vendor`.

#### `port/codebase-ts-adapter` (1.5 days)

- [ ] Bootstrap `@agentic/core/ports/codebase.ts` with the Zod schemas + `CodebasePort` interface + typed errors (per §2.7).
- [ ] Author `packages/codebase/src/internal/json-rpc-client.ts` (NDJSON line buffer + `call(method, params)` returns `Promise<unknown>`).
- [ ] Author `packages/codebase/src/internal/serial-queue.ts` (FIFO promise chain + telemetry).
- [ ] Author `packages/codebase/src/internal/process-supervisor.ts` (`spawn` with `detached: true`, `dispose()` with PGID SIGTERM-then-SIGKILL).
- [ ] Author `packages/codebase/src/internal/envelope.ts` (parse `{content:[{type:"text", text:"<json>"}]}`).
- [ ] Author `packages/codebase/src/adapters/rust-pipeline-adapter.ts` — 23 methods, each calling `this.client.call("<tool_name>", camelToSnake(input))` and `outputSchema.parse(unwrapEnvelope(response))`.
- [ ] Author `packages/codebase/src/adapters/rust-binary-resolver.ts` (resolves the binary via `require.resolve("@agentic/codebase-rust/package.json")`).
- [ ] Author `packages/codebase/src/index.ts` factory `createCodebaseAdapter(config)`.
- [ ] Capture parity baselines for the remaining 18 tools (extend `parity-oracle/codebase/`).
- [ ] Author the 100-file fixture parity test (`packages/codebase/__tests__/index-codebase.parity.test.ts`):
  - Pick a deterministic 100-file fixture (suggestion: `parity-oracle/codebase/fixture-repos/small-rust/` with synthetic source — plays into existing `inputs/index_codebase_smallrepo.json`).
  - Run `analyze_codebase` via the TS adapter.
  - Assert `node_count`, `edge_count`, output schema match the captured `expected/index_codebase_smallrepo.json` byte-for-byte (modulo `_capture_status`/`_schema_shape` masking sentinels).
- [ ] Author parity tests for ADR-0001 (lsp-timeout), ADR-0002 (serial-queue), ADR-0003 (precondition-passthrough), ADR-0004 (validate-prd-with-artifacts).
- [ ] Update `packages/parity-runner/src/runners/codebase.ts` to dispatch through `@agentic/codebase` instead of returning the stub.
- [ ] Update `packages/mcp-servers/codebase/src/index.ts` to wire the real adapter (replace the `PORT_STATUS = "pending"` stub).

**Hand-off artifact:** `pnpm parity` runs the codebase fixtures with both Rust binary and TS adapter; divergence count is 0.

**Risks specific to #2:**
- 23 tools × ~50 LOC adapter method = ~1 100 LOC of mechanical code. Real risk: schema drift between TS Zod and Rust serde. Mitigation: generate the Zod schemas from `tool_schemas.rs` mechanically OR copy-paste with a strict review checklist (one tool per commit).
- LSP test fixture must be deterministic. Use `lsp_command: "/bin/false"` to force `lsp_command_not_allowed` (verifies error-path parity without needing rust-analyzer in CI).

### 5.5 Worktree spawn commands

```
./scripts/spawn-worktree.sh codebase-rust
# … land #1 …
./scripts/spawn-worktree.sh codebase-ts-adapter
# … land #2 …
```

---

## Section 6 — Acceptance criteria per Phase 3 deliverable

Each Phase-3 checkbox in `docs/PHASE_PLAN.md` gets a concrete falsifiable test.

### 6.1 `packages/codebase-rust/` — relocate Rust source under cargo workspace

**Falsification conditions** (any one fails the deliverable):
- `cargo build --release --manifest-path packages/codebase-rust/Cargo.toml` exits non-zero.
- `cargo test --release --manifest-path packages/codebase-rust/Cargo.toml` exits non-zero (must pass all 220 tests claimed by upstream README).
- `packages/codebase-rust/target/release/ai-architect-mcp --help` (or equivalent) does not produce a usable binary.
- `git log --follow packages/codebase-rust/src/main.rs` shows fewer than the upstream commits (history-loss check).

**Acceptance test:**

```bash
cd /Users/cdeust/Developments/agentic-ai
pnpm install --frozen-lockfile
pnpm -F @agentic/codebase-rust build
test -x packages/codebase-rust/target/release/ai-architect-mcp || exit 1
pnpm -F @agentic/codebase-rust test
```

### 6.2 `packages/codebase/src/adapters/rust-pipeline-adapter.ts` — subprocess JSON-RPC bridge

**Falsification conditions:**
- The adapter does not implement all 23 methods declared by `CodebasePort`.
- Any adapter method bypasses the serial queue (concurrent calls produce out-of-order responses).
- `dispose()` does not kill the subprocess (a subsequent `pgrep ai-architect-mcp` finds an orphan).
- Adapter instantiation fails when the binary is at the resolved path (`createCodebaseAdapter()` throws).

**Acceptance test:**

```typescript
// __tests__/adapter-smoke.test.ts
const adapter = await createCodebaseAdapter({ binaryPath: resolveBinary() });
const r = await adapter.healthCheck({});
assert(r.server === "ai-architect");
assert(r.tools_count === 23);
await adapter.dispose();
// Sleep 100 ms, then assert no orphan process.
```

### 6.3 CI builds the Rust binary as part of the monorepo build

**Falsification conditions:**
- `.github/workflows/ci.yml` does not contain a "Setup Rust" step.
- After CI, `pnpm build` in the CI logs does not show `cargo build --release` output.
- Cold CI build takes >10 minutes (current budget is 20 minutes per ci.yml line 17 — acceptable headroom; >10 min indicates inefficient caching).

**Acceptance test:**
- Push the worktree branch to GitHub.
- Observe CI run: green, with cargo log lines visible in the "Build (sequential)" step.
- Cache hit on second push (Cargo `target/` cached by `actions/cache`).

### 6.4 Parity test: `index_codebase` on a 100-file fixture

**Falsification conditions:**
- The fixture does NOT contain exactly 100 source files (deterministic count).
- TS-adapter run and direct-Rust-binary run produce different `node_count` or `edge_count`.
- Output JSON schema differs in any field name or type.
- The test does not run as part of `pnpm parity`.

**Acceptance test:**

```typescript
// packages/codebase/__tests__/index-codebase.parity.test.ts
const fixturePath = resolveFixture("parity-oracle/codebase/fixture-repos/100-rust/");
const tsResult = await adapter.indexCodebase({ path: fixturePath, outputDir: tmpDir() });
const rustResult = await runRustDirectly({ tool: "index_codebase", input: { path: fixturePath, output_dir: tmpDir() } });
assert.strictEqual(tsResult.nodeCount, rustResult.node_count);
assert.strictEqual(tsResult.edgeCount, rustResult.edge_count);
assert.strictEqual(tsResult.filesIndexed, 100);
expect(tsResult).toMatchSchema(IndexCodebaseOutputSchema);
```

The fixture corpus is the same as `parity-oracle/codebase/fixture-repos/` (already exists per `find` output earlier) — ensure 100 source files in the chosen sub-fixture; if today's fixture is smaller, expand it as part of the worktree.

### 6.5 Genius gates

Per `docs/PHASE_PLAN.md` Phase 3 gates: `dijkstra`, `lamport`.

- **`dijkstra` — stdio framing race-free, no deadlock under concurrent calls.**
  Falsification test: spawn 10 concurrent `healthCheck()` calls; assert all 10 resolve with the same `serverInfo.version` (no interleaving), `dispose()` returns within 6 s.
- **`lamport` — no global "now" assumption between TS host and Rust child.**
  Falsification test: stub the system clock via `Date.now = () => 0`; assert `analyzeCodebase()` still produces a valid `total_elapsed_ms ≥ 0` (the Rust child computes elapsed independently; the TS host does NOT compute elapsed by subtracting send-time from receive-time).

---

## Section 7 — Open questions for the user (decision-required)

Each question lists **default**, **alternatives**, **decision deadline**, **blast radius**.

### Decisions (closed 2026-04-28)

| # | Decision | Rationale |
|---|---|---|
| 7.1 | **Add `macos-latest` to CI matrix** (override default) | Primary dev environment is macOS; Rust binaries are platform-specific; +5 min CI buys early detection of macOS-only build failures. Catches issues before they hit dev machines. |
| 7.2 | `1.94.0` exact pin via `rust-toolchain.toml` (default) | coding-standards.md §8 source-discipline + reproducible parity oracle. Stable drift can silently break CI on clippy lint changes. |
| 7.3 | crates.io fetch with `Cargo.lock` (default) | 50 MB in-repo vendor is heavy for an unproven need. Lockfile pins versions; air-gap is post-cutover concern, not Phase 3. |
| 7.4 | **Install `rust-analyzer` in CI** (override default) | Success path is the load-bearing case; testing only error paths leaves the happy path uncovered in CI. +30 s install + 150 MB cache is acceptable. Zetetic standard: "benchmark is proof". |
| 7.5 | Tools 1–17 (graph + lifecycle); defer artifact-writers (18–23) to Phase 6 (default) | PHASE_PLAN.md Phase 3 deliverable specifies `index_codebase` parity, not all 23. Phase 6 dual-run captures the rest. Avoids gold-plating. |
| 7.6 | `@agentic/codebase` (default) | Symmetric with `@agentic/memory`, `@agentic/reasoning`. The "rust" suffix on `@agentic/codebase-rust` handles disambiguation. |
| 7.7 | Archive on GitHub per `docs/CUTOVER_RUNBOOK.md` Phase 6 (default) | Consistent with Cortex / prd-spec / zetetic disposition; preserves history publicly. Local working copy left in place for reference.

### 7.1 CI matrix scope

**Question:** Should Phase 3 add `os: [ubuntu-latest, macos-latest]` to the CI matrix?

- **Default:** No — keep `ubuntu-latest` only. macOS validated locally before merge.
- **Alternative:** Add macOS — +5 min CI per push, +1 day worktree time.
- **Decision deadline:** before `port/codebase-rust` merges.
- **Blast radius if changed later:** small (CI YAML only); reversible.

### 7.2 Rust toolchain pinning

**Question:** Pin to `1.94.0` (per upstream README badge) or `stable` (always-latest)?

- **Default:** `1.94.0` exact pin via `rust-toolchain.toml`. Reproducible builds.
- **Alternative:** `stable`. Lower maintenance burden but introduces drift risk.
- **Decision deadline:** before `port/codebase-rust` first commit.
- **Blast radius if changed later:** medium (re-test the Rust pipeline against a different compiler).

### 7.3 Tree-sitter grammar vendoring

**Question:** Vendor `tree-sitter-{rust,python,typescript}` via `cargo vendor`, or rely on crates.io fetch?

- **Default:** Rely on crates.io. `Cargo.lock` pins versions; offline builds work after a single `cargo fetch`.
- **Alternative:** `cargo vendor` — adds ~50 MB of vendored sources to the repo, makes builds fully air-gappable.
- **Decision deadline:** before `port/codebase-rust` merge.
- **Blast radius if changed later:** small (one ADR + one Cargo command).

### 7.4 LSP test fixtures in CI

**Question:** Install `rust-analyzer` (~150 MB) in CI to exercise `lspResolve`'s success path, or test only the four error paths?

- **Default:** Test only error paths in CI; success-path validated locally per dev.
- **Alternative:** Install rust-analyzer in CI matrix; +30 s install + 10 MB cache.
- **Decision deadline:** during `port/codebase-ts-adapter`.
- **Blast radius if changed later:** small (CI YAML).

### 7.5 Phase-3 LOC budget for adapter tests

**Question:** Capture parity fixtures for all 23 tools in Phase 3 (target: ~3 000 LOC of expected JSON), or only the 5 already captured + the 100-file `index_codebase` deliverable?

- **Default:** Capture for tools 1–17 (graph intelligence + lifecycle); defer stage-1, stage-2, stage-4, stage-6, stage-8, stage-9 tools (the artifact-writing ones) to Phase 6's parity dual-run. **Justification:** the artifact-writing tools require richer fixture setup; Phase 3's deliverable specifies `index_codebase` parity, not all-23.
- **Alternative:** Capture all 23 — adds ~1 day to `port/codebase-ts-adapter`.
- **Decision deadline:** during `port/codebase-ts-adapter`.
- **Blast radius if changed later:** medium (parity fixtures grow over time anyway).

### 7.6 Naming: `@agentic/codebase` vs `@agentic/codebase-adapter`

**Question:** Keep `@agentic/codebase` as the TS package name, or use `@agentic/codebase-adapter` to disambiguate from `@agentic/codebase-rust`?

- **Default:** Keep `@agentic/codebase`. The "rust" suffix on `@agentic/codebase-rust` already disambiguates. `@agentic/codebase` is the canonical TS surface — symmetric with `@agentic/memory`, `@agentic/reasoning`.
- **Alternative:** Rename to `@agentic/codebase-adapter`. Touches `packages/mcp-servers/codebase/package.json` dep + parity-runner imports.
- **Decision deadline:** before `port/codebase-ts-adapter` first commit (rename later is mechanical but noisy).
- **Blast radius if changed later:** small (find-and-replace + lockfile regen).

### 7.7 Disposition of `ai-automatised-pipeline` source repo post-cutover

**Question:** Once Phase 3 completes and the Rust source lives in `packages/codebase-rust/`, what becomes of `/Users/cdeust/Developments/anthropic/ai-automatised-pipeline/`?

- **Default:** Archive on GitHub per `docs/CUTOVER_RUNBOOK.md` (Phase 6) — same treatment as Cortex / prd-spec-generator / zetetic-team-subagents. The local working copy is left in place for git history reference.
- **Alternative:** Delete the source repo immediately upon Phase 3 merge.
- **Decision deadline:** Phase 6.
- **Blast radius if changed later:** medium (re-publication of the source repo would require re-cloning and re-pushing).

---

## Appendix A — Cross-reference matrix (where each Phase-3 deliverable is verified)

| Deliverable (PHASE_PLAN.md) | Plan section | Worktree | Acceptance test |
|---|---|---|---|
| `packages/codebase-rust/` Rust workspace | §2.1, §2.3, §5.4#1 | `port/codebase-rust` | §6.1 |
| `packages/codebase/src/adapters/rust-pipeline-adapter.ts` | §2.1, §2.7, §3.3, §5.4#2 | `port/codebase-ts-adapter` | §6.2 |
| CI builds Rust as part of monorepo build | §2.5, §5.4#1 | `port/codebase-rust` | §6.3 |
| Parity test on 100-file fixture | §3.4, §5.4#2, §6.4 | `port/codebase-ts-adapter` | §6.4 |
| Genius gate `dijkstra` | §3.4, §3.5 | both | §6.5 |
| Genius gate `lamport` | §3.5 | `port/codebase-ts-adapter` | §6.5 |

---

## Appendix B — Compliance audit against `coding-standards.md`

| Rule | Compliance | Reference |
|---|---|---|
| §1.1 SRP | Pass | §3.7, §3.8 |
| §1.2 OCP | Pass | §3.7 — adding a tool is additive |
| §1.3 LSP | Pass (per ADR-0003) | §2.7, §3.7 |
| §1.4 ISP | Pass-with-note | §3.7 — wide port acknowledged |
| §1.5 DIP | Pass | §3.1 — adapter implements core port |
| §2.2 Dependency Rule | Pass | §3.1, §3.2 — all arrows inward |
| §2.3 Ports & Adapters | Pass | §3.3 |
| §3.1 Readability | Pass | §3.8 — named modules, no magic constants |
| §3.2 Reliability | Pass | §2.7 — typed errors, Zod boundaries |
| §3.3 Reusability | Pass | §3.8 — three concrete uses of `internal/*` |
| §4.1 File ≤500 LOC | Anticipated pass | adapter ≤1 100 LOC TOTAL across 8 files (§5.4#2) |
| §4.2 Function ≤50 LOC | Anticipated pass | each tool method is a 1-line forward |
| §4.3 Class ≤300 LOC | Anticipated pass | adapter is a class with 23 methods, ~30 LOC body each |
| §4.4 Parameters ≤4 | Pass | factory takes 1 config object |
| §4.5 Nesting ≤3 | Pass | NDJSON parser is the deepest, at 2 levels |
| §5.1 Reverse DI | Pass | adapter depends on `CodebasePort` only |
| §5.2 Factory in composition root | Pass | `createCodebaseAdapter` in `index.ts` |
| §5.3 No service locator / global mutable state | Pass | only `AA_SEARCH_INDEX_DIR` env var noted (§1.8.5) |
| §5.4 Constructor injection | Pass | factory injects supervisor + queue + client |
| §6 Root-cause thinking | Pass | every parity-failure mode traces to a named contract (ADR-0001..0004) |
| §7 Local reasoning | Pass | NDJSON reader, queue, supervisor each fit on one screen |
| §8 Source discipline | Pass | every constant / threshold / number cites a paper, ADR, or measurement |
| §9 Anti-patterns | Pass | no grab-bag modules, no `_helpers.ts`, every module 2–3 word name |
| §10 Stakes calibration | High stakes correctly classified | §4.5 |

---

## Appendix C — What this plan does NOT do

- It does not write production code. The adapter, the queue, the supervisor — all are shaped, not implemented.
- It does not refactor `main.rs` (3 489 LOC) into smaller crates. That is a future ADR.
- It does not establish a Windows CI matrix. Default-deferred per §4.1.
- It does not pre-design the Phase-7 cross-language graph schema unification. Verified non-blocking per §4.4.
- It does not define `MemoryPort` or `ReasoningPort`. Phase 4's `port/core-types` will.
- It does not migrate the Rust source's git history into agentic-ai. The source repo is at `/Users/cdeust/Developments/anthropic/ai-automatised-pipeline/`; Phase 6 archives it. The Rust files in `packages/codebase-rust/` are a copy with a single import commit, NOT a git-subtree-add. **Decision rationale:** a 12 000-LOC verbatim copy is simpler than a subtree merge; agentic-ai will own the canonical history going forward. Trade-off: lose individual upstream commit attributions. Mitigation: link to the GitHub-archived source repo from `packages/codebase-rust/README.md`.

---

**End of plan.** Implementation begins on the two worktrees per §5.

