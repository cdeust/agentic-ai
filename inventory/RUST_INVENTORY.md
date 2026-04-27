# Rust Source Inventory — `ai-architect-mcp`

Source root: `/Users/cdeust/Developments/anthropic/ai-automatised-pipeline/src/`
Crate: `ai-architect-mcp` v0.0.4 (Rust 2021 edition)
Binary: `ai-architect-mcp` at `src/main.rs`
Transport: hand-rolled JSON-RPC 2.0 over stdio (no MCP SDK)

---

## Binary Entry Point

### `src/main.rs`

**Purpose**: Single-file orchestrator. Owns the stdio read-loop, JSON-RPC 2.0
dispatch, all stage-1 / stage-2 pipeline logic, and delegate calls into the
module-layer for stages 3–9. Every MCP tool has one `run_<tool>` function and
one `do_<tool>` function (the latter returns `Result` for testability).

**Public constants** (wire-layer):
- `PROTOCOL_VERSION = "2024-11-05"` — MCP protocol version
- `SERVER_NAME = "ai-architect"`
- `SERVER_VERSION = env!("CARGO_PKG_VERSION")` → `"0.0.4"`

**Public constants** (stage-1):
- `EXTRACTOR_VERSION = "1.0.0"`
- `ORCHESTRATOR_CONTRACT_VERSION = "1.0.0"`
- `SAFE_ID_MAX_LEN = 128`
- File-name constants: `RUNS_DIR_NAME`, `FINDINGS_DIR_NAME`, `INDEX_FILE_NAME`,
  `EXTRACTED_FILE_NAME`, `SOURCE_FILE_NAME`, `REFINED_FILE_NAME`

**Public constants** (stage-2):
- `VERIFIER_VERSION = "1.0.0"`
- `SESSION_FILE_NAME = "stage-2.session.json"`
- `VERIFIED_FILE_NAME = "stage-2.verified.json"`
- `DIGEST_ALGORITHM = "sha256"`

**Key internal types** (wire layer):
- `Request { id, method, params }` — deserializes one JSON-RPC request
- `Finding { id, title, description, source_url, relevance_category, relevance_score, raw_data, extras }` — spec §3.2
- `ExtractedFinding` — spec §4.1 artifact
- `RefinedPrompt`, `AddedContext`, `RefinementMeta`, `RefinedArtifact` — spec §4.2
- `IndexEntry`, `Index` — spec §5.2
- `SessionState` enum — open/waiting_for_user/waiting_for_agent/finalized/aborted
- `SessionTurn`, `SessionFile` — spec §12.3
- `VerifiedArtifact` — spec §5.3

**Key functions** (wire protocol):
- `handle_request(req)` — dispatches on `req.method`; handles `initialize`, `tools/list`, `tools/call`
- `handle_tool_call(params)` — dispatches on `params["name"]`; delegates to `run_*` functions
- `send_response(id, result)` / `send_error(id, code, message)` / `write_message(msg)` — stdout write

**Key functions** (security):
- `validate_graph_path_safe(path)` — rejects non-`/graph`-ending paths and system-root prefixes
- `forbidden_cypher_keyword(query)` — whole-word blocklist for mutation Cypher keywords
- `validate_safe_id(kind, id)` — enforces `[A-Za-z0-9._-]+`, no leading `.`, no `..`, max 128 chars
- `require_absolute(path, field)` — rejects relative paths and `..` components

**Modules imported** (all declared in `mod` block at top of `main.rs`):
`clustering`, `git_diff`, `graph_store`, `indexer`, `lsp_client`, `lsp_resolver`,
`macro_expansion`, `parser`, `prd_input`, `prd_validator`, `resolver`,
`resolver_layers`, `rust_parser`, `search`, `security_gates`, `semantic_diff`,
`stdlib_index`, `tool_schemas`

**External crates used**: `serde`, `serde_json`, `sha2`

---

## Module Files

### `src/tool_schemas.rs`

**Purpose**: Pure-data module. Returns the full `tools/list` JSON-RPC response as
a `serde_json::Value`. No logic, no I/O. Extracted from `main.rs` when `tools_list()`
exceeded 200 LOC (source: NOTES.md growth rule).

**Public functions**:
- `tools_list() -> Value` — returns the complete `{"tools": [...]}` payload for `tools/list`

**Private schema functions** (one per tool, each returns a `Value`):
`health_check_schema`, `extract_finding_schema`, `refine_finding_schema`,
`refined_prompt_schema`, `refinement_schema`, `start_verification_schema`,
`append_clarification_schema`, `finalize_verification_schema`, `abort_verification_schema`,
`index_codebase_schema`, `query_graph_schema`, `get_symbol_schema`, `resolve_graph_schema`,
`cluster_graph_schema`, `get_processes_schema`, `get_impact_schema`, `search_codebase_schema`,
`get_context_schema`, `analyze_codebase_schema`, `lsp_resolve_schema`,
`prepare_prd_input_schema`, `validate_prd_against_graph_schema`, `check_security_gates_schema`,
`verify_semantic_diff_schema`, `detect_changes_schema`

**External crates**: `serde_json`

---

### `src/graph_store.rs`

**Purpose**: LadybugDB (`lbug`) wrapper. Hides the `lbug::Database` / `lbug::Connection`
behind `GraphStore`. The rest of the codebase depends only on `GraphStore` methods.

**Public types**:
- `GraphStore` — wraps a LadybugDB connection; exposes `open_or_create`, `execute_query`

**Public functions**:
- `cypher_str(raw: &str) -> String` — security-critical: escapes backslashes then single-quotes,
  wraps in single quotes. ALL user-controlled values heading into Cypher must go through this.

**Public node-label constants**: `NODE_DIRECTORY`, `NODE_FILE`, `NODE_MODULE`, `NODE_FUNCTION`,
`NODE_METHOD`, `NODE_STRUCT`, `NODE_ENUM`, `NODE_VARIANT`, `NODE_TRAIT`, `NODE_FIELD`,
`NODE_CONSTANT`, `NODE_TYPE_ALIAS`, `NODE_IMPORT`, `NODE_CALL_SITE`, `NODE_COMMUNITY`,
`NODE_PROCESS`, `NODE_STDLIB_SYMBOL`

**Public edge-kind constants**: `EDGE_CONTAINS`, `EDGE_DEFINES`, `EDGE_HAS_METHOD`,
`EDGE_HAS_FIELD`, `EDGE_HAS_VARIANT`

**External crates**: `lbug` v0.15

---

### `src/indexer.rs`

**Purpose**: Walk + Parse + Persist pipeline. Wires `graph_store` and `parser` to index
a full directory of source files.

**Public types**:
- `IndexResult { graph_path, node_count, edge_count, files_indexed, elapsed_ms }`

**Public functions**:
- `index_codebase_with_language(codebase_path, graph_path, lang_filter: Option<Language>) -> Result<IndexResult, String>`

**Resource limits** (all sourced from security hardening):
- `MAX_FILES = 100_000`, `MAX_FILE_BYTES = 10_485_760` (10 MB), `MAX_TOTAL_BYTES = 2_147_483_648` (2 GB),
  `MAX_DEPTH = 64`, `MAX_PARSE_BYTES = 1_048_576` (1 MB)

**External crates**: `tree-sitter`, `tree-sitter-rust`, `tree-sitter-python`, `tree-sitter-typescript`
(via `parser` module)

---

### `src/parser/mod.rs`, `src/parser/rust.rs`, `src/parser/python.rs`, `src/parser/typescript.rs`

**Purpose**: Per-language tree-sitter parsers. Extract typed symbols (functions, structs,
enums, traits, methods, fields, imports, call sites, etc.) from source files.

**Public types**:
- `Language` enum — `Rust`, `Python`, `TypeScript`
- `ParsedFile { nodes: Vec<SymbolNode>, edges: Vec<SymbolEdge> }`
- `SymbolNode { id, label, qualified_name, name, file_path, start_line, end_line, visibility, ... }`

**Public functions**:
- `Language::from_str_opt(s: &str) -> Option<Language>`
- `parse_file(path, language) -> Result<ParsedFile, String>`

**External crates**: `tree-sitter`, `tree-sitter-rust`, `tree-sitter-python`, `tree-sitter-typescript`

---

### `src/resolver.rs`

**Purpose**: Static cross-file edge resolution. Runs after `indexer`. Adds Imports,
Calls, Implements, Extends, and Uses edges by matching string references to concrete target nodes.

**Public types**:
- `ResolveResult { imports_resolved, calls_resolved, impls_resolved, extends_resolved, uses_resolved, total_edges, total_refs, unresolved: Vec<String>, elapsed_ms }`

**Public functions**:
- `resolve_graph(store: &GraphStore) -> Result<ResolveResult, String>`

---

### `src/resolver_layers.rs`

**Purpose**: Layer-by-layer resolution helpers called by `resolver.rs`. Implements
the five resolution passes (imports, calls, implements, extends, uses) as separate functions.

**External crates**: None beyond `lbug` (via `graph_store`)

---

### `src/clustering.rs`

**Purpose**: Community detection (Louvain + C2 repair) and process tracing (BFS
from entry points along Calls edges).

**Source citations**:
- Blondel et al. 2008, J Stat Mech P10008 — Louvain
- Traag et al. 2019, Scientific Reports 9(1) 5233 §3.2 — C2 repair

**Public types**:
- `ClusteringResult { communities, modularity, processes, elapsed_ms }`
- `ClusterMembership { qualified_name, community_id, cluster_id }`
- `ClusterMemberships { entries, truncated_at: Option<usize>, total }`
- `ProcessInfo { name, entry_point, entry_kind, depth, node_count }`
- `ImpactResult { communities: Vec<_>, processes: Vec<_> }`

**Public functions**:
- `cluster_graph(store: &GraphStore, gamma: f64) -> Result<ClusteringResult, String>`
- `collect_cluster_memberships(store: &GraphStore) -> Result<ClusterMemberships, String>`
- `get_processes(store: &GraphStore) -> Result<Vec<ProcessInfo>, String>`
- `get_impact(store: &GraphStore, qualified_name: &str) -> Result<ImpactResult, String>`

---

### `src/search/mod.rs`, `bm25.rs`, `rrf.rs`, `vector.rs`

**Purpose**: Hybrid search over the code graph. BM25 full-text search (Tantivy) +
TF-IDF vector search + Reciprocal Rank Fusion. Includes `build_search_index`,
`search_graph`, `get_context`, `resolve_qualified_name`.

**Source citations**: stages/stage-3-research.md §2 (Tantivy for BM25)

**Public types**:
- `SearchOptions { limit, label_filter: Option<String>, min_score }`
- `SearchResult { qualified_name, name, label, file_path, score, community_id, process_names, start_line, end_line }`
- `SymbolContext { qualified_name, name, label, file_path, start_line, end_line, visibility, imports, imported_by, calls, called_by, implements, implemented_by, uses, used_by, community, processes }`
- `RelatedSymbol { name, qualified_name, label }`
- `NotFound { input, did_you_mean }`
- `GetContextError::NotFound(NotFound)` / `GetContextError::Other(String)`
- `SearchIndexResult { bm25_doc_count, vector_doc_count, elapsed_ms }`

**Public functions**:
- `build_search_index(store: &GraphStore, output_dir: &Path) -> Result<SearchIndexResult, String>`
- `search_graph(store: &GraphStore, query: &str, options: &SearchOptions) -> Result<Vec<SearchResult>, String>`
- `get_context(store: &GraphStore, qualified_name: &str) -> Result<SymbolContext, GetContextError>`
- `resolve_qualified_name(store: &GraphStore, qn: &str) -> Result<String, NotFound>` — three-layer lookup: exact → strip-path → fuzzy

**External crates**: `tantivy` v0.22

---

### `src/lsp_client.rs`

**Purpose**: LSP subprocess client. Manages spawning, stdin/stdout communication
with a Language Server Protocol server.

**Public constants**:
- `LSP_COMMAND_ALLOWLIST: &[&str]` — allowlisted LSP server commands

**External crates**: stdlib only (`std::process`, `std::io`)

---

### `src/lsp_resolver.rs`

**Purpose**: LSP-enhanced edge resolution. Queries the language server to resolve
method calls on inferred types that the static resolver cannot handle. Called after
`resolve_graph`.

**Public types**:
- `LspResolveResult { resolved_count, failed_count, skipped_count, elapsed_ms }`

**Public functions**:
- `resolve_with_lsp(store: &GraphStore, codebase_path: &Path, language: &str, lsp_command: Option<&str>, timeout: Duration) -> Result<LspResolveResult, String>`

---

### `src/prd_input.rs`

**Purpose**: Stage 4 bundle builder. Reads `stage-2.verified.json` + `stage-1.refined.json`,
tokenizes the finding description, searches the graph for matched symbols, collects
1-hop context, writes `stage-4.prd_input.json`.

**Public constants**:
- `PREPARER_VERSION: &str`

**Public types**:
- `PrdInputArgs { run_id, finding_id, output_dir, graph_path }`
- `PrdInputOutcome { artifact_path, matched_symbol_count, impacted_community_count, impacted_process_count }`

**Public functions**:
- `prepare(args: &PrdInputArgs, prepared_at: String) -> Result<PrdInputOutcome, String>`

---

### `src/prd_validator.rs`

**Purpose**: Stage 6 PRD validator. Three axes: symbol hallucination, community
consistency, process-impact contradiction. Contract-first on `stage-5.affected_symbols.json`
with regex fallback.

**Public constants**:
- `VALIDATION_FILE: &str = "stage-6.validation.json"`

**Public types**:
- `ValidationReport { validation_status, extraction_mode, contract_missing, summary: ValidationSummary, ... }`
- `ValidationSummary { claimed_symbols, resolved_symbols, hallucinated_symbols, communities_spanned, processes_impacted }`

**Public functions**:
- `validate_prd(store: &GraphStore, prd_path: &Path, affected_symbols_path: Option<&Path>) -> Result<ValidationReport, String>`
- `report_to_json(report, run_id, finding_id, prd_path, graph_path, validated_at) -> Value`
- `write_validation(dest: &Path, value: &Value) -> Result<PathBuf, String>`

---

### `src/security_gates.rs`

**Purpose**: Stage 8 security gate checks. Five checks: S1 auth-critical community
touch (critical), S2 unsafe-symbol touch (info), S3 public-API surface change (warning),
S4 unresolved-import introduction (warning/critical), S5 test-coverage structural gap (warning).

**Public constants**:
- `SECURITY_FILE: &str = "stage-8.security.json"`

**Public types**:
- `SecurityReport { gates_passed, summary: SecuritySummary, ... }`
- `SecuritySummary { changed_symbols, critical_count, warning_count, info_count }`

**Public functions**:
- `check_gates(store: &GraphStore, changed_symbols: &[String]) -> Result<SecurityReport, String>`
- `report_to_json(report, run_id, finding_id, graph_path, changed_symbols, checked_at) -> Value`
- `write_security(dest: &Path, value: &Value) -> Result<PathBuf, String>`

---

### `src/semantic_diff.rs`

**Purpose**: Stage 9 before/after graph comparison. Flags: nodes added/removed, edges
added/removed, dangling references, new unresolved imports, new strongly-connected cycles.
Returns a heuristic `regression_score` (cap 10.0).

**Public types**:
- `SemanticDiffArgs { before_graph_path, after_graph_path }`
- `SemanticDiffOutcome { summary: DiffSummary, regression_score, verdict, report: Value }`
- `DiffSummary { nodes_added, nodes_removed, edges_added, edges_removed, dangling_references, new_unresolved_delta, new_cycles }`

**Public functions**:
- `diff(args: &SemanticDiffArgs, verified_at: String) -> Result<SemanticDiffOutcome, String>`
- `write_report(path: &Path, report: &Value) -> Result<(), String>`

---

### `src/git_diff.rs`

**Purpose**: Git diff → symbol impact mapper. Accepts either raw unified diff text
or `base_ref`/`head_ref` to run `git diff` internally.

**Public types**:
- `DiffAnalysis { files_changed, symbols_affected: Vec<AffectedSymbol>, communities_affected: Vec<_>, processes_affected: Vec<_>, risk_score: f64 }`
- `AffectedSymbol { qualified_name, change_type, community, processes }`

**Public functions**:
- `analyze_diff(store: &GraphStore, diff_text: &str) -> Result<DiffAnalysis, String>`
- `analyze_git_diff(store: &GraphStore, repo_path: &Path, base_ref: &str, head_ref: &str) -> Result<DiffAnalysis, String>`

---

### `src/macro_expansion/mod.rs`, `python.rs`, `rust.rs`, `typescript.rs`

**Purpose**: Macro / decorator expansion helpers for each language. Pre-processes
source files before tree-sitter parsing to expose symbols that would otherwise be
hidden behind macros (Rust `derive`, Python decorators, TypeScript decorators).

---

### `src/stdlib_index/mod.rs`, `python.rs`, `rust.rs`, `typescript.rs`

**Purpose**: Standard-library symbol tables. Used by `resolver_layers.rs` (stage-3b-v2
Layer 5) to distinguish calls to known stdlib symbols from unresolved references.

---

### `src/rust_parser.rs`

**Purpose**: Legacy Rust parser (predates `parser/rust.rs`). Kept for backward
compatibility during the tree-sitter migration. Not called by any active stage tool.

---

### `src/lib.rs`

**Purpose**: Library entry point for integration tests. Re-exports all modules as
`pub mod` so `tests/` can import them without going through `main.rs`.

---

## External Crate Summary

| Crate | Version | Purpose | Source |
|---|---|---|---|
| `serde` | 1 | Serialization derive macros | — |
| `serde_json` | 1 | JSON serialization / deserialization | — |
| `sha2` | 0.10 | SHA-256 for stage-2 transcript digest | stages/stage-2.md §12.4 |
| `lbug` | 0.15 | LadybugDB in-process property graph (Cypher) | stages/stage-3.md §7 |
| `tree-sitter` | 0.24 | Parser runtime | stages/stage-3.md §3a |
| `tree-sitter-rust` | 0.23 | Rust grammar | stages/stage-3.md §3a |
| `tree-sitter-python` | 0.23 | Python grammar | — |
| `tree-sitter-typescript` | 0.23 | TypeScript/TSX grammar | — |
| `tantivy` | 0.22 | BM25 full-text search engine | stages/stage-3-research.md §2 |
| `tempfile` | 3 | Test helper (dev only) | — |
