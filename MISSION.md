# Worktree Mission — `tooling-ci`

---

## 1. Source

- **Source repo**: `github.com/cdeust/agentic-ai` (monorepo root at `/Users/cdeust/Developments/agentic-ai`)
- **Source paths** (exact files this worktree owns):
  - `eslint.config.js` — flat ESLint v9 config with TypeScript strict + layer-import rule
  - `vitest.config.ts` — workspace root vitest config
  - `packages/*/vitest.config.ts` — per-package vitest template
  - `parity-oracle/vitest.parity.config.ts` — parity oracle vitest config
  - `parity-oracle/cortex/recall.parity.test.ts` — stub parity test
  - `scripts/check-source-citations.sh` — pre-commit numeric-literal source-citation scanner
  - `scripts/check-layer-imports.ts` — standalone TypeScript AST walker for layer-import enforcement
  - `.husky/pre-commit` — Husky pre-commit hook
  - `package.json` — root devDependencies + scripts
  - `QUALITY_GATES.md` — Deming PDCA documentation for every quality gate
- **Source language**: TypeScript 5.x, Bash, JSON/YAML configuration
- **Lines of code (approx.)**: ~600 lines of new configuration and tooling
- **Cited papers / sources** (every `// source:` annotation in the source must travel):
  - `coding-standards.md §2.2` — Clean Architecture dependency rule (layer-import enforcement)
  - `coding-standards.md §4.1` — 500-line file-size limit
  - `coding-standards.md §4.2` — 50-line function-size limit
  - Martin, R. C. (2017). *Clean Architecture*. Prentice Hall. Chapters 15–23.

---

## 2. Target

- **Target package**: root monorepo tooling (not a `packages/*` package — this is the workspace-level quality harness)
- **Target language**: TypeScript (strict), ESLint flat config (JavaScript ESM), Bash
- **Public API surface** (exported symbols this worktree must produce):
  - `eslint.config.js` — consumed by `pnpm lint` via `eslint .`
  - `vitest.config.ts` — consumed by `pnpm test` via `vitest run`
  - `parity-oracle/vitest.parity.config.ts` — consumed by `pnpm parity`
  - `scripts/check-source-citations.sh` — invoked by `.husky/pre-commit`
  - `scripts/check-layer-imports.ts` — consumed by `pnpm layer-check` via `npx tsx`
- **Ports consumed**: none (tooling is a composition-root concern — it wires, not implements)
- **Ports provided**: quality signal on every `git commit` and every CI push

---

## 3. Acceptance Contract (load-bearing)

This worktree is **complete** when ALL of the following are true. No exceptions.

### 3.1 Functional parity
- [x] `pnpm lint` invokes ESLint v9 flat config and produces actionable output on violations.
- [x] `pnpm test` invokes Vitest workspace mode covering `packages/*/src/__tests__/`.
- [x] `pnpm parity` invokes `parity-oracle/vitest.parity.config.ts`.
- [x] `pnpm layer-check` invokes `scripts/check-layer-imports.ts` via `tsx`.
- [x] Pre-commit hook fires on `git commit` and blocks on source-citation violations.

### 3.2 Source-citation provenance
- [x] Layer-import rule documents its source (`coding-standards.md §2.2`).
- [x] File-size warn documents its source (`coding-standards.md §4.1`).
- [x] Every numeric threshold in shell scripts has a `# source:` comment.

### 3.3 Type contracts
- [x] `vitest.config.ts` and `scripts/check-layer-imports.ts` typecheck under `tsc --strict`.

### 3.4 Tests
- [x] Layer-import script includes a fixture-based test asserting that a deliberate violation is caught.
- [x] Parity oracle stub test file establishes the loading pattern for baseline data.

### 3.5 Layer rules
- [x] ESLint rule encodes: `core/` may not import `adapters/`, `mcp-servers/`, or sibling packages.
- [x] `check-layer-imports.ts` enforces the same rule as a standalone CI gate.

### 3.6 Style
- [x] `pnpm lint` passes on this worktree's own files.
- [x] `tsc --strict` passes on `.ts` files.
- [x] No file > 500 lines, no function > 50 lines.

---

## 4. Genius Panel

### 4.1 Truth-finding
- **`feynman`** — Confirm the layer-import AST walker correctly traces import paths and that the ESLint rule and the standalone script agree on the same set of violations. **Sign-off**: ☐
- **`popper`** — Construct adversarial fixture files (valid violations, false-positive non-violations, relative vs absolute imports, re-exports). Assert zero false negatives. **Sign-off**: ☐

### 4.2 Structural
- **`liskov`** — Verify the ESLint custom rule plugin interface is substitutable for any ESLint rule: no postcondition weakened, no exception class widened. **Sign-off**: ☐
- **`lamport`** — Confirm the pre-commit hook is idempotent and race-free under concurrent `git commit` invocations. **Sign-off**: ☐

### 4.3 Domain-relevant
- **Picked**: `boyd` (OODA loop — the quality gates are a control loop closing feedback on code changes)
- **Sign-off**: ☐

### 4.4 Engineering review (mandatory, runs after genius)
- `code-reviewer` — coding-standards.md compliance. **Sign-off**: ☐
- `test-engineer` — coverage + mutation survival for layer-import script. **Sign-off**: ☐
- `security-auditor` — N/A: ☐ (no auth/crypto/PII boundary touched)

---

## 5. Findings & Actions

| ID | Severity | Pattern that found it | Description | Status |
|---|---|---|---|---|
| F-001 | MED | deming | Layer-import ESLint rule does not catch re-exports through index barrels | open |
| F-002 | LOW | deming | Source-citation hook only scans staged `.ts` files; misses `.js` config files | open |

---

## 6. Merge Conditions

This worktree merges to `main` only when:

1. All 6 acceptance subsections (§3.1–§3.6) check out.
2. All genius panel members signed off (§4).
3. All CRIT and HIGH findings closed (§5).
4. A human reviewer approves the PR.

---

## 7. Known Risks / Open Questions

- The ESLint custom layer-import rule uses `no-restricted-imports` patterns; it cannot trace transitive re-exports. The standalone `check-layer-imports.ts` script is the authoritative gate for CI. ESLint rule is an editor-speed signal only.
- Vitest v4 workspace mode requires all per-package configs to use `defineConfig` from `vitest/config`, not `vite/config`. Ensure package installs are pinned.
- `madge` uses static import analysis; dynamic `require()` calls and `import()` expressions are not traced. Document as a known hole.

---

## 8. Daily Log

- **2026-04-26**: Initial tooling scaffold committed. ESLint flat config, Vitest workspace, parity oracle config, source-citation hook, layer-import script, Husky pre-commit, QUALITY_GATES.md.
