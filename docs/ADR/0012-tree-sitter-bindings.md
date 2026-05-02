# ADR-0012 — Tree-sitter Node.js bindings: native (`tree-sitter`) over WASM (`web-tree-sitter`)

**Status:** Accepted
**Date:** 2026-04-27
**Originated:** Phase 7 Group D — `packages/memory/src/codebase-analysis/ast-parser.ts` port-pending marker
**Affects:** `packages/memory/src/codebase-analysis/ast-parser.ts`, CI, production deploy checklist

---

## Context

The TypeScript port of `mcp_server/core/ast_parser.py` uses tree-sitter for
structured AST extraction (imports, definitions, call sites) across six
language grammars: Python, TypeScript, JavaScript, Go, Rust, Swift.

The Python source uses `tree_sitter_language_pack` — a single-wheel bundle
that ships all grammars. The TypeScript ecosystem offers two substrate choices:

**Option A — native Node.js bindings (`tree-sitter` + per-language grammar packages)**

The official tree-sitter Node.js API. Grammar packages ship pre-compiled
native `.node` modules (built by `node-gyp` / `node-pre-gyp`). Installed via
npm as `optionalDependencies`:

- `tree-sitter` (core binding)
- `tree-sitter-python`, `tree-sitter-typescript`, `tree-sitter-javascript`,
  `tree-sitter-go`, `tree-sitter-rust`, `tree-sitter-swift`

**Option B — WASM port (`web-tree-sitter`)**

The official WASM build of tree-sitter. Grammar `.wasm` blobs must be
loaded at runtime from disk or CDN. Supports any environment (browser,
Bun, Deno, edge runtimes) with no native compile step.

---

## Decision

**Use Option A (native Node.js bindings).** Degrade gracefully when native
modules are absent; fall back to the existing regex-based parser
(`codebase-parser.ts:parseFile`).

Rationale:

1. **Performance.** Native bindings are synchronous and allocation-free from
   the JS perspective. WASM parsing incurs serialization overhead on every
   `parse()` call and requires async initialization. The MCP server handles
   sequential per-file ingestion where latency compounds; native bindings
   keep per-file parse time in the single-digit-millisecond range for typical
   source files.

2. **API parity with the Python port.** The Python source calls `tree_sitter`
   synchronously. Native bindings expose the same synchronous interface
   (`parser.parse(buffer)`), preserving the structural equivalence of the
   port. WASM requires `await parser.parseAsync()`.

3. **Grammar version lock.** The native grammar packages (`tree-sitter-python@0.21`,
   etc.) are already pinned in `packages/memory/package.json` as
   `optionalDependencies`. These versions match the Cortex Python source
   grammar versions at port time. Switching to WASM would require matching
   `.wasm` blob versions separately, introducing a second version surface.

4. **Production deploy context.** The MCP server runs in a Node.js process
   on developer machines and CI runners — both environments perform a full
   `npm install` with native rebuild. The native pre-built binaries for
   `darwin-arm64`, `linux-x64`, and `win32-x64` are shipped by the grammar
   package maintainers. No custom `node-gyp` compilation is required for
   standard platforms.

5. **Graceful degradation is already implemented.** `ast-parser.ts:isAvailable()`
   probes `require("tree-sitter")` at runtime and returns `false` when the
   native module is absent. `_getExtractorAndTree()` returns `null` in that
   case, and the caller falls back to `parseFile()` (the regex parser). This
   means lightweight deploys (e.g., a stripped Docker image) continue to
   work with reduced extraction quality, without crashing.

---

## Consequences

### Accepted
- Native `.node` modules require platform-matched pre-built binaries. CI
  must target the same platform family as production (`linux/amd64` or
  `darwin/arm64`). The `optionalDependencies` classification means npm does
  not fail if native modules are unavailable.
- On platforms without pre-built binaries (e.g., `musl/alpine`), the module
  falls back to regex parsing. This is acceptable because the memory MCP
  server is not a primary use case for Alpine containers.
- Grammar packages are major-version pinned (`^0.21.x`). Minor bumps are
  safe; major bumps (e.g., tree-sitter 0.22) may require re-evaluation.

### Rejected
- WASM (`web-tree-sitter`) is not selected. Cross-platform availability is
  not a current requirement; all target deploy environments are standard
  Node.js installations. If a future Phase adds a browser-based or edge-runtime
  target that requires tree-sitter, this ADR should be revisited.

---

## Marker closure

The `port-pending` comment in `ast-parser.ts` line 17 ("AST SUBSTRATE DECISION
(port-pending → tree-sitter Node.js bindings)") is closed by this ADR.
The implementation already uses native bindings with graceful degradation —
no code change is required; the design decision was the missing artifact.
The marker comment will be replaced with a reference to this ADR.
