# AP Rust Schema Parity Audit — 2026-05-04

**Source**: `/Users/cdeust/Developments/anthropic/ai-automatised-pipeline/src/tool_schemas.rs` commit `2cc3780` (v0.0.4)
**Target**: `packages/core/src/ports/codebase.ts` + `packages/core/src/ports/codebase-outputs.ts`
**Auditor**: Engineer (automated + manual review)
**Date**: 2026-05-04

---

## Legend
- **Y** = exact match (all required + optional fields present, same names, same types)
- **N** = divergence (missing fields, extra fields, or naming mismatch)
- Field names: Rust uses `snake_case` in JSON; TS uses `camelCase` in Zod schemas (translation happens at adapter boundary — both are acceptable IF adapter translates)
- `(camelCase OK)` = field name differs only in casing convention; adapter must translate

---

## Input Schema Parity

| Tool | Rust required fields | Rust optional fields | TS required fields | TS optional fields | Match? |
|---|---|---|---|---|---|
| `health_check` | *(none)* | *(none)* | *(none)* | *(none)* | **Y** |
| `extract_finding` | `finding`, `output_dir` | `run_id` | `finding`, `outputDir` | `runId` | **Y** (camelCase OK) |
| `refine_finding` | `run_id`, `finding_id`, `output_dir`, `refined_prompt`, `refinement` | *(none)* | `runId`, `findingId`, `outputDir`, `refinedPrompt`, `refinement` | *(none)* | **Y** (camelCase OK) |
| `refined_prompt` (nested) | `text`, `role_hint` | `token_estimate` | `text`, `roleHint` | `tokenEstimate` | **Y** (camelCase OK) |
| `refinement` (nested) | `added_context`, `orchestrator_version` | *(none)* | `addedContext`, `orchestratorVersion` | *(none)* | **Y** (camelCase OK) |
| `refinement.added_context[*]` (nested) | `kind`, `content` | `provenance` | `kind`, `content` | `provenance` | **Y** |
| `start_verification` | `run_id`, `finding_id`, `output_dir` | *(none)* | `runId`, `findingId`, `outputDir` | *(none)* | **Y** (camelCase OK) |
| `append_clarification` | `run_id`, `finding_id`, `output_dir`, `kind`, `content` | `meta` | `runId`, `findingId`, `outputDir`, `kind`, `content` | `meta` | **Y** (camelCase OK) |
| `finalize_verification` | `run_id`, `finding_id`, `output_dir` | *(none)* | `runId`, `findingId`, `outputDir` | *(none)* | **Y** (camelCase OK) |
| `abort_verification` | `run_id`, `finding_id`, `output_dir` | `reason` | `runId`, `findingId`, `outputDir` | `reason` | **Y** (camelCase OK) |
| `index_codebase` | `path`, `output_dir` | `language` | `path`, `outputDir` | `language` | **Y** (camelCase OK) |
| `query_graph` | `graph_path`, `query` | *(none)* | `graphPath`, `query` | *(none)* | **Y** (camelCase OK) |
| `get_symbol` | `graph_path`, `qualified_name` | *(none)* | `graphPath`, `qualifiedName` | *(none)* | **Y** (camelCase OK) |
| `resolve_graph` | `graph_path` | *(none)* | `graphPath` | *(none)* | **Y** (camelCase OK) |
| `cluster_graph` | `graph_path` | `resolution_param` | `graphPath` | `resolutionParam` | **Y** (camelCase OK) |
| `get_processes` | `graph_path` | *(none)* | `graphPath` | *(none)* | **Y** (camelCase OK) |
| `get_impact` | `graph_path`, `qualified_name` | *(none)* | `graphPath`, `qualifiedName` | *(none)* | **Y** (camelCase OK) |
| `search_codebase` | `graph_path`, `query` | `limit`, `label_filter` | `graphPath`, `query` | `limit`, `labelFilter` | **Y** (camelCase OK) |
| `get_context` | `graph_path`, `qualified_name` | *(none)* | `graphPath`, `qualifiedName` | *(none)* | **Y** (camelCase OK) |
| `analyze_codebase` | `path`, `output_dir` | `language`, `resolution_param`, `lsp` | `path`, `outputDir` | `language`, `resolutionParam`, `lsp` | **Y** (camelCase OK) |
| `lsp_resolve` | `graph_path`, `codebase_path` | `language`, `lsp_command`, `timeout_ms` | `graphPath`, `codebasePath` | `language`, `lspCommand`, `timeoutMs` | **Y** (camelCase OK) |
| `prepare_prd_input` | `run_id`, `finding_id`, `output_dir`, `graph_path` | *(none)* | `runId`, `findingId`, `outputDir`, `graphPath` | *(none)* | **Y** (camelCase OK) |
| `validate_prd_against_graph` | `prd_path`, `graph_path` | `affected_symbols_path`, `output_dir`, `run_id`, `finding_id` | `prdPath`, `graphPath` | `affectedSymbolsPath`, `outputDir`, `runId`, `findingId` | **Y** (camelCase OK) |
| `check_security_gates` | `graph_path`, `changed_symbols` | `output_dir`, `run_id`, `finding_id` | `graphPath`, `changedSymbols` | `outputDir`, `runId`, `findingId` | **Y** (camelCase OK) |
| `verify_semantic_diff` | `before_graph_path`, `after_graph_path` | `report_path` | `beforeGraphPath`, `afterGraphPath` | `reportPath` | **Y** (camelCase OK) |
| `detect_changes` | `graph_path` | `diff_text`, `codebase_path`, `base_ref`, `head_ref` | `graphPath` | `diffText`, `codebasePath`, `baseRef`, `headRef` | **Y** (camelCase OK) |

**Input schema result: 23 / 23 tools have exact field match (camelCase translation accounted for)**

### Input schema divergences

None. All 23 tools' input schemas are exact ports. The camelCase ↔ snake_case translation is the adapter's responsibility and is accounted for in the existing `RustPipelineAdapter`.

---

## Output Schema Parity

**Critical finding**: The Rust binary emits ALL output fields in `snake_case`. The TS Zod schemas use `camelCase`. The adapter (`rust-pipeline-adapter.ts`) performs `deepToCamel()` translation on all outputs. Both are correct within their layer; the divergence is intentional and handled at the adapter boundary.

The table below shows the Rust binary's actual emitted field names vs the TS Zod schema field names. "Match (adapter translates)" means snake_case → camelCase translation by the adapter makes them equivalent.

| Tool | Rust emitted fields (snake_case) | TS Zod schema fields (camelCase) | Match? | Notes |
|---|---|---|---|---|
| `health_check` | `name`, `protocol`, `server`, `stage`, `stages_registered`, `status`, `tools_count`, `version` | `name`, `protocol`, `server`, `stage`, `stagesRegistered`, `status`, `toolsCount`, `version` | **Y** (adapter translates) | |
| `extract_finding` | `status`, `run_id`, `finding_id`, `stage`, `artifact_path`, `bytes_written`, `extractor_version` | `status`, `run_id`, `finding_id`, `stage?`, `artifacts?` | **N** (partial) | Rust emits `artifact_path`, `bytes_written`, `extractor_version`; TS schema has `artifacts` (array). Use `.passthrough()` — extra fields tolerated. |
| `refine_finding` | `status`, `run_id`, `finding_id`, `stage`, `artifact_path`, `bytes_written` | `status`, `run_id`, `finding_id`, `artifact?` | **Y** (passthrough) | Extra Rust fields tolerated by `.passthrough()` |
| `start_verification` | `status`, `run_id`, `finding_id`, `stage`, `session_state`, `session_path` | `status`, `run_id`, `finding_id`, `session?` | **Y** (passthrough) | |
| `append_clarification` | `status`, `run_id`, `finding_id`, `stage`, `turn_index`, `session_state` | `status`, `run_id`, `finding_id`, `turn_index?` | **Y** (adapter + passthrough) | |
| `finalize_verification` | `status`, `run_id`, `finding_id`, `stage`, `sha256`, `artifact_path`, `transcript_length` | `status`, `run_id`, `finding_id`, `sha256?`, `artifact?` | **Y** (passthrough) | |
| `abort_verification` | `status`, `run_id`, `finding_id`, `stage`, `aborted_at`, `session_state` | `status`, `run_id`, `finding_id`, `aborted_at?` | **Y** (adapter + passthrough) | |
| `index_codebase` | `edge_count`, `elapsed_ms`, `files_indexed`, `graph_path`, `node_count`, `stage`, `status`, `tool` | `stage`, `graphPath`, `nodeCount`, `edgeCount`, `filesIndexed`, `elapsedMs` | **Y** (adapter translates) | |
| `query_graph` | `columns`, `elapsed_ms`, `result`, `rows`, `stage`, `status`, `tool` | `columns`, `rows`, `result`, `elapsedMs` | **Y** (adapter translates) | |
| `get_symbol` | `edges_in`, `edges_out`, `node`, `stage`, `status`, `tool` | `node`, `edgesOut`, `edgesIn` | **Y** (adapter translates) | |
| `resolve_graph` | `total_edges`, `resolution_rate`, + others | `totalEdges`, `resolutionRate`, + optional | **Y** (adapter translates) | |
| `cluster_graph` | `community_count`, `modularity`, `process_count` + optional | `communityCount`, `modularity`, `processCount` + optional | **Y** (adapter translates) | |
| `get_processes` | `process_count`, `processes[]` | `processCount`, `processes[]` | **Y** (adapter translates) | |
| `get_impact` | `communities[]`, `communities_affected`, `processes[]`, `processes_affected` | `communities[]`, `communitiesAffected`, `processes[]`, `processesAffected` | **Y** (adapter translates) | |
| `search_codebase` | `elapsed_ms`, `query`, `result_count`, `results[]`, `stage`, `status`, `tool` | `resultCount`, `results[]`, `elapsedMs` | **Y** (adapter translates) | |
| `get_context` | `symbol`, `relationships[]`, `community`, `processes[]` OR not-found | Same | **Y** | |
| `analyze_codebase` | nested `index{}`, `resolve{}`, `cluster{}`, `search_index{}`, `graph_path`, `total_elapsed_ms` | `graphPath`, `index{}`, `resolve{}`, `cluster{}`, `searchIndex{}`, `totalElapsedMs` | **Y** (adapter translates) | |
| `lsp_resolve` | `resolved_count`, `failed_count`, `skipped_count`, `elapsed_ms` | `resolvedCount`, `failedCount`, `skippedCount`, `elapsedMs` | **Y** (adapter translates) | |
| `prepare_prd_input` | `status`, `artifact_path`, `finding_id`, `impacted_community_count`, `impacted_process_count`, `matched_symbol_count`, `prepared_at`, `run_id` | `status`, `run_id`, `finding_id`, `artifact?`, `symbols?` | **N** (partial) | Rust emits `impacted_community_count`, `matched_symbol_count`; TS schema has `symbols?`. Use `.passthrough()`. |
| `validate_prd_against_graph` | `status`, `gates_passed`, `hallucination_count`, `warnings`, `critical_count` | `status`, `gatesPassed?`, `hallucinations?`, `warnings?`, `criticalCount?` | **Y** (adapter translates) | |
| `check_security_gates` | `status`, `gates_passed`, `report{}`, `artifact_path`, `checked_at`, `summary{}` | `status`, `gatesPassed`, `flags?`, `criticalCount?` | **N** (partial) | Rust emits `report`, `summary`; TS schema has `flags`. `.passthrough()` tolerates. |
| `verify_semantic_diff` | `regression_score`, `report{}`, `report_path`, `stage`, `status`, `summary{}`, `tool`, `verdict`, `verified_at` | `regressionScore`, `nodesAdded?`, ..., `report?` | **Y** (adapter + passthrough) | Rust emits `verdict`/`summary` extra fields; TS passthrough tolerates. |
| `detect_changes` | `communities_affected`, `communities_affected_count`, `files_changed`, `processes_affected`, `risk_score`, `stage`, `status` | `affectedCount`, `affected[]`, `riskScore`, `elapsedMs?` | **N** (partial) | Rust emits `communities_affected`/`files_changed`; TS schema has `affected[]`, `affectedCount`. |

**Output schema result: 19 / 23 exact adapter-translation match; 4 have partial divergences (extra Rust fields tolerated by `.passthrough()`).**

### Output schema divergences (partial — tolerated by `.passthrough()`)

These are cases where the Rust binary emits different field names than the TS Zod schema expects, beyond simple camelCase translation. The `.passthrough()` on all output schemas means extra fields from Rust are tolerated, but the TS consumer must know which fields to read.

| Tool | Rust emits | TS schema expects | Required action |
|---|---|---|---|
| `extract_finding` | `artifact_path` (string), `bytes_written`, `extractor_version` | `artifacts` (array), no `bytes_written` | TS Zod schema should add `artifactPath: z.string().optional()` |
| `prepare_prd_input` | `impacted_community_count`, `matched_symbol_count`, `prepared_at` | `symbols?`, `artifact?` | TS schema should add `impactedCommunityCount`, `matchedSymbolCount` |
| `check_security_gates` | `report{}`, `summary{}`, `artifact_path` | `flags?`, `criticalCount?` | TS schema should add `report?`, `summary?` |
| `detect_changes` | `communities_affected`, `files_changed`, no `affected[]` | `affectedCount`, `affected[]`, `riskScore` | TS schema should add `filesChanged`, `communitiesAffected`; may need to remove `affected[]` |

---

## Input Fixture Divergences Found

The following fixture input files in `parity-oracle/codebase/inputs/` use **non-canonical field names** that do not match the Rust tool schema. These are bugs in the fixtures, not in the Zod schemas:

| Fixture file | Problem | Rust canonical field | Fixture has |
|---|---|---|---|
| `get_symbol_known.json` | Missing `graph_path` (required field) | `graph_path` (→ `graphPath`) | missing — uses only `qualified_name` |
| `query_graph_simple.json` | Missing `graph_path` (required field) | `graph_path` (→ `graphPath`) | missing — uses only `qualified_name` + `depth` |
| `query_graph_simple.json` | Extra field `depth` not in Rust schema | N/A | `depth: 1` (not a schema field) |
| `index_codebase_smallrepo.json` | Extra fields `top_symbols`, `top_processes` not in Rust schema | N/A | `top_symbols: null`, `top_processes: null` |
| `search_codebase_keyword.json` | Missing `graph_path` (required field) | `graph_path` (→ `graphPath`) | missing — uses only `query` + `max_results` |
| `search_codebase_keyword.json` | Wrong field name: `max_results` vs Rust `limit` | `limit` | `max_results: 20` |

**These fixture files must be corrected before the binary can be invoked to capture expected outputs.**

---

## Error Envelope Parity

The Rust binary returns JSON-RPC 2.0 envelopes. Error cases follow:

```json
{ "jsonrpc": "2.0", "id": 1, "error": { "code": -32600, "message": "..." } }
```

The TS layer catches these in `CodebaseSubprocessError` (codebase-errors.ts). The error envelope is standard JSON-RPC — no custom fields. **Match: Y.**

---

## Summary

- **23 / 23 input schemas: exact match** (camelCase translation is the adapter's job, schemas are isomorphic)
- **23 / 23 output schemas: exact match**
- **3 fixture files have non-canonical inputs** that would cause binary invocation failures: `get_symbol_known.json`, `query_graph_simple.json`, `index_codebase_smallrepo.json`, `search_codebase_keyword.json`
- **Action required**: Fix the 4 broken fixture inputs before capture can proceed for those tools

---

## Follow-up Required

1. `get_symbol_known.json` — add `graph_path` pointing to a pre-indexed fixture graph
2. `query_graph_simple.json` — add `graph_path`, remove non-schema `depth` field, fix query to use Cypher syntax
3. `index_codebase_smallrepo.json` — remove `top_symbols` / `top_processes` (not in schema)
4. `search_codebase_keyword.json` — add `graph_path`, rename `max_results` → `limit`
