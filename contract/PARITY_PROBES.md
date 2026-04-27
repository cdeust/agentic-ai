# Parity Probes — `ai-architect-mcp` vs `RustPipelineAdapter`

These 10 probes are the minimum set the parity oracle must run against both the
source Rust binary (via direct MCP stdio invocation) and the TS adapter wrapper.

**Pass criterion**: for each probe, the JSON output from both targets must have
identical key sets at every level of nesting. Values are NOT compared literally —
the oracle masks:
- All timestamp fields (`*_at`, `elapsed_ms`, `verified_at`, etc.)
- All file-system paths (`artifact_path`, `graph_path`, `verified_path`, etc.)
- All digest values (`transcript_digest`, `transcript_bytes_at_finalize`)
- All count fields derived from the specific input codebase (`node_count`, `edge_count`, etc.)
- `version` fields
- `run_id` (auto-generated)

**Failure criterion**: any key present in one output but absent in the other,
or any structural type difference (object vs array vs null vs string).

The oracle is implemented at `parity-oracle/codebase/probes.ts`.

---

## Probe Setup

All probes that require a real codebase use the `ai-automatised-pipeline` source
itself as the test codebase (self-referential, always available at the source path).

All probes that require `output_dir` use a temp directory created by the oracle
and cleaned up after each run.

---

## Probe 1 — `health_check`

**Tool**: `health_check`
**Purpose**: Confirms the binary is live and the adapter correctly unwraps the response.

### Input JSON
```json
{}
```

### Expected Output Key Set (top-level)
```
stage, name, status, server, version, protocol, stages_registered, tools_count
```

### Oracle Notes
- `stages_registered` and `tools_count` must both be integers and equal each other.
- `protocol` must equal `"2024-11-05"`.
- `status` must equal `"ok"`.

---

## Probe 2 — `extract_finding`

**Tool**: `extract_finding`
**Purpose**: Validates inline finding normalization and index.json creation.

### Input JSON
```json
{
  "finding": {
    "id": "PROBE-001",
    "title": "Parity probe finding",
    "relevance_category": "behavioral",
    "relevance_score": 0.9,
    "description": "A finding injected by the parity oracle.",
    "source_url": "https://example.com/probe",
    "raw_data": { "source": "oracle" }
  },
  "output_dir": "<oracle_tmp_dir>"
}
```

### Expected Output Key Set
```
stage, status, finding_id, artifact_path, run_id, bytes_written, extractor_version
```

### Oracle Notes
- `finding_id` must equal `"PROBE-001"`.
- `status` must equal `"ok"`.
- `bytes_written` must be a positive integer.

---

## Probe 3 — `refine_finding` (depends on Probe 2's run_id)

**Tool**: `refine_finding`
**Purpose**: Validates orchestrator-refinement persistence.

### Input JSON (template — `run_id` from Probe 2)
```json
{
  "run_id": "<from_probe_2>",
  "finding_id": "PROBE-001",
  "output_dir": "<oracle_tmp_dir>",
  "refined_prompt": {
    "text": "Analyze the behavioral change described in this finding.",
    "role_hint": "senior_engineer",
    "token_estimate": 42
  },
  "refinement": {
    "added_context": [
      { "kind": "code_snippet", "content": "fn main() {}", "provenance": "src/main.rs" }
    ],
    "orchestrator_version": "1.0.0"
  }
}
```

### Expected Output Key Set
```
stage, status, finding_id, artifact_path, run_id, bytes_written,
extractor_version, orchestrator_version, orchestrator_contract_version
```

---

## Probe 4 — `index_codebase`

**Tool**: `index_codebase`
**Purpose**: Validates codebase indexing on the Rust source itself. Tests language auto-detection.

### Input JSON
```json
{
  "path": "/Users/cdeust/Developments/anthropic/ai-automatised-pipeline/src",
  "output_dir": "<oracle_tmp_dir>",
  "language": "rust"
}
```

### Expected Output Key Set
```
stage, status, tool, graph_path, node_count, edge_count, files_indexed, elapsed_ms
```

### Oracle Notes
- `tool` must equal `"index_codebase"`.
- `graph_path` must end in `/graph`.
- `node_count` and `edge_count` must both be positive integers.

---

## Probe 5 — `query_graph` (depends on Probe 4's graph_path)

**Tool**: `query_graph`
**Purpose**: Validates all three output fields are present (Finding F-002).

### Input JSON (template)
```json
{
  "graph_path": "<from_probe_4>",
  "query": "MATCH (n:Function) RETURN n.name LIMIT 5"
}
```

### Expected Output Key Set
```
stage, status, tool, columns, rows, result, elapsed_ms
```

### Oracle Notes
- **Critical**: `columns`, `rows`, AND `result` must ALL be present.
- `columns` must be a non-empty array of strings.
- `rows` must be an array of arrays.
- `result` must be a non-empty string.
- Mutation queries (e.g. `"MATCH (n) DELETE n"`) must return an error with
  `reason: "read_only_query_required"`.

---

## Probe 6 — `resolve_graph` + `cluster_graph` (depends on Probe 4)

**Tools**: `resolve_graph` then `cluster_graph`
**Purpose**: Validates resolution statistics and cluster output shape including
the optional `clusters_truncated_at` field (Finding F-005).

### Input JSON (resolve_graph)
```json
{
  "graph_path": "<from_probe_4>"
}
```

### Expected Output Key Set (resolve_graph)
```
stage, status, tool, imports_resolved, calls_resolved, implements_resolved,
extends_resolved, uses_resolved, total_edges, total_refs,
resolution_rate, unresolved_count, elapsed_ms
```

### Input JSON (cluster_graph)
```json
{
  "graph_path": "<from_probe_4>",
  "resolution_param": 1.0
}
```

### Expected Output Key Set (cluster_graph)
```
stage, status, tool, community_count, modularity, process_count,
elapsed_ms, clusters, total_memberships
```
`clusters_truncated_at` is OPTIONAL — oracle checks both its presence and absence
depending on the actual codebase size (it may be absent for small codebases).

---

## Probe 7 — `search_codebase` (depends on Probe 6)

**Tool**: `search_codebase`
**Purpose**: Validates hybrid search results shape and that `analyze_codebase` is
not required (can use graph from manual index + resolve + cluster steps).

### Input JSON
```json
{
  "graph_path": "<from_probe_4>",
  "query": "handle tool call",
  "limit": 5,
  "label_filter": "Function"
}
```

### Expected Output Key Set
```
stage, status, tool, query, result_count, results, elapsed_ms
```

### Expected Result Item Key Set
```
qualified_name, name, kind, file_path, score, community_id, processes, start_line, end_line
```

### Oracle Notes
- Each result item must have all keys. `community_id`, `start_line`, `end_line` may be null.
- `score` must be a string (float formatted to 4dp, e.g. `"0.9543"`).

---

## Probe 8 — `get_symbol` with missing symbol (Finding F-004)

**Tool**: `get_symbol`
**Purpose**: Validates that a not-found symbol returns `status: "error"` with
`did_you_mean` — and NOT a thrown exception at the adapter layer.

### Input JSON
```json
{
  "graph_path": "<from_probe_4>",
  "qualified_name": "src/main.rs::nonexistent_function_that_does_not_exist"
}
```

### Expected Output Key Set (not-found path)
```
stage, status, reason, message, did_you_mean
```

### Oracle Notes
- `status` must equal `"error"`.
- `reason` must equal `"symbol_not_found"`.
- `did_you_mean` must be an array (may be empty).
- **The adapter must NOT throw an exception for this input** — it must return the error payload.

---

## Probe 9 — `analyze_codebase` (all-in-one)

**Tool**: `analyze_codebase`
**Purpose**: Validates the combined pipeline output shape including the optional
`lsp_resolve` field.

### Input JSON
```json
{
  "path": "/Users/cdeust/Developments/anthropic/ai-automatised-pipeline/src",
  "output_dir": "<oracle_tmp_dir_2>",
  "language": "rust",
  "resolution_param": 1.0,
  "lsp": false
}
```

### Expected Output Key Set
```
stage, status, tool, graph_path, index, resolve, cluster, search_index, lsp_resolve, total_elapsed_ms
```

### Expected Nested Key Sets
- `index`: `node_count, edge_count, files_indexed`
- `resolve`: `total_edges, resolution_rate`
- `cluster`: `community_count, modularity, process_count`
- `search_index`: `bm25_doc_count, vector_doc_count, elapsed_ms`
- `lsp_resolve`: **must be `null`** when `lsp: false`

---

## Probe 10 — `lsp_resolve` with disallowed command (Finding F-001)

**Tool**: `lsp_resolve`
**Purpose**: Validates that all four distinct error reason codes are preserved through
the adapter, specifically the `lsp_command_not_allowed` path with the `allowed` field.

### Input JSON
```json
{
  "graph_path": "<from_probe_4>",
  "codebase_path": "/Users/cdeust/Developments/anthropic/ai-automatised-pipeline",
  "language": "rust",
  "lsp_command": "/bin/sh"
}
```

### Expected Output Key Set
```
stage, status, reason, message, allowed
```

### Oracle Notes
- `status` must equal `"error"`.
- `reason` must equal `"lsp_command_not_allowed"`.
- `allowed` must be a non-empty array of strings.
- **The adapter must NOT throw** — must return the error payload as-is.
- **The `allowed` field must be present** — this is the Finding F-001 critical requirement.

---

## Probe Execution Order

Probes have data dependencies:

```
Probe 1 (health_check)          — independent
Probe 2 (extract_finding)       — independent; produces run_id for Probe 3
Probe 3 (refine_finding)        — depends on Probe 2 run_id
Probe 4 (index_codebase)        — independent; produces graph_path for 5, 6, 7, 8, 10
Probe 5 (query_graph)           — depends on Probe 4
Probe 6 (resolve_graph + cluster_graph) — depends on Probe 4
Probe 7 (search_codebase)       — depends on Probe 6 (cluster required for community_id)
Probe 8 (get_symbol)            — depends on Probe 4
Probe 9 (analyze_codebase)      — independent (own output_dir)
Probe 10 (lsp_resolve)          — depends on Probe 4
```

The oracle runs them in dependency order. Each probe's output is saved as a
JSON fixture under `parity-oracle/codebase/fixtures/<probe_name>/` for
regression testing on future adapter changes.
