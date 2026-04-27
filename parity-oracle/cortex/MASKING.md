# Parity Oracle — Non-Deterministic Field Masking Convention

## 1. Masking sentinel

Every non-deterministic field in an `expected/` file is replaced with the exact literal string:

```
"<MASKED:nondeterministic>"
```

The parity harness, when comparing a TS port's output to an expected file, skips any field whose expected value is this sentinel. It does NOT skip the key — the key must still be present in the actual output.

This convention distinguishes three cases:

| Case | How to represent | Harness behaviour |
|---|---|---|
| Field must be present, value is non-deterministic | `"<MASKED:nondeterministic>"` | Assert key present, skip value comparison |
| Field must be absent | Omit the key from expected file | Assert key absent in actual |
| Field must be present with exact value | Provide the value directly | Assert key present and value equal |

## 2. Fields masked by category

### 2.1 Temporal / wall-clock fields

These are always non-deterministic across runs and across Python vs TS implementations.

| Field path | Reason |
|---|---|
| `results[*].created_at` | Database row timestamp; changes per insert |
| `enhancements.generated_at_utc` | Wall clock at query time |
| `lastActive` | ISO timestamp of last profile write |
| `hotMemories[*].created_at` | Memory row timestamp |
| `duration_ms.*` | Measured execution time; machine-dependent |

### 2.2 Ephemeral identity fields

These identify specific rows in a specific DB instance and are meaningless cross-environment.

| Field path | Reason |
|---|---|
| `memory_id` | Auto-generated UUID or auto-increment integer; differs per insert |
| `results[*].id` | Same as memory_id |
| `merged_with` | UUID of existing memory that changed on merge |

### 2.3 Content fields (masked for recall/narrative only)

Recall and narrative results depend on which memories are in the DB at capture time. The TS parity test for these fixtures checks SHAPE, not content.

| Field path | Reason |
|---|---|
| `results[*].content` | DB-state-dependent; parity tests verify key presence and type |
| `narrative` | Generated prose; depends on memory state |
| `summary` | Generated prose; depends on memory state |
| `context` (in query_methodology) | Includes memory content and triggers |
| `themes` | Extracted from memory content |

### 2.4 Score / heat fields (partially masked)

Some score fields are masked because they depend on embedding model output, which may differ slightly between Python (sentence-transformers) and a TS port (node bindings). However, BOUNDS are checked.

| Field path | Rule |
|---|---|
| `results[*].score` | Masked for exact value; harness asserts `0.0 <= score <= 1.0` |
| `results[*].heat` | Masked for exact value; harness asserts `0.0 <= heat <= 1.0` |
| `heat` (remember response) | Masked; harness asserts value in (0.0, 1.0] |

## 3. Bounded masking notation

When a field is non-deterministic but has known bounds, the expected file uses an extended sentinel:

```
"<MASKED:nondeterministic-but-bounded: assertHeat(result.heat < 0.8 && result.heat > 0.0)>"
```

The harness parses the assertion expression in the sentinel value and evaluates it. This is used for the `remember_with_initial_heat` fixture to verify issue #14 P1 (heat should be significantly less than 1.0 for backfilled content).

## 4. STATUS markers

Expected files may have a `_capture_status` field with one of:

- `"TO-BE-CAPTURED-IN-PHASE-0-DAY-1"` — full capture blocked on infrastructure; only shape/invariant assertions active until then
- `"SHAPE-KNOWN-FROM-SOURCE"` — expected values derivable from reading source code; no live DB needed; full assertion active now

The harness treats `TO-BE-CAPTURED` files as shape-only tests. `SHAPE-KNOWN-FROM-SOURCE` files are full assertions.

## 5. Harness implementation reference

The parity harness must implement:

```typescript
function compareWithMasking(actual: unknown, expected: unknown, path: string): Divergence[] {
  // If expected is the sentinel string, assert key present and skip value
  if (expected === "<MASKED:nondeterministic>") {
    if (actual === undefined) return [{ path, kind: "missing_key" }];
    return [];
  }
  // If expected starts with "<MASKED:nondeterministic-but-bounded:", parse and evaluate assertion
  if (typeof expected === "string" && expected.startsWith("<MASKED:nondeterministic-but-bounded:")) {
    return evaluateBoundedAssertion(actual, expected, path);
  }
  // Recursive structural comparison for objects and arrays
  // ...
}
```

## 6. Fields never masked (always exact)

The following fields always carry exact expected values because they are deterministic from the source code logic and MUST match exactly to prove semantic equivalence:

| Field | Why exact | Example |
|---|---|---|
| `stored` (remember) | Boolean gate decision; deterministic for given gate rules | `false` for null content |
| `reason` (remember) | String enum; gate logic is deterministic | `"no_content"` |
| `action` (remember) | Enum: stored/merged/rejected | deterministic for forced=true |
| `coldStart` (methodology) | Boolean; deterministic from profiles existence | `true` for unknown cwd |
| `total` (recall) | `len(results)` — must equal the array length | derived invariant |
| `dry_run` (import) | Echo of input parameter | always matches input |
| `error` (import no-sessions) | Fixed string; deterministic early-return | `"no_sessions_found"` |
| `memories_decayed` (consolidation decay) | Always 0 in A3 lazy-heat design | `0` |
| `reason_for_zero` (consolidation decay) | Fixed string in A3 design | `"lazy_decay_via_effective_heat"` |
