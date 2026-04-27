# QUALITY_GATES.md — Deming PDCA Documentation

> "Build quality into the process rather than inspecting it in afterward."
> — W. Edwards Deming, *Out of the Crisis*, Point 3.

This document describes each quality gate in the agentic-ai monorepo:
what variation it catches, what it misses, when it fires, and what
corrective action to take when it fails.

**Deming framing:** Each gate is a feedback loop that classifies variation.
Common-cause failures (the gate fires on every PR because the process produces
them systematically) indicate the gate is correctly measuring a system property
— and that the system needs redesign, not individual blame. Special-cause failures
(the gate fires on one PR because of a specific event) indicate an event to investigate.

---

## 1. Gate Inventory

### 1.1 Lint (`pnpm lint`)

| Property | Value |
|---|---|
| **Command** | `eslint . --max-warnings=0` |
| **Config** | `eslint.config.js` (ESLint v9 flat config) |
| **Response time** | On-save (editor); on commit (Husky pre-commit); in CI (lint step) |
| **Failure mode caught** | (a) TypeScript strict violations. (b) Unused variables. (c) Forbidden console.* calls. (d) Layer-import violations (direct path, non-transitive). (e) Magic numbers without source comments. (f) File size > 500 lines. |

**PDCA loop:**
- **Plan**: ESLint config declares rules. Prediction: all layer violations caught at source.
- **Do**: `pnpm lint` runs on each commit.
- **Check**: Exit code 0 = pass; non-zero = violations with file/line/rule.
- **Act**: Fix the reported violation. If the violation is in a core/ file importing adapters/, introduce a port interface in core/ (coding-standards.md §2.3).

**What this gate does NOT catch:**
- Transitive violations through barrel re-exports (use `pnpm layer-check` for that).
- Runtime type errors that TypeScript cannot infer (use `pnpm test`).
- Dynamic `import()` or `require()` — these are banned by coding-standards.md §7.2.
- Violations in `.js` config files (ESLint config itself, Husky hooks).

**Corrective action when gate fails:**
1. Read the violation message — it includes the rule name and a fix hint.
2. If it is a layer-import violation: declare a port in core/ and implement it in adapters/. Do NOT add an ESLint disable comment.
3. If it is a magic number: add `// source: <citation>` or name the constant.
4. If the gate fires on every PR (common-cause variation): investigate whether the rule threshold is wrong or the process that produces the violations needs redesign.

---

### 1.2 Typecheck (`pnpm typecheck`)

| Property | Value |
|---|---|
| **Command** | `pnpm -r exec tsc --noEmit` |
| **Config** | `tsconfig.base.json` (strict mode, noImplicitAny, noUncheckedIndexedAccess) |
| **Response time** | On commit (Husky pre-commit); in CI (after lint) |
| **Failure mode caught** | Type mismatches, missing properties, unchecked array access, implicit any, incorrect return types, missing null checks. |

**PDCA loop:**
- **Plan**: Prediction — strict TypeScript eliminates an entire class of runtime errors (null dereference, missing-case, wrong shape) before they reach production.
- **Do**: tsc runs on each commit.
- **Check**: Exit code 0 = no errors; non-zero = type errors with file/line.
- **Act**: Fix the type error at its source. Never use `// @ts-ignore` without an ADR.

**What this gate does NOT catch:**
- Logic errors that are type-correct (a function that returns the wrong valid value).
- Runtime errors in third-party code with incorrect type declarations.
- Errors in test files (excluded from tsconfig.base.json by default).

**Corrective action when gate fails:**
1. Read the error: `error TS<code>: <message>`. Look up the TS error code if needed.
2. Fix at the correct layer — type errors in core/ should not be fixed by adding `as unknown` casts.
3. If the type error is common-cause (fires on every new file because of a structural pattern): redesign the interface, not the cast.

---

### 1.3 Test (`pnpm test`)

| Property | Value |
|---|---|
| **Command** | `vitest run` |
| **Config** | `vitest.config.ts` (workspace root) + `packages/*/vitest.config.ts` |
| **Response time** | In CI (test step, after lint) |
| **Failure mode caught** | Unit-test assertions, edge cases, failure modes, contract violations between packages. |

**PDCA loop:**
- **Plan**: Prediction — unit tests for each public function catch regressions introduced by refactoring. Tests are executable specifications.
- **Do**: `vitest run` in CI.
- **Check**: Each test suite produces pass/fail; coverage is optional per package.
- **Act**: A failing test identifies the exact assertion. Fix the code, not the test (unless the test was wrong — document why in a commit message).

**What this gate does NOT catch:**
- Parity divergences vs Python source (use `pnpm parity`).
- Performance regressions (no benchmark gate yet — see §5 Future Gates).
- Flaky tests caused by hidden shared state or timing assumptions — these are common-cause variation in the test infrastructure, not special-cause events. Fix the test infra.
- Integration failures (real DB, real MCP connection) — requires a separate integration test stage.

**Corrective action when gate fails:**
1. Read the failing assertion: what was expected, what was actual.
2. Classify: is this a test bug or a code bug? If the code changed correctly and the test is wrong, update the test AND document why in the commit.
3. If the test fails intermittently (flaky): do NOT retry-loop. Diagnose the non-determinism. Common causes: shared state, timer mocks not reset, async leaks.
4. If ALL tests fail (e.g., import error): check the build step first.

---

### 1.4 Parity Oracle (`pnpm parity`)

| Property | Value |
|---|---|
| **Command** | `vitest run --config parity-oracle/vitest.parity.config.ts` |
| **Config** | `parity-oracle/vitest.parity.config.ts` |
| **Response time** | In CI (parity oracle step, after test) |
| **Failure mode caught** | Divergences between the TypeScript port and the Python source baseline. Byte-level output differences (modulo masked fields: timestamps, SHA-of-bytes, session IDs). |

**PDCA loop:**
- **Plan**: Prediction — a correct port produces identical outputs to the source for all fixtures in the Day-0 frozen baseline. Any divergence indicates a porting error or an undocumented behavioral change.
- **Do**: Load fixtures from `PARITY_BASELINE_DIR`, run both implementations, compare.
- **Check**: Each parity test compares `stripMasked(actual)` to `stripMasked(expected)`. Failure = divergence.
- **Act**: Investigate the divergence. Determine whether the TS port is wrong (fix the port) or the Python baseline has a bug (document in MISSION.md §5 as a Finding).

**What this gate does NOT catch:**
- Performance divergences (the parity oracle compares outputs, not latency or memory).
- New behaviors not covered by the Day-0 fixture set (add fixtures to cover them).
- Divergences in masked fields (timestamps, hashes) — these are intentionally excluded.

**Corrective action when gate fails:**
1. Run `PARITY_BASELINE_DIR=<path> pnpm parity` locally to reproduce.
2. Inspect which fixture input produced the divergence.
3. Add a debug log in the TS port to trace the diverging code path.
4. If the Python source has a bug that the TS port should NOT replicate: document in MISSION.md §5 and update the fixture.

---

### 1.5 Source-Citation Check (pre-commit hook)

| Property | Value |
|---|---|
| **Command** | `scripts/check-source-citations.sh` (invoked by `.husky/pre-commit`) |
| **Config** | Inline regex in `check-source-citations.sh` |
| **Response time** | On commit (pre-commit hook, before lint) |
| **Failure mode caught** | Numeric literals with ≥3 significant digits in staged `.ts` files that lack an adjacent `// source:` comment. |

**PDCA loop:**
- **Plan**: Prediction — requiring source citations at commit time prevents unsourced constants from accumulating. Once a constant is in the repo without a source, future readers cannot verify it. The hook enforces the standard before the constant enters history.
- **Do**: Scan staged `.ts` files on each `git commit`.
- **Check**: Exit code 0 = all constants sourced; exit code 2 = violation list printed.
- **Act**: Add `// source: <citation>` on the line or the line before the constant. If the constant came from a paper, cite it. If empirically measured, cite the date and benchmark.

**What this gate does NOT catch:**
- Unsourced constants in `.js`, `.sh`, or `.json` files.
- Named constants where the name obscures the source (e.g., `const TIMEOUT = 30_000` without a source comment is still caught; `const THIRTY_SECONDS = 30_000` without a source comment is also caught).
- Constants in test files (test files are excluded by design).
- Constants that slip in via transitive dependency updates.

**Corrective action when gate fails:**
1. Read the violation: `file:line: <the offending line>`.
2. Add `// source: <citation>` on that line or the line above.
3. If the number has no known source, ask: "what empirical measurement or paper justifies this value?" If none exists, the constant should be a configuration value with a documented default, not a hardcoded literal.

---

### 1.6 Layer-Import Gate (`pnpm layer-check`)

| Property | Value |
|---|---|
| **Command** | `npx tsx scripts/check-layer-imports.ts` |
| **Config** | Inline in `scripts/check-layer-imports.ts` |
| **Response time** | In CI (runs as a separate gate after lint, before test) |
| **Failure mode caught** | Layer-import violations traced via TypeScript AST walker. More thorough than ESLint: catches violations through relative paths AND workspace package names. Self-test mode (`--self-test`) verifies the classifier itself. |

**PDCA loop:**
- **Plan**: Prediction — a standalone AST-walking gate catches violations that the ESLint `no-restricted-imports` rule misses (barrel re-exports, relative path aliasing). Running it in CI makes violations loud rather than advisory.
- **Do**: Walk `packages/*/src/` on each CI push.
- **Check**: Exit code 0 = no violations; exit code 2 = structured violation report.
- **Act**: Same as the lint layer-import rule — introduce a port, move the concrete import to the outer layer.

**Known holes (documented — every gate must document what it misses):**
1. Dynamic `require()` and `import()` expressions are NOT traced. These are banned by coding-standards.md §7.2; the ESLint rule catches them.
2. Re-exports through external npm packages are NOT traced (full call-graph analysis required; not applicable to workspace packages).
3. Circular imports WITHIN a layer are not flagged. Use `madge --circular` for that.
4. Package names that do not match the `core/adapters/shared/mcp-servers` pattern are classified as `Unknown` and produce no violation. New packages must follow the naming convention or the classifier must be updated.

---

## 2. Gate Response Times

| Gate | On save | On commit | In CI |
|---|---|---|---|
| Lint (ESLint) | Yes (editor plugin) | Yes (Husky) | Yes |
| Typecheck (tsc) | Yes (editor) | Yes (Husky) | Yes |
| Source-citation | No | Yes (Husky) | No |
| Test (Vitest) | On-save watch mode | No | Yes |
| Parity oracle | No | No | Yes |
| Layer-import (AST) | No | No | Yes |

**Deming observation on response time:** the fastest feedback loop (on-save, ~100ms) catches the most violations cheapest. Every gate that can move earlier should. The layer-import AST walker is ~3s on a typical package — fast enough for pre-commit if desired. Current placement is CI for now; move to pre-commit if the false-positive rate is acceptably low.

---

## 3. Session Bug Cross-Reference

This table maps the bugs surfaced in the development session to the gate that would have caught each one, and the gate that did catch it (or the failure mode when no gate caught it).

| Bug | Description | Gate that would catch it | Gate that actually caught it | Notes |
|---|---|---|---|---|
| `no_self_referencing_deps` regex walking across markdown table rows | The regex for detecting self-referencing deps in plugin validation was not anchored to the start of a logical unit; it matched text inside markdown `|...|` table rows as if they were import specifiers. | **Layer-import gate** (AST walker, not regex), **Lint** (no-restricted-imports on the import statement), **Test** (unit test for the regex boundary case) | Manual code review during cross-audit | Root cause: regex-based analysis of structured text is fragile. The AST walker in `check-layer-imports.ts` avoids this by using the TypeScript compiler's own parser. |
| Missing `${VAR:-fallback}` shell expansion | A shell script used `$VAR` where it needed `${VAR:-fallback}`, causing silent failure when `VAR` was unset. `set -euo pipefail` would have caught the unset-variable error at runtime. | **Pre-commit hook** (`set -euo pipefail` forces errors on unset variables), **CI test** (integration test that sets env to empty) | Runtime failure in production script | The `check-source-citations.sh` and `.husky/pre-commit` both use `set -euo pipefail`. New shell scripts MUST include this header. |
| Plugin version drift | A plugin was developed at version 0.2.1 but the CI matrix referenced 0.1.x version constraints, causing installation failure on fresh clones. | **Lint** (if version is encoded as a numeric constant, source-citation check would flag it), **CI install step** (`pnpm install --frozen-lockfile` fails on version mismatch) | CI failure on fresh clone | Mitigated by `pnpm install --frozen-lockfile` in CI. The source-citation hook would have flagged the hardcoded version string `0.2.1` if written as a numeric literal without a `// source:` comment. |

---

## 4. Gate Failure Classification (Deming Lens)

When a gate fails repeatedly across PRs, classify the variation before reacting:

| Pattern | Classification | Correct response |
|---|---|---|
| Gate fails on every PR for the same rule | **Common-cause** — the process systematically produces this violation | Redesign the process (e.g., add a scaffold generator that produces correctly-layered files) — do NOT blame the author |
| Gate fails on one PR because of a specific new feature | **Special-cause** — the feature introduced a deliberate boundary crossing | Investigate: is the crossing intentional (new pattern, needs ADR) or accidental (fix it)? |
| Gate fails intermittently (flaky) | **Common-cause in the test infrastructure** | Fix the infrastructure (shared state, timing, environment) — do NOT add retry logic |
| Gate threshold too tight (fires on clearly-correct code) | **Special-cause in the gate itself** | Recalibrate the rule threshold; document the change with a PDSA prediction |

**Tampering warning:** if the response to a consistently-failing gate is to add an ESLint disable comment, a `// @ts-ignore`, or a `skip()` in a test, that is Deming tampering — adjusting individual outputs while leaving the system that produces violations unchanged. Tampering increases technical debt. Fix the system.

---

## 5. Future Gates (backlog, not yet implemented)

These gaps were identified during gate design. They are documented here so future hardening has a target list.

| Gate | Failure mode it would catch | Why deferred |
|---|---|---|
| `pnpm circular-check` (`madge --circular`) | Circular imports within and across packages | madge dependency not yet installed; add to package.json devDependencies |
| Performance benchmark gate | Latency/memory regressions vs baseline | Requires benchmark infrastructure (package/benchmark) to be ported first |
| Integration test gate | Real MCP connection failures, DB migration errors | Requires running infrastructure in CI (Docker Compose or test containers) |
| `.js` source-citation scan | Unsourced constants in config files | Current hook only scans `.ts`; extend to `.js` in a follow-up |
| Mutation survival check | Tests that pass despite wrong implementation | Requires Stryker or equivalent; deferred until test suite reaches baseline coverage |
