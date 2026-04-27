# Worktree Mission — `port/migrate-prd-spec`

> Phase 2 of the monorepo migration. This worktree owns the migration plan that
> brings `prd-spec-generator` into `packages/prd-pipeline/` with full commit
> history preserved. It delivers a plan + script that another operator can run
> from these committed deliverables alone. No code is executed during plan
> authoring.

---

## 1. Source

- **Source repo**: `github.com/cdeust/prd-spec-generator`
- **Local path**: `/Users/cdeust/Developments/prd-spec-generator`
- **Source paths** (all paths this migration moves):
  - `packages/benchmark/`       — `@prd-gen/benchmark`
  - `packages/core/`            — `@prd-gen/core`
  - `packages/ecosystem-adapters/` — `@prd-gen/ecosystem-adapters`
  - `packages/mcp-server/`      — `@prd-gen/mcp-server`
  - `packages/meta-prompting/`  — `@prd-gen/meta-prompting`
  - `packages/orchestration/`   — `@prd-gen/orchestration`
  - `packages/skill/`           — `@prd-gen/skill`
  - `packages/strategy/`        — `@prd-gen/strategy`
  - `packages/validation/`      — `@prd-gen/validation`
  - `packages/verification/`    — `@prd-gen/verification`
  - `mcp-server/index.js`       — pre-built ESM bundle (marketplace install path)
  - `mcp-server/package.json`   — bundle manifest
  - `skill-config.json`         — root skill configuration
  - `.claude-plugin/plugin.json` — Claude marketplace plugin manifest
  - `.claude-plugin/marketplace.json` — marketplace listing metadata
  - `.mcp.json`                 — MCP server configuration
  - `tsconfig.base.json`        — TypeScript base config
  - `vitest.workspace.ts`       — vitest workspace definition
  - `docs/`, `assets/`, `commands/`, `*.md` — documentation
  - `.github/`                  — CI/CD workflows and templates
- **Source language**: TypeScript (strict, Node16 module resolution), JSON config, Shell
- **Lines of code (approx.)**: ~8,000 TS source lines across 10 packages
- **Pre-migration commit count**: 17 commits, linear history, single branch (main)
- **Landmark commits** (used for post-migration verification):
  | Short SHA | Full SHA | Subject |
  |---|---|---|
  | a766082 | a7660827c6ee5dac64731ca39e6e456e8ba0ad3d | Initial release: PRD Spec Generator v2.0.0 |
  | f971257 | f9712570720ad72f5d6daf9260e035e24caec2d6 | Phase 3 + 4: deterministic pipeline reducer |
  | 6c41cb7 | 6c41cb72368f67353c85739cada4ba136e6c7199 | Marketplace plugin distribution + bundle reproducibility |
  | 2c3d83b | 2c3d83b2868533b3e05f7534b2741e0addbfaf5c | Remove license-tier system + Cowork-mode |
  | 342f15f | 342f15fa8e544b377ad41a6921ab5ab20f7dc056 | Add preflight step that probes Cortex (HEAD) |
- **Cited papers / sources**: All `// source:` annotations in TS source files must
  travel with the code. No separate PDF assets found in the source repo; citations
  are inline code comments. The `skill-config.json` references
  "MIT/Stanford/Harvard/Anthropic/OpenAI/DeepSeek (2024-2025)" as research bases
  for strategy prioritization.

---

## 2. Target

- **Target monorepo**: `github.com/cdeust/agentic-ai`
- **Local path**: `/Users/cdeust/Developments/agentic-ai`
- **Target package root**: `packages/prd-pipeline/`
- **Post-migration layout**:
  ```
  packages/prd-pipeline/
    packages/benchmark/         @agentic/prd-benchmark
    packages/core/              @agentic/prd-core
    packages/ecosystem-adapters/ @agentic/prd-ecosystem-adapters
    packages/mcp-server/        @agentic/prd-mcp-server
    packages/meta-prompting/    @agentic/prd-meta-prompting
    packages/orchestration/     @agentic/prd-orchestration
    packages/skill/             @agentic/prd-skill
    packages/strategy/          @agentic/prd-strategy
    packages/validation/        @agentic/prd-validation
    packages/verification/      @agentic/prd-verification
    mcp-server/index.js         (bundle — preserved as-is)
    mcp-server/package.json
    skill-config.json
    .claude-plugin/plugin.json  (renamed from root .claude-plugin/plugin.json)
    .mcp.json
    tsconfig.base.json
    vitest.workspace.ts
    package.json                (new: workspace root for prd-pipeline sub-workspace)
  ```
- **Target language**: TypeScript (strict, NodeNext module resolution per monorepo standard)
- **Public API surface** (exported from `@agentic/prd-mcp-server`):
  - 17 MCP tools: `get_config`, `read_skill_config`, `check_health`,
    `get_prd_context_info`, `list_available_strategies`, `validate_prd_section`,
    `validate_prd_document`, `get_quality_history`, `get_strategy_effectiveness`,
    `coordinate_context_budget`, `map_failure_to_retrieval`, `start_pipeline`,
    `submit_action_result`, `get_pipeline_state`, `plan_section_verification`,
    `plan_document_verification`, `conclude_verification`
- **Ports consumed**: none currently (self-contained)
- **Ports provided**: MCP stdio transport at `packages/prd-pipeline/mcp-server/index.js`

---

## 3. Acceptance Contract (load-bearing)

This worktree is **complete** when ALL of the following are true. No exceptions.

### 3.1 History preservation
- [ ] Post-migration `git log --all -- packages/prd-pipeline/ | wc -l` shows the 17
      rewritten commits plus any monorepo-side commits.
- [ ] All 5 landmark commits above appear in `git log --all --oneline packages/prd-pipeline/`
      (subjects match exactly; SHAs will differ because filter-repo rewrites them).
- [ ] Causal order is preserved: the topological sort of rewritten commits is identical
      to the source repo's linear order (oldest = a766082 analog, newest = 342f15f analog).

### 3.2 Namespace rename
- [ ] `grep -r "@prd-gen/" packages/prd-pipeline/` returns zero matches.
- [ ] All 10 package names follow `@agentic/prd-*`.
- [ ] Rename is a SEPARATE commit from the subtree merge.

### 3.3 Test count
- [ ] `pnpm test` in monorepo shows ≥ 267 passing (source repo baseline).

### 3.4 Bundle path
- [ ] `packages/prd-pipeline/mcp-server/index.js` exists and is executable.
- [ ] `.mcp.json` `args` path resolves correctly relative to the new install root.

### 3.5 Plugin manifest
- [ ] `.claude-plugin/plugin.json` has been rewritten to the monorepo convention
      at `packages/prd-pipeline/.claude-plugin/plugin.json`.
- [ ] `mcpServers` field still points to `mcp-server/index.js` (relative to plugin root).

### 3.6 Workspace integration
- [ ] Root `pnpm-workspace.yaml` includes `packages/prd-pipeline/packages/*` (or a
      glob that covers it).
- [ ] `pnpm install --frozen-lockfile` succeeds from the monorepo root.

---

## 4. Genius Panel

### 4.1 Truth-finding
- **`feynman`** — Verify that the bundle path in `.mcp.json` resolves to the correct
  `index.js` after path rewrite. **Sign-off**: open
- **`popper`** — Construct adversarial inputs for the namespace-rename codemod (edge
  cases: scoped imports in tsconfig paths, pnpm-lock.yaml references, dist/ .d.ts files).
  **Sign-off**: open

### 4.2 Structural
- **`liskov`** — Verify all workspace:* cross-references in package.json files resolve
  after rename. **Sign-off**: open
- **`lamport`** — Verify happens-before ordering is preserved (commit graph topology
  after filter-repo rewrite matches source). **Sign-off**: open

### 4.3 Domain-relevant
- **`noether`** — Conserved quantity: test count must not decrease. Verify vitest
  workspace config covers all packages after migration. **Sign-off**: open

### 4.4 Engineering review
- `code-reviewer` — coding-standards.md compliance. **Sign-off**: open
- `test-engineer` — coverage + test count delta. **Sign-off**: open

---

## 5. Findings & Actions

| ID | Severity | Pattern | Description | Status |
|---|---|---|---|---|
| F-001 | HIGH | lamport | `module` in source tsconfig.base.json is `Node16`; monorepo uses `NodeNext`. These are compatible but the rename commit must update the tsconfig to match monorepo standard. | open |
| F-002 | MED | noether | `packages/orchestration/src/handlers/preflight.ts` added in HEAD commit (342f15f) — ensure it is included in the filter-repo output and not silently dropped by any `.gitattributes` merge strategy. | open |
| F-003 | MED | feynman | `mcp-server/index.js` is a committed binary-ish ESM bundle. filter-repo preserves it; but if operator regenerates the bundle post-migration (pnpm bundle), the output path must be verified against `.mcp.json`. ADR-001 covers this. | open |
| F-004 | LOW | liskov | `packages/skill/package.json` has no `type: module` field and no build script — it is a config-only package. Verify it does not break workspace resolution after rename. | open |

---

## 6. Merge Conditions

1. All 6 acceptance subsections (§3.1–§3.6) pass.
2. All genius panel members signed off (§4).
3. All CRIT and HIGH findings closed (§5).
4. VERIFICATION.md checklist runs clean.
5. Human reviewer approves the PR.

---

## 7. Known Risks / Open Questions

- **filter-repo availability**: `git filter-repo` is a third-party tool (not bundled
  with git). The SCRIPT.sh includes a preflight check and aborts with instructions
  if it is missing.
- **pnpm lockfile**: after adding 10 new packages, `pnpm install` will regenerate
  `pnpm-lock.yaml`. The script commits this change separately with a clear message.
- **tsconfig module mismatch**: see F-001. The rename commit also patches
  `tsconfig.base.json` inside `packages/prd-pipeline/`.
- **`better-sqlite3` native build**: `@prd-gen/core` depends on `better-sqlite3`
  which requires a native compile step. The monorepo must have this in
  `pnpm.onlyBuiltDependencies` or `postinstall`. Flagged in ADR-002.

---

## 8. Daily Log

- **2026-04-26**: Migration plan authored. Source repo surveyed: 17 commits, 10
  packages, 131 files with `@prd-gen/` namespace references. Approach selected:
  `git filter-repo --to-subdirectory-filter`. All deliverables committed to
  `port/migrate-prd-spec`.
