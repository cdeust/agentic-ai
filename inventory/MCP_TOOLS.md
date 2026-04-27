# MCP Tools Inventory — `ai-architect-mcp`

Source of truth: `src/tool_schemas.rs` (schema definitions) + `src/main.rs` (dispatch + response shapes).

Total tools registered: **23** (verified by `handle_tool_call` match arms at `src/main.rs:3261-3314`
and `tools_list()` array at `src/tool_schemas.rs:12-37`).

The deferred-tools list from the mission brief (`index_codebase, query_graph, get_symbol, get_context,
get_impact, search_codebase, analyze_codebase, cluster_graph, detect_changes, verify_semantic_diff,
validate_prd_against_graph, prepare_prd_input, append_clarification, extract_finding, refine_finding,
start_verification, finalize_verification, abort_verification, check_security_gates, get_processes,
lsp_resolve, resolve_graph, health_check`) — all 23 are present and dispatched.

---

## Common Response Envelope

Every `tools/call` response wraps the payload in a content envelope:
```json
{
  "content": [{
    "type": "text",
    "text": "<JSON string of the actual payload>"
  }]
}
```
The `text` field is pretty-printed JSON of the stage-specific payload.

Unknown tool names return:
```json
{ "isError": true, "content": [{ "type": "text", "text": "Unknown tool: <name>" }] }
```

Error payloads (all tools): `{ "stage": N, "status": "error", "reason": "<code>", "message": "..." }`
Reason codes are documented per-tool below. The adapter MUST preserve reason codes exactly —
callers branch on them (source: `src/main.rs` lsp_resolve dispatch at line 2638).

---

## Tool 1: `health_check`

**Stage**: 0
**Source**: `src/main.rs:3261-3282`, `src/tool_schemas.rs:40-50`
**Description**: Handshake. Returns server identity, protocol version, tool count.

### Input Schema
```json
{ "type": "object", "properties": {}, "additionalProperties": false }
```
No required fields; empty object `{}` is the canonical call.

### Output Schema (success)
```json
{
  "stage": 0,
  "name": "health_check",
  "status": "ok",
  "server": "ai-architect",
  "version": "<semver>",
  "protocol": "2024-11-05",
  "stages_registered": "<integer>",
  "tools_count": "<integer>"
}
```
`stages_registered` and `tools_count` are both derived from `tools_list().tools.length` at call time.
They are equal. Currently 23.

### Error Modes
None — this call cannot fail under normal operation.

---

## Tool 2: `extract_finding`

**Stage**: 1a
**Source**: `src/main.rs:766-895`, `src/tool_schemas.rs:52-80`
**Description**: Normalizes one incoming finding to canonical schema. Writes
`stage-1.source.json` + `stage-1.extracted.json` atomically. Does NOT call an LLM.

### Input Schema
```json
{
  "type": "object",
  "required": ["finding", "output_dir"],
  "additionalProperties": false,
  "properties": {
    "finding": {
      "oneOf": [
        { "type": "object" },
        { "type": "string", "pattern": "^/.+\\.json$" }
      ]
    },
    "output_dir": { "type": "string", "pattern": "^/.+" },
    "run_id": { "type": "string" }
  }
}
```
`finding` is either an inline object matching spec §3.2 or an absolute path to a `.json` file.
`.md` paths are rejected with a clear error.
`run_id` is optional — auto-generated as `YYYYMMDD-HHMMSS-<6 alphanumeric>` (UTC) when absent.

Finding object MUST have: `id` (non-empty), `title` (non-empty), `relevance_category` (non-empty).
Optional: `description`, `source_url`, `relevance_score`, `raw_data`, plus any additional fields
(preserved in `extras`).

### Output Schema (success)
```json
{
  "stage": 1,
  "status": "ok",
  "finding_id": "<string>",
  "artifact_path": "<absolute path to stage-1.extracted.json>",
  "run_id": "<string>",
  "bytes_written": "<integer>",
  "extractor_version": "1.0.0"
}
```

### Error Modes
```json
{ "stage": 1, "status": "error", "reason": "<code>" }
```
Reason codes (no `message` field on this tool — only `reason`):
- `"<validation message>"` — inline error string (this tool uses a simpler error format than others)

Common error triggers: missing required `finding` fields, unsafe `finding_id` (fails
`[A-Za-z0-9._-]+` pattern or starts with `.`), non-absolute `output_dir`, `.md` input path.

---

## Tool 3: `refine_finding`

**Stage**: 1b
**Source**: `src/main.rs:923-1090`, `src/tool_schemas.rs:82-136`
**Description**: Reads existing `stage-1.extracted.json`, writes `stage-1.refined.json`
with orchestrator-provided `refined_prompt` + `refinement`. No LLM call.

### Input Schema
```json
{
  "type": "object",
  "required": ["run_id", "finding_id", "output_dir", "refined_prompt", "refinement"],
  "additionalProperties": false,
  "properties": {
    "run_id": { "type": "string" },
    "finding_id": { "type": "string" },
    "output_dir": { "type": "string", "pattern": "^/.+" },
    "refined_prompt": {
      "type": "object",
      "required": ["text", "role_hint"],
      "additionalProperties": false,
      "properties": {
        "text": { "type": "string", "minLength": 1 },
        "role_hint": { "type": "string" },
        "token_estimate": { "type": ["integer", "null"] }
      }
    },
    "refinement": {
      "type": "object",
      "required": ["added_context", "orchestrator_version"],
      "additionalProperties": false,
      "properties": {
        "added_context": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["kind", "content"],
            "additionalProperties": false,
            "properties": {
              "kind": { "type": "string" },
              "content": { "type": "string" },
              "provenance": { "type": "string" }
            }
          }
        },
        "orchestrator_version": { "type": "string" }
      }
    }
  }
}
```
`refined_at` in `refinement` is IGNORED if sent — the server fills it server-side.

### Output Schema (success)
```json
{
  "stage": 1,
  "status": "ok",
  "finding_id": "<string>",
  "artifact_path": "<absolute path to stage-1.refined.json>",
  "run_id": "<string>",
  "bytes_written": "<integer>",
  "extractor_version": "1.0.0",
  "orchestrator_version": "<string>",
  "orchestrator_contract_version": "1.0.0"
}
```

### Error Modes
```json
{ "stage": 1, "status": "error", "reason": "<code>", "message": "<string>" }
```
Reason codes:
- `"bad_request"` — missing field, wrong type, invalid argument
- `"no_extraction"` — `stage-1.extracted.json` does not exist (call `extract_finding` first)
- `"corrupt_extraction"` — existing `stage-1.extracted.json` fails to parse
- `"empty_prompt"` — `refined_prompt.text` is empty
- `"unsafe_id"` — run_id or finding_id fails safe-ID validation
- `"io_error"` — disk write failure

---

## Tool 4: `start_verification`

**Stage**: 2a
**Source**: `src/main.rs` (stage-2 section), `src/tool_schemas.rs:138-153`
**Description**: Creates a clarification session. Verifies `stage-1.refined.json` exists
and parses (`schema_ok`). Writes `stage-2.session.json` with state `open`.

### Input Schema
```json
{
  "type": "object",
  "required": ["run_id", "finding_id", "output_dir"],
  "additionalProperties": false,
  "properties": {
    "run_id": { "type": "string" },
    "finding_id": { "type": "string" },
    "output_dir": { "type": "string", "pattern": "^/.+" }
  }
}
```

### Output Schema (success)
```json
{
  "stage": 2,
  "status": "ok",
  "state": "open",
  "run_id": "<string>",
  "finding_id": "<string>",
  "schema_ok": "<boolean>"
}
```

### Error Modes
```json
{ "stage": 2, "status": "error", "reason": "<code>", "message": "<string>" }
```
Reason codes: `"bad_request"`, `"no_refinement"` (stage-1.refined.json missing), `"already_finalized"`, `"unsafe_id"`, `"io_error"`

---

## Tool 5: `append_clarification`

**Stage**: 2b
**Source**: `src/main.rs` (stage-2 section), `src/tool_schemas.rs:155-173`
**Description**: Appends one turn to `stage-2.session.json`. Enforces alternation
invariant (two consecutive same-kind turns rejected). Whole-file atomic rewrite.

### Input Schema
```json
{
  "type": "object",
  "required": ["run_id", "finding_id", "output_dir", "kind", "content"],
  "additionalProperties": false,
  "properties": {
    "run_id": { "type": "string" },
    "finding_id": { "type": "string" },
    "output_dir": { "type": "string", "pattern": "^/.+" },
    "kind": { "enum": ["agent_question", "user_answer"] },
    "content": { "type": "string", "minLength": 1 },
    "meta": { "type": "object" }
  }
}
```

### Output Schema (success)
```json
{
  "stage": 2,
  "status": "ok",
  "state": "<open|waiting_for_user|waiting_for_agent>",
  "seq": "<integer>",
  "turn_count": "<integer>"
}
```

### Error Modes
```json
{ "stage": 2, "status": "error", "reason": "<code>", "message": "<string>" }
```
Reason codes: `"bad_request"`, `"no_session"`, `"invalid_transition"` (state machine rejection — e.g. two agent questions in a row), `"unsafe_id"`, `"io_error"`

---

## Tool 6: `finalize_verification`

**Stage**: 2c
**Source**: `src/main.rs:1690-1722`, `src/tool_schemas.rs:175-190`
**Description**: Consumes the user-ready signal. Computes SHA-256 over the canonical
transcript bytes. Writes `stage-2.verified.json`. Flips session to `finalized`.

### Input Schema
```json
{
  "type": "object",
  "required": ["run_id", "finding_id", "output_dir"],
  "additionalProperties": false,
  "properties": {
    "run_id": { "type": "string" },
    "finding_id": { "type": "string" },
    "output_dir": { "type": "string", "pattern": "^/.+" }
  }
}
```

### Output Schema (success)
```json
{
  "stage": 2,
  "status": "ok",
  "state": "finalized",
  "verified": "<boolean>",
  "verified_kind": {
    "schema_ok": "<boolean>",
    "completeness_ok": "<boolean>",
    "user_acknowledged": "<boolean>"
  },
  "verified_path": "<absolute path to stage-2.verified.json>",
  "turn_count": "<integer>",
  "transcript_digest": "<hex string>",
  "digest_algorithm": "sha256",
  "transcript_bytes_at_finalize": "<integer>",
  "bytes_written": "<integer>",
  "verifier_version": "1.0.0"
}
```

### Error Modes
Reason codes: `"bad_request"`, `"no_session"`, `"schema_not_ok"`, `"no_clarification_round"` (state `open`), `"unanswered_question"` (state `waiting_for_user`), `"unsafe_id"`, `"io_error"`

---

## Tool 7: `abort_verification`

**Stage**: 2d
**Source**: `src/main.rs:1765-1789`, `src/tool_schemas.rs:192-208`
**Description**: Kills a non-terminal session. Atomically rewrites `stage-2.session.json`
with state `aborted`. Does NOT touch `index.json`.

### Input Schema
```json
{
  "type": "object",
  "required": ["run_id", "finding_id", "output_dir"],
  "additionalProperties": false,
  "properties": {
    "run_id": { "type": "string" },
    "finding_id": { "type": "string" },
    "output_dir": { "type": "string", "pattern": "^/.+" },
    "reason": { "type": "string" }
  }
}
```

### Output Schema (success)
```json
{
  "stage": 2,
  "status": "ok",
  "state": "aborted",
  "run_id": "<string>",
  "finding_id": "<string>",
  "turn_count": "<integer>",
  "aborted_at": "<ISO 8601 UTC timestamp>"
}
```

### Error Modes
Reason codes: `"bad_request"`, `"no_session"`, `"invalid_transition"` (already finalized), `"unsafe_id"`, `"io_error"`

---

## Tool 8: `index_codebase`

**Stage**: 3a
**Source**: `src/main.rs:1795-1841`, `src/tool_schemas.rs:210-236`
**Description**: Walks the codebase directory, parses source files with tree-sitter,
persists the code-intelligence graph to LadybugDB at `<output_dir>/graph/`.

### Input Schema
```json
{
  "type": "object",
  "required": ["path", "output_dir"],
  "additionalProperties": false,
  "properties": {
    "path": { "type": "string" },
    "language": { "type": "string", "enum": ["auto", "rust", "python", "typescript"], "default": "auto" },
    "output_dir": { "type": "string" }
  }
}
```
Both `path` and `output_dir` must be absolute. `path` must exist. `output_dir` is created if absent.

### Output Schema (success)
```json
{
  "stage": 3,
  "status": "ok",
  "tool": "index_codebase",
  "graph_path": "<absolute path ending in /graph>",
  "node_count": "<integer>",
  "edge_count": "<integer>",
  "files_indexed": "<integer>",
  "elapsed_ms": "<integer>"
}
```
**Invariant**: stale `<output_dir>/graph/` is removed before re-indexing.

### Error Modes
Reason code: `"index_failed"` with `message` field.

---

## Tool 9: `query_graph`

**Stage**: 3a
**Source**: `src/main.rs:1847-2010`, `src/tool_schemas.rs:238-258`
**Description**: Executes a read-only Cypher query against an indexed code graph.
Mutation keywords (`CREATE`, `DELETE`, `MERGE`, `SET`, `REMOVE`, `DROP`, `ALTER`, `CALL`, `LOAD`)
are rejected with `read_only_query_required` before reaching the engine.

### Input Schema
```json
{
  "type": "object",
  "required": ["graph_path", "query"],
  "additionalProperties": false,
  "properties": {
    "graph_path": { "type": "string" },
    "query": { "type": "string" }
  }
}
```

### Output Schema (success)
```json
{
  "stage": 3,
  "status": "ok",
  "tool": "query_graph",
  "columns": ["<string>", "..."],
  "rows": [["<string>", "..."], "..."],
  "result": "<pipe-delimited text string>",
  "elapsed_ms": "<integer>"
}
```
`columns` is an array of column name strings.
`rows` is an array of row arrays (each row is an array of string values).
`result` is a pre-formatted pipe-delimited summary string (for display).
**IMPORTANT for adapter (Finding F-002)**: all three must be surfaced.

### Error Modes
Reason codes: `"read_only_query_required"` (mutation keyword detected — must be distinct), `"query_failed"`

---

## Tool 10: `get_symbol`

**Stage**: 3a
**Source**: `src/main.rs:2025-2080`, `src/tool_schemas.rs:260-280`
**Description**: Looks up a symbol by qualified name. Three-layer lookup: exact →
strip-path prefix → fuzzy match. Returns node properties + all incoming and outgoing edges.

### Input Schema
```json
{
  "type": "object",
  "required": ["graph_path", "qualified_name"],
  "additionalProperties": false,
  "properties": {
    "graph_path": { "type": "string" },
    "qualified_name": { "type": "string" }
  }
}
```

### Output Schema (success — symbol found)
```json
{
  "stage": 3,
  "status": "ok",
  "tool": "get_symbol",
  "node": { "label": "<NodeLabel>", "data": "<string>" },
  "edges_out": [{ "rel": "<string>", "id": "<string>" }, "..."],
  "edges_in": [{ "rel": "<string>", "id": "<string>" }, "..."]
}
```

### Output Schema (symbol not found — NOT an error status)
```json
{
  "stage": 3,
  "status": "error",
  "reason": "symbol_not_found",
  "message": "not found: <qualified_name>",
  "did_you_mean": ["<string>", "..."]
}
```
**IMPORTANT for adapter (Finding F-004)**: `node` is `null` when symbol is not found,
but the response still has `status: "ok"` and `node: null` in the non-error path.
The `status: "error"` path returns `did_you_mean` suggestions.

### Error Modes
Reason codes: `"symbol_not_found"` (with `did_you_mean`), `"symbol_lookup_failed"`

---

## Tool 11: `resolve_graph`

**Stage**: 3b
**Source**: `src/main.rs:2162-2204`, `src/tool_schemas.rs:282-298`
**Description**: Resolves cross-file edges after `index_codebase`. Adds Imports, Calls,
Implements, Extends, Uses edges.

### Input Schema
```json
{
  "type": "object",
  "required": ["graph_path"],
  "additionalProperties": false,
  "properties": {
    "graph_path": { "type": "string" }
  }
}
```

### Output Schema (success)
```json
{
  "stage": 3,
  "status": "ok",
  "tool": "resolve_graph",
  "imports_resolved": "<integer>",
  "calls_resolved": "<integer>",
  "implements_resolved": "<integer>",
  "extends_resolved": "<integer>",
  "uses_resolved": "<integer>",
  "total_edges": "<integer>",
  "total_refs": "<integer>",
  "resolution_rate": "<float string, 2dp>",
  "unresolved_count": "<integer>",
  "elapsed_ms": "<integer>"
}
```

### Error Modes
Reason code: `"resolve_failed"`

---

## Tool 12: `cluster_graph`

**Stage**: 3c
**Source**: `src/main.rs:2210-2264`, `src/tool_schemas.rs:300-321`
**Description**: Community detection (Louvain + C2 repair) + process tracing (BFS
from entry points). Requires `resolve_graph` first.

### Input Schema
```json
{
  "type": "object",
  "required": ["graph_path"],
  "additionalProperties": false,
  "properties": {
    "graph_path": { "type": "string" },
    "resolution_param": { "type": "number", "default": 1.0 }
  }
}
```

### Output Schema (success)
```json
{
  "stage": 3,
  "status": "ok",
  "tool": "cluster_graph",
  "community_count": "<integer>",
  "modularity": "<float string, 6dp>",
  "process_count": "<integer>",
  "elapsed_ms": "<integer>",
  "clusters": [
    {
      "qualified_name": "<string>",
      "community_id": "<string>",
      "qn": "<string>",
      "cluster_id": "<integer>"
    }
  ],
  "total_memberships": "<integer>",
  "clusters_truncated_at": "<integer | absent>"
}
```
`clusters_truncated_at` is present ONLY when the memberships list was truncated
(Finding F-005 — adapter output type must be `number | undefined`).

### Error Modes
Reason code: `"cluster_failed"`

---

## Tool 13: `get_processes`

**Stage**: 3c
**Source**: `src/main.rs:2270-2307`, `src/tool_schemas.rs:322-339`
**Description**: Lists all detected processes (BFS execution flows from entry points).
Requires `cluster_graph` first.

### Input Schema
```json
{
  "type": "object",
  "required": ["graph_path"],
  "additionalProperties": false,
  "properties": {
    "graph_path": { "type": "string" }
  }
}
```

### Output Schema (success)
```json
{
  "stage": 3,
  "status": "ok",
  "tool": "get_processes",
  "process_count": "<integer>",
  "processes": [
    {
      "name": "<string>",
      "entry_point": "<string>",
      "entry_kind": "<main|test|handler|lib_entry>",
      "depth": "<integer>",
      "node_count": "<integer>"
    }
  ]
}
```

### Error Modes
Reason code: `"processes_failed"`

---

## Tool 14: `get_impact`

**Stage**: 3c
**Source**: `src/main.rs:2313-2347`, `src/tool_schemas.rs:341-361`
**Description**: Blast-radius analysis. Returns which communities and processes a
symbol participates in. Requires `cluster_graph` first.

### Input Schema
```json
{
  "type": "object",
  "required": ["graph_path", "qualified_name"],
  "additionalProperties": false,
  "properties": {
    "graph_path": { "type": "string" },
    "qualified_name": { "type": "string" }
  }
}
```

### Output Schema (success)
```json
{
  "stage": 3,
  "status": "ok",
  "tool": "get_impact",
  "qualified_name": "<string>",
  "communities": ["<string>", "..."],
  "communities_affected": "<integer>",
  "processes": ["<string>", "..."],
  "processes_affected": "<integer>"
}
```

### Error Modes
Reason code: `"impact_failed"`

---

## Tool 15: `search_codebase`

**Stage**: 3d
**Source**: `src/main.rs:2353-2416`, `src/tool_schemas.rs:363-393`
**Description**: Hybrid BM25 + vector keyword search over the code graph. Returns
ranked symbols. Requires `analyze_codebase` or all three of `index_codebase` + `resolve_graph` + `cluster_graph`.

### Input Schema
```json
{
  "type": "object",
  "required": ["graph_path", "query"],
  "additionalProperties": false,
  "properties": {
    "graph_path": { "type": "string" },
    "query": { "type": "string" },
    "limit": { "type": "integer", "default": 20 },
    "label_filter": {
      "type": "string",
      "enum": ["Function", "Method", "Struct", "Enum", "Trait", "Module", "Constant", "TypeAlias"]
    }
  }
}
```

### Output Schema (success)
```json
{
  "stage": 3,
  "status": "ok",
  "tool": "search_codebase",
  "query": "<string>",
  "result_count": "<integer>",
  "results": [
    {
      "qualified_name": "<string>",
      "name": "<string>",
      "kind": "<NodeLabel>",
      "file_path": "<string>",
      "score": "<float string, 4dp>",
      "community_id": "<string | null>",
      "processes": ["<string>", "..."],
      "start_line": "<integer | null>",
      "end_line": "<integer | null>"
    }
  ],
  "elapsed_ms": "<integer>"
}
```

**Note (Finding F-003)**: The Rust binary calls `std::env::set_var("AA_SEARCH_INDEX_DIR", ...)` to
locate the BM25 index (sibling of `graph/` under the same `output_dir`). The search index is only
built by `analyze_codebase`. Callers using `index_codebase` + `resolve_graph` + `cluster_graph`
individually will not have a search index and must call `search_codebase` with awareness of degraded mode.

### Error Modes
Reason code: `"search_failed"`

---

## Tool 16: `get_context`

**Stage**: 3d
**Source**: `src/main.rs:2422-2507`, `src/tool_schemas.rs:395-415`
**Description**: 360° symbol view. Returns symbol + ALL relationships grouped by kind:
imports, imported_by, calls, called_by, implements, implemented_by, uses, used_by,
community membership, process participation.

### Input Schema
```json
{
  "type": "object",
  "required": ["graph_path", "qualified_name"],
  "additionalProperties": false,
  "properties": {
    "graph_path": { "type": "string" },
    "qualified_name": { "type": "string" }
  }
}
```

### Output Schema (success)
```json
{
  "stage": 3,
  "status": "ok",
  "tool": "get_context",
  "symbol": {
    "qualified_name": "<string>",
    "name": "<string>",
    "kind": "<NodeLabel>",
    "file_path": "<string>",
    "start_line": "<integer | null>",
    "end_line": "<integer | null>",
    "visibility": "<string | null>"
  },
  "relationships": {
    "imports": [{ "name": "<string>", "qualified_name": "<string>", "kind": "<string>" }],
    "imported_by": ["..."],
    "calls": ["..."],
    "called_by": ["..."],
    "implements": ["..."],
    "implemented_by": ["..."],
    "uses": ["..."],
    "used_by": ["..."]
  },
  "community": { "id": "<string>", "name": "<string>", "member_count": "<integer>" } | null,
  "processes": [{ "name": "<string>", "role": "<string>" }]
}
```

### Output Schema (symbol not found)
```json
{
  "stage": 3,
  "status": "error",
  "reason": "symbol_not_found",
  "message": "not found: <qualified_name>",
  "did_you_mean": ["<string>", "..."]
}
```

### Error Modes
Reason codes: `"symbol_not_found"` (with `did_you_mean`), `"context_failed"`

---

## Tool 17: `analyze_codebase`

**Stage**: 3 (all-in-one)
**Source**: `src/main.rs:2513-2624`, `src/tool_schemas.rs:417-453`
**Description**: Runs `index_codebase` + `resolve_graph` + `cluster_graph` + search index build
in sequence. Optionally runs LSP-enhanced resolution if `lsp: true`.

### Input Schema
```json
{
  "type": "object",
  "required": ["path", "output_dir"],
  "additionalProperties": false,
  "properties": {
    "path": { "type": "string" },
    "language": { "type": "string", "enum": ["auto", "rust", "python", "typescript"], "default": "auto" },
    "output_dir": { "type": "string" },
    "resolution_param": { "type": "number", "default": 1.0 },
    "lsp": { "type": "boolean", "default": false }
  }
}
```

### Output Schema (success)
```json
{
  "stage": 3,
  "status": "ok",
  "tool": "analyze_codebase",
  "graph_path": "<absolute path ending in /graph>",
  "index": {
    "node_count": "<integer>",
    "edge_count": "<integer>",
    "files_indexed": "<integer>"
  },
  "resolve": {
    "total_edges": "<integer>",
    "resolution_rate": "<float string, 2dp>"
  },
  "cluster": {
    "community_count": "<integer>",
    "modularity": "<float string, 6dp>",
    "process_count": "<integer>"
  },
  "search_index": {
    "bm25_doc_count": "<integer>",
    "vector_doc_count": "<integer>",
    "elapsed_ms": "<integer>"
  },
  "lsp_resolve": {
    "resolved_count": "<integer>",
    "failed_count": "<integer>",
    "skipped_count": "<integer>",
    "elapsed_ms": "<integer>"
  } | null,
  "total_elapsed_ms": "<integer>"
}
```
`lsp_resolve` is `null` when `lsp: false` (the default).

### Error Modes
Reason code: `"analyze_failed"`

---

## Tool 18: `detect_changes`

**Stage**: 3e
**Source**: `src/main.rs:2753-2805`, `src/tool_schemas.rs:566-601`
**Description**: Git diff impact analysis. Maps changed lines to affected symbols,
communities, processes. Accepts raw unified diff text OR git refs.

### Input Schema
```json
{
  "type": "object",
  "required": ["graph_path"],
  "additionalProperties": false,
  "properties": {
    "graph_path": { "type": "string" },
    "diff_text": { "type": "string" },
    "codebase_path": { "type": "string" },
    "base_ref": { "type": "string", "default": "HEAD~1" },
    "head_ref": { "type": "string", "default": "HEAD" }
  }
}
```
Either `diff_text` OR `codebase_path` must be provided (mutually exclusive for the diff source).
When using `base_ref`/`head_ref`, `codebase_path` is required.

### Output Schema (success)
```json
{
  "stage": 3,
  "status": "ok",
  "tool": "detect_changes",
  "files_changed": "<integer>",
  "symbols_affected": [
    {
      "qualified_name": "<string>",
      "change_type": "<string>",
      "community": "<string | null>",
      "processes": ["<string>", "..."]
    }
  ],
  "symbols_affected_count": "<integer>",
  "communities_affected": ["<string>", "..."],
  "communities_affected_count": "<integer>",
  "processes_affected": ["<string>", "..."],
  "processes_affected_count": "<integer>",
  "risk_score": "<float string, 4dp>"
}
```

### Error Modes
Reason code: `"detect_changes_failed"`; also triggers when neither `diff_text` nor `codebase_path` provided.

---

## Tool 19: `lsp_resolve`

**Stage**: 3b-v2
**Source**: `src/main.rs:2634-2724`, `src/tool_schemas.rs:455-490`
**Description**: LSP-enhanced resolution. Queries a Language Server Protocol server
to resolve method calls on inferred types. Runs after `resolve_graph`. Gracefully
degrades if the LSP server is not installed.

### Input Schema
```json
{
  "type": "object",
  "required": ["graph_path", "codebase_path"],
  "additionalProperties": false,
  "properties": {
    "graph_path": { "type": "string" },
    "codebase_path": { "type": "string" },
    "language": { "type": "string", "enum": ["rust", "python", "typescript", "auto"], "default": "auto" },
    "lsp_command": { "type": "string" },
    "timeout_ms": { "type": "integer", "default": 30000 }
  }
}
```
`lsp_command` overrides auto-detection. Only commands in `LSP_COMMAND_ALLOWLIST`
(source: `src/lsp_client.rs`) are accepted.

### Output Schema (success)
```json
{
  "stage": 3,
  "status": "ok",
  "tool": "lsp_resolve",
  "resolved_count": "<integer>",
  "failed_count": "<integer>",
  "skipped_count": "<integer>",
  "elapsed_ms": "<integer>"
}
```

### Error Modes
**CRITICAL (Finding F-001)**: Four distinct reason codes; callers branch on them.
Must be preserved exactly through the adapter.
```json
{ "stage": 3, "status": "error", "reason": "lsp_command_not_allowed", "message": "...", "allowed": ["..."] }
{ "stage": 3, "status": "error", "reason": "lsp_not_found", "message": "..." }
{ "stage": 3, "status": "error", "reason": "lsp_probe_failed", "message": "..." }
{ "stage": 3, "status": "error", "reason": "lsp_resolve_failed", "message": "..." }
```
`allowed` field is only present on `lsp_command_not_allowed`.

---

## Tool 20: `prepare_prd_input`

**Stage**: 4
**Source**: `src/main.rs:2811-2889`, `src/tool_schemas.rs:492-508`
**Description**: Bundles verified stage-2 finding + graph intel into `stage-4.prd_input.json`.
Read-only against the graph. Updates `index.json` with stage4 markers.

### Input Schema
```json
{
  "type": "object",
  "required": ["run_id", "finding_id", "output_dir", "graph_path"],
  "additionalProperties": false,
  "properties": {
    "run_id": { "type": "string" },
    "finding_id": { "type": "string" },
    "output_dir": { "type": "string", "pattern": "^/.+" },
    "graph_path": { "type": "string", "pattern": "^/.+" }
  }
}
```

### Output Schema (success)
```json
{
  "stage": 4,
  "status": "ok",
  "tool": "prepare_prd_input",
  "run_id": "<string>",
  "finding_id": "<string>",
  "artifact_path": "<absolute path to stage-4.prd_input.json>",
  "prepared_at": "<ISO 8601 UTC>",
  "matched_symbol_count": "<integer>",
  "impacted_community_count": "<integer>",
  "impacted_process_count": "<integer>",
  "preparer_version": "<string>"
}
```

### Error Modes
```json
{ "stage": 4, "status": "error", "reason": "<code>", "message": "<string>" }
```
Reason codes: `"stage_2_not_verified"`, `"stage_1_refined_missing"`, `"prepare_prd_input_failed"`

---

## Tool 21: `validate_prd_against_graph`

**Stage**: 6
**Source**: `src/main.rs:2976-3037`, `src/tool_schemas.rs:510-528`
**Description**: Validates a PRD against the resolved+clustered graph. Three axes:
symbol hallucination (critical), community-consistency (warning/critical),
process-impact contradiction (critical). LLM-free. Read-only.

### Input Schema
```json
{
  "type": "object",
  "required": ["prd_path", "graph_path"],
  "additionalProperties": false,
  "properties": {
    "prd_path": { "type": "string", "pattern": "^/.+" },
    "graph_path": { "type": "string", "pattern": "^/.+" },
    "affected_symbols_path": { "type": "string", "pattern": "^/.+" },
    "output_dir": { "type": "string", "pattern": "^/.+" },
    "run_id": { "type": "string" },
    "finding_id": { "type": "string" }
  }
}
```
`output_dir`, `run_id`, `finding_id` are all-or-nothing (stage-6.validation.json
written only when all three are provided — ADR-004 analog).

### Output Schema (success)
```json
{
  "stage": 6,
  "status": "ok",
  "tool": "validate_prd_against_graph",
  "validated_at": "<ISO 8601 UTC>",
  "validation_status": "<string>",
  "extraction_mode": "<string>",
  "contract_missing": "<boolean>",
  "summary": {
    "claimed_symbols": "<integer>",
    "resolved_symbols": "<integer>",
    "hallucinated_symbols": "<integer>",
    "communities_spanned": "<integer>",
    "processes_impacted": "<integer>"
  },
  "artifact_path": "<string | null>",
  "report": { "...": "..." }
}
```

### Error Modes
Reason code: `"validate_prd_against_graph_failed"`

---

## Tool 22: `check_security_gates`

**Stage**: 8
**Source**: `src/main.rs:3075-3152`, `src/tool_schemas.rs:530-547`
**Description**: Five security gate checks on changed symbols. Returns `gates_passed`
boolean. Optional artifact write when `run_id + finding_id + output_dir` all provided (ADR-004).

### Input Schema
```json
{
  "type": "object",
  "required": ["graph_path", "changed_symbols"],
  "additionalProperties": false,
  "properties": {
    "graph_path": { "type": "string", "pattern": "^/.+" },
    "changed_symbols": { "type": "array", "items": { "type": "string" }, "minItems": 0 },
    "output_dir": { "type": "string", "pattern": "^/.+" },
    "run_id": { "type": "string" },
    "finding_id": { "type": "string" }
  }
}
```

### Output Schema (success)
```json
{
  "stage": 8,
  "status": "ok",
  "tool": "check_security_gates",
  "checked_at": "<ISO 8601 UTC>",
  "gates_passed": "<boolean>",
  "summary": {
    "changed_symbols": "<integer>",
    "critical_count": "<integer>",
    "warning_count": "<integer>",
    "info_count": "<integer>"
  },
  "artifact_path": "<string | null>",
  "report": { "...": "..." }
}
```

### Error Modes
Reason code: `"check_security_gates_failed"`

---

## Tool 23: `verify_semantic_diff`

**Stage**: 9
**Source**: `src/main.rs:2895-2970`, `src/tool_schemas.rs:549-564`
**Description**: Compares post-implementation graph vs pre-implementation graph.
Returns `regression_score` (0.0–10.0, thresholds: <1 clean, <5 concerning, ≥5 regression).
Read-only against both graphs.

### Input Schema
```json
{
  "type": "object",
  "required": ["before_graph_path", "after_graph_path"],
  "additionalProperties": false,
  "properties": {
    "before_graph_path": { "type": "string", "pattern": "^/.+" },
    "after_graph_path": { "type": "string", "pattern": "^/.+" },
    "report_path": { "type": "string", "pattern": "^/.+" }
  }
}
```

### Output Schema (success)
```json
{
  "stage": 9,
  "status": "ok",
  "tool": "verify_semantic_diff",
  "verified_at": "<ISO 8601 UTC>",
  "summary": {
    "nodes_added": "<integer>",
    "nodes_removed": "<integer>",
    "edges_added": "<integer>",
    "edges_removed": "<integer>",
    "dangling_references": "<integer>",
    "new_unresolved_delta": "<integer>",
    "new_cycles": "<integer>"
  },
  "regression_score": "<float>",
  "verdict": "<string>",
  "report": { "...": "..." },
  "report_path": "<string | null>"
}
```

### Error Modes
```json
{ "stage": 9, "status": "error", "reason": "<code>", "message": "<string>" }
```
Reason codes: `"before_graph_path_missing"`, `"after_graph_path_missing"`, `"verify_semantic_diff_failed"`

---

## Wire Protocol Summary

The Rust binary speaks MCP over stdio using hand-rolled JSON-RPC 2.0
(source: `src/main.rs` lines 1–17 comment block).

- **Framing**: newline-delimited JSON. One JSON object per line on stdout and stdin.
- **Methods handled**: `initialize`, `notifications/initialized` (no-op), `tools/list`, `tools/call`
- **Request shape**: `{ "jsonrpc": "2.0", "id": <any>, "method": "<string>", "params": <object> }`
- **Response shape**: `{ "jsonrpc": "2.0", "id": <id>, "result": <value> }` or
  `{ "jsonrpc": "2.0", "id": <id>, "error": { "code": <int>, "message": "<string>" } }`
- **`initialize` response** includes `protocolVersion: "2024-11-05"`, `capabilities: { tools: {} }`,
  `serverInfo: { name: "ai-architect", version: "<semver>" }`
- **Unknown method** → JSON-RPC error code `-32601` ("Method not found")
