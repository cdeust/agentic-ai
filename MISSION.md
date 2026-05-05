# Worktree Mission — `exact-cortex-eng12-handlers-hooks`

> Copy this template into every new worktree as `worktrees/<branch>/MISSION.md`.
> The worktree may NOT begin code changes until every section below is filled in
> and reviewed by `architect` + `liskov`.

---

## 1. Source

- **Source repo**: `<github.com/cdeust/Cortex | automatised-pipeline | …>`
- **Source paths** (exact files this worktree owns):
  - `mcp_server/handlers/<file>.py`
  - `mcp_server/handlers/<file>.py`
- **Source language**: Python 3.x | Rust | Bash
- **Lines of code (approx.)**:
- **Cited papers / sources** (every `# source:` annotation in the source must travel):

---

## 2. Target

- **Target package**: `packages/memory/src/<module>/`
- **Target language**: TypeScript (strict)
- **Public API surface** (exported symbols this worktree must produce):
  - `function <name>(): <type>`
  - `class <Name>`
  - `interface <Name>`
- **Ports consumed** (declared in `packages/core/src/ports/`):
- **Ports provided** (this module's interface to the rest of the monorepo):

---

## 3. Acceptance Contract (load-bearing)

This worktree is **complete** when ALL of the following are true. No exceptions.

### 3.1 Functional parity
- [ ] Parity-oracle suite under `parity-oracle/<module>/` passes 100%.
- [ ] Every input in the Day-0 frozen fixture produces byte-identical output (modulo timestamps and SHA-of-bytes fields, which the oracle masks).
- [ ] Adversarial corpus from `popper`'s falsification panel produces zero divergences vs Python implementation.

### 3.2 Source-citation provenance
- [ ] Every `# source:` annotation from the Python source is preserved verbatim as a `// source:` annotation in TS.
- [ ] Every cited paper file (PDFs / arXiv markdown) is present at the same relative path under `packages/memory/sources/`.
- [ ] Cite-check pass: `feynman` rederives at least one formula per file from the cited paper and confirms the TS implementation matches.

### 3.3 Type contracts
- [ ] Public types match the frozen Day-0 schemas in `packages/shared-contracts/`.
- [ ] No `any`, no `unknown` outside of explicit Zod parse-then-narrow boundaries.
- [ ] `liskov` audit: every adapter substitutable for its port; no postcondition weakened.

### 3.4 Tests
- [ ] Unit tests for every public function (≥1 happy path, ≥1 edge case, ≥1 failure mode).
- [ ] Contract tests for every port implemented.
- [ ] Test count delta vs source: `tests_new ≥ tests_source` (no test silently dropped).
- [ ] Mutation survival check: pick 3 mutations, confirm at least one test fails for each.

### 3.5 Layer rules
- [ ] `core/` imports stdlib only.
- [ ] `adapters/` may import third-party (pg, markdown-it, yaml).
- [ ] `mcp-servers/` is the ONLY composition root.
- [ ] No circular imports across packages (verified by `madge --circular`).

### 3.6 Style
- [ ] `pnpm lint` passes with zero warnings.
- [ ] `tsc --strict` passes.
- [ ] Every numeric constant ≥3 significant digits has a `// source:` comment.
- [ ] No file > 500 lines, no function > 50 lines (`coding-standards.md §4.1, §4.2`).

---

## 4. Genius Panel

This worktree's mandatory review panel. Every panel member must explicitly sign off
in this section before merge.

### 4.1 Truth-finding
- **`feynman`** — Rederive at least one formula in this module from its cited paper. Goal: confirm the TS port preserves the original mathematical content, not just the surface API. **Sign-off**: ☐
- **`popper`** — Construct an adversarial input corpus (~20 cases) that should distinguish the TS port from the Python original. Run both, assert zero divergences. **Sign-off**: ☐

### 4.2 Structural
- **`liskov`** — Verify every adapter contract: substitutability, postcondition preservation, no exception class strengthening. **Sign-off**: ☐
- **`<lamport | noether>`** — Pick one based on module:
  - `lamport` for modules with cross-process / cross-MCP timing (recall, hooks, automation).
  - `noether` for modules with conserved invariants (consolidation, persistence, schema migrations).
  **Sign-off**: ☐

### 4.3 Domain-relevant (pick ONE based on module)
- `pearl` — for causal-modeling modules (methodology, profile)
- `kekule` / `mandelbrot` — for graph / structural modules (navigation, recall fusion)
- `propp` / `bruner` — for narrative / story-shape modules (narrative)
- `champollion` / `ventris` — for decoder modules (import)
- `darwin` / `margulis` / `meadows` — for slow-change / consolidation modules
- `boyd` / `simon` / `kay` — for control-loop modules (automation, hooks)

**Picked**: `<pattern>`
**Sign-off**: ☐

### 4.4 Engineering review (mandatory, runs after genius)
- `code-reviewer` — coding-standards.md compliance. **Sign-off**: ☐
- `test-engineer` — coverage + mutation survival. **Sign-off**: ☐
- `security-auditor` — runs IF this module touches auth, crypto, or PII boundaries (most don't). **Sign-off**: ☐ N/A: ☐

---

## 5. Findings & Actions

| ID | Severity | Pattern that found it | Description | Status |
|---|---|---|---|---|
| F-001 | | | | open / closed |

CRIT and HIGH must be closed before merge. MEDs may be deferred with an explicit follow-up issue.

---

## 6. Merge Conditions

This worktree merges to `main` only when:

1. All 6 acceptance subsections (§3.1–§3.6) check out.
2. All genius panel members signed off (§4).
3. All CRIT and HIGH findings closed (§5).
4. The parity-oracle CI run on the merge commit shows zero divergence vs Python source.
5. A human reviewer (you) approves the PR.

Merge order across worktrees is fixed in `docs/PHASE_PLAN.md` §4 — do not merge out of order.

---

## 7. Known Risks / Open Questions

- (worktree owner: list anything ambiguous in the source that requires a judgment call here)

---

## 8. Daily Log

(append-only; one paragraph per work session)

- **YYYY-MM-DD**: ...
