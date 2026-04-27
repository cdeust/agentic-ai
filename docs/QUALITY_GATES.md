# Quality Gates

Order of operations for any local check that touches `packages/`:

1. **Install first** — `pnpm install` at the workspace root before any per-package
   `pnpm --filter ... <script>` invocation. Per-package commands inherit the
   workspace's `node_modules` symlink graph; without the install, `tsc` will
   emit dozens of `Cannot find module '...'` errors that look like real type
   errors but are dependency-resolution misses (Phase 5 cross-audit F-001).

2. **Build is the type gate** — `pnpm -r --workspace-concurrency=1 build` exits 0
   on a clean tree. If it fails, fix the type errors before any other check.

3. **Test is the behaviour gate** — `pnpm test` from the workspace root exits 0.
   All 742 currently-passing tests must remain passing; new tests must be added
   alongside any handler/port/adapter change.

4. **Plugin manifest lint is the contract gate** — `.claude-plugin/` JSON files
   are scanned for the forbidden `${VAR:-fallback}` pattern (ADR-0010).

5. **Lint and parity** — currently advisory; will become hard gates as the
   relevant tooling lands (`port/tooling-ci`, `port/parity-baseline`).

CI runs all five in this order; any hard gate that fails stops the pipeline.
