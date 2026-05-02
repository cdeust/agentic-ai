# ADR-0013 — Embedding runtime for TypeScript port

**Status**: Accepted  
**Date**: 2026-04-27  
**Deciders**: Phase 7 Group A (port/phase7-group-a-embeddings)  
**Context**: `docs/PHASE_7_TRACKING.md §Group A`

---

## Context

Phase 7 Group A requires a TypeScript embedding runtime to close 16 `port-pending`
markers across the Cortex memory port. The Cortex Python source uses
`sentence-transformers` with the `all-MiniLM-L6-v2` model (384-dimensional
float32 vectors, L2-normalised). Three runtimes were evaluated:

1. **`@xenova/transformers`** (TransformerJS v2/v3) — pure-JS port of HuggingFace
   Transformers; runs ONNX model files inside Node.js via `onnxruntime-node`.
   Supports `Xenova/all-MiniLM-L6-v2` (the same model Cortex uses, published by
   Xenova on HuggingFace as an ONNX conversion).
   Model card: https://huggingface.co/Xenova/all-MiniLM-L6-v2
   Original sentence-transformers model card:
   https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2

2. **`onnxruntime-node` + manual model files** — lower-level; same ONNX runtime
   as option 1 but requires manually loading tokeniser JSON, vocab files,
   and the ONNX graph. Identical quality; more boilerplate.

3. **HTTP sidecar to a Python process** — delegates embedding to the Cortex Python
   server via an HTTP call. Introduces a hard runtime dependency on a running
   Python process, breaks the offline-capable design of the TS memory port, and
   adds latency plus failure modes (network, process restart). Rejected.

## Decision

Use **`@xenova/transformers`** (option 1).

### Rationale

- **Vector compatibility**: `Xenova/all-MiniLM-L6-v2` is a published ONNX
  conversion of the exact model Cortex uses. Vectors produced by this TS adapter
  are bit-compatible with Cortex Python vectors for the same input text (both
  pipelines produce L2-normalised float32 384-dimensional vectors).
  Source: Xenova model card — https://huggingface.co/Xenova/all-MiniLM-L6-v2
  (listed as ONNX export of `sentence-transformers/all-MiniLM-L6-v2`).

- **No native compilation**: `@xenova/transformers` bundles `onnxruntime-node`
  which ships pre-compiled native bindings for macOS (arm64/x64), Linux x64/arm64,
  and Windows x64. No Python, no separate build step.

- **npm-installable**: single `npm install @xenova/transformers`; no system
  dependencies, no separate process. Works inside the existing pnpm monorepo.

- **Lazy loading**: the pipeline is constructed on first `embed()` call; `import`
  statements do not trigger model download or ONNX session initialisation.

- **Offline-safe**: model files are cached to a stable path under the user's home
  directory (`~/.cache/huggingface/hub`), not the repository. Subsequent
  invocations skip the download. The `TRANSFORMERS_OFFLINE=1` env var prevents
  network access in CI.

- **Option 2** (manual onnxruntime-node) offers no quality advantage and adds
  ~200 lines of tokeniser boilerplate. The decision criterion from task spec is
  "vector-compatible with Python source at minimum boilerplate."

## Consequences

- `@xenova/transformers` is added as a **regular dependency** of
  `@agentic/memory` (not optional) because the embedding engine is required for
  correct vector-search behaviour. Callers that do not use vector search incur
  the npm dependency but not the model download (lazy loading).

- Model files (~90 MB for `all-MiniLM-L6-v2`) are downloaded to
  `~/.cache/huggingface/hub` on first embed call.  CI gates the live-model test
  behind `process.env.AGENTIC_EMBED_LIVE` to prevent downloads in automated
  pipelines.

- The `EmbeddingEngine` interface is declared in `@agentic/core` (the port layer);
  the `TransformersEmbeddingEngine` adapter lives in
  `packages/memory/src/infrastructure/`. This preserves the inward-dependency
  rule: core never imports infrastructure.

- The embedding dimension (384) and model identifier
  (`Xenova/all-MiniLM-L6-v2`) are constants in the adapter annotated with
  `// source:` citations per coding-standards.md §8.

## Rejected alternatives

- **`onnxruntime-node` + manual model files** (option 2): equivalent quality,
  significantly more boilerplate, no advantage.
- **HTTP sidecar** (option 3): runtime Python dependency, fragile, breaks
  offline operation, adds failure modes. Refused per the principle that each TS
  package must be deployable without a companion process.
