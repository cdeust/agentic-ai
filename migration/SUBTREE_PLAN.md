# Subtree Migration Plan: prd-spec-generator → packages/prd-pipeline/

**Version**: 1.0  
**Date**: 2026-04-26  
**Author**: Lamport agent (port/migrate-prd-spec worktree)  
**Status**: Ready for operator review

---

## 0. Invariants

Before any step executes, the following invariants must hold. After every step,
the operator verifies that they still hold. This is not trace-based reasoning
("it seemed to work") — these are inductive properties that must be checkable
at any point.

**I1 (history completeness)**: every commit in the source repo's linear chain of
17 commits has a corresponding rewritten commit in the monorepo, with an identical
commit message and topologically equivalent parent-child ordering. Nothing is added
or dropped.

**I2 (path correctness)**: every file that existed at path `P` in the source repo
exists at path `packages/prd-pipeline/P` in the monorepo after the subtree step.
No file appears at a path outside `packages/prd-pipeline/`.

**I3 (namespace isolation)**: after the rename commit, zero occurrences of the
string `@prd-gen/` remain anywhere under `packages/prd-pipeline/` in tracked files.

**I4 (bundle reachability)**: the node process launched by `.mcp.json` resolves
`${CLAUDE_PLUGIN_ROOT}/mcp-server/index.js` to an existing, executable ESM bundle
at `packages/prd-pipeline/mcp-server/index.js`.

**I5 (test count non-regression)**: the count of passing test cases reported by
`pnpm test` in the monorepo root is ≥ 267 after migration.

---

## 1. Approach Choice: `git filter-repo --to-subdirectory-filter`

### Decision

**Chosen: `git filter-repo --to-subdirectory-filter packages/prd-pipeline/`**

### Rationale

Two approaches are viable:

**Option A — `git subtree add`**  
`git subtree add --prefix=packages/prd-pipeline/ <remote> main --squash`  
or without `--squash`:  
`git fetch prd-spec-generator && git merge --allow-unrelated-histories ...`

Preserves all commits but creates an explicit merge commit welding the two
histories. The merge commit has no causal predecessor in the source repo —
it is a fabricated join point. For audit purposes this is legitimate (the source
history is accessible) but it makes `git log --follow` less clean.

**Option B — `git filter-repo --to-subdirectory-filter` (chosen)**  
Rewrites every commit in the source repo so that all paths are prefixed with
`packages/prd-pipeline/`. The rewritten commits are then grafted into the
monorepo via a `git fetch` + `git merge --allow-unrelated-histories` (no
squash). This produces a linear sequence of 17 rewritten commits that live
inside the monorepo's DAG as a distinct branch of the ancestry graph.

**Why filter-repo over subtree**:

1. **Happens-before preservation**: filter-repo preserves the full causal
   partial order of the source repo. Every commit `c_i → c_{i+1}` in the
   source maps to a rewritten commit `c'_i → c'_{i+1}` in the monorepo.
   `git log -- packages/prd-pipeline/` shows a clean 17-commit history.
   With `git subtree add`, `git log -- packages/prd-pipeline/` collapses to
   the merge commit unless `--follow` is used with careful flags.

2. **No phantom merge commit**: subtree's merge commit has no semantic content
   — it is a bookkeeping artifact. filter-repo avoids it.

3. **File history per-file**: `git log --follow packages/prd-pipeline/packages/core/src/domain/agent.ts`
   traces back through all 17 rewritten commits. With subtree this is fragile.

4. **Namespace rename audit trail**: the rename is committed as a separate
   commit on top of the rewritten history. With subtree the rename would also
   be a separate commit, so both approaches are equivalent here.

**Trade-offs acknowledged**:
- filter-repo rewrites SHAs. The original source SHAs (`a766082`, `f971257`,
  etc.) are gone from the monorepo. They are preserved in
  `migration/PRE_MIGRATION_COMMIT_GRAPH.txt` as the reference anchor.
- filter-repo requires the `git-filter-repo` tool (not shipped with git). The
  SCRIPT.sh checks for it and aborts with install instructions if missing.
- With subtree, the original SHAs remain as parents, making cross-repo
  references in commit messages resolvable. This benefit is outweighed by the
  cleaner per-file history that filter-repo provides.

---

## 2. Path Rewrite

### Mechanism

`git filter-repo --to-subdirectory-filter packages/prd-pipeline/` prepends
`packages/prd-pipeline/` to every path in every tree object across all 17
commits. After this rewrite, a file that was at `packages/core/src/domain/agent.ts`
in the source repo will be at `packages/prd-pipeline/packages/core/src/domain/agent.ts`
in the monorepo.

### Verification commands (run before and after)

**Before** (in source repo, captures baseline):
```bash
# In /Users/cdeust/Developments/prd-spec-generator
git log --all --diff-filter=A --name-only --pretty=format: | grep -v '^$' | sort > /tmp/pre-migration-files.txt
wc -l /tmp/pre-migration-files.txt
# Expected: ~280 tracked file additions across all commits
```

**After** (in monorepo, verifies rewrite):
```bash
# In /Users/cdeust/Developments/agentic-ai, on the migration branch
git log --all --diff-filter=A --name-only --pretty=format: -- packages/prd-pipeline/ | grep -v '^$' | sort > /tmp/post-migration-files.txt
# Transform post list: strip the packages/prd-pipeline/ prefix
sed 's|^packages/prd-pipeline/||' /tmp/post-migration-files.txt | sort > /tmp/post-stripped.txt
# Compare
diff /tmp/pre-migration-files.txt /tmp/post-stripped.txt
# Expected: no diff (identical file sets)
```

**Verify no file leaked outside the prefix**:
```bash
# Should return zero lines
git log --all --diff-filter=A --name-only --pretty=format: | grep -v '^$' | grep -v '^packages/prd-pipeline/' | grep -v '^63a5097'
```

---

## 3. Namespace Rename: `@prd-gen/*` → `@agentic/prd-*`

### Scope

131 files contain `@prd-gen/` references outside `node_modules/`.
Of these, the ones tracked in git (i.e., not in `dist/` or `node_modules/`) are:

| Pattern | Files |
|---|---|
| `packages/*/package.json` — `name` and `dependencies` fields | ~22 |
| `packages/*/vitest.config.ts` — import paths | ~9 |
| `packages/*/src/**/*.ts` — import statements | ~35 |
| `packages/*/tsconfig.json` — paths aliases (if any) | ~9 |
| `pnpm-lock.yaml` | 1 |
| `mcp-server/package.json` | 1 |

**Total tracked files with `@prd-gen/` references: ~77 files.**  
(The remaining ~54 of the 131 total are in `dist/`, `node_modules/`, and vitest
results JSON which are not tracked by git or should be regenerated.)

### Rename table

| Old name | New name |
|---|---|
| `@prd-gen/benchmark` | `@agentic/prd-benchmark` |
| `@prd-gen/core` | `@agentic/prd-core` |
| `@prd-gen/ecosystem-adapters` | `@agentic/prd-ecosystem-adapters` |
| `@prd-gen/mcp-server` | `@agentic/prd-mcp-server` |
| `@prd-gen/mcp-server-bundle` | `@agentic/prd-mcp-server-bundle` |
| `@prd-gen/meta-prompting` | `@agentic/prd-meta-prompting` |
| `@prd-gen/orchestration` | `@agentic/prd-orchestration` |
| `@prd-gen/skill` | `@agentic/prd-skill` |
| `@prd-gen/strategy` | `@agentic/prd-strategy` |
| `@prd-gen/validation` | `@agentic/prd-validation` |
| `@prd-gen/verification` | `@agentic/prd-verification` |

### Codemod commands

The rename is a pure string replacement. Use `find` + `sed` (or `perl`) to
avoid line-ending issues:

```bash
# Dry-run: show which files would change
grep -rl "@prd-gen/" packages/prd-pipeline/ \
  --include="*.ts" --include="*.json" --include="*.yaml" --include="*.yml" \
  | grep -v node_modules | grep -v "/dist/"

# Execute rename (macOS sed requires backup extension; use perl for portability)
grep -rl "@prd-gen/" packages/prd-pipeline/ \
  --include="*.ts" --include="*.json" --include="*.yaml" --include="*.yml" \
  | grep -v node_modules | grep -v "/dist/" \
  | xargs perl -pi -e 's|\@prd-gen/benchmark|\@agentic/prd-benchmark|g;
                        s|\@prd-gen/core|\@agentic/prd-core|g;
                        s|\@prd-gen/ecosystem-adapters|\@agentic/prd-ecosystem-adapters|g;
                        s|\@prd-gen/mcp-server-bundle|\@agentic/prd-mcp-server-bundle|g;
                        s|\@prd-gen/mcp-server|\@agentic/prd-mcp-server|g;
                        s|\@prd-gen/meta-prompting|\@agentic/prd-meta-prompting|g;
                        s|\@prd-gen/orchestration|\@agentic/prd-orchestration|g;
                        s|\@prd-gen/skill|\@agentic/prd-skill|g;
                        s|\@prd-gen/strategy|\@agentic/prd-strategy|g;
                        s|\@prd-gen/validation|\@agentic/prd-validation|g;
                        s|\@prd-gen/verification|\@agentic/prd-verification|g'

# Verify: must return 0 lines
grep -r "@prd-gen/" packages/prd-pipeline/ \
  --include="*.ts" --include="*.json" --include="*.yaml" --include="*.yml" \
  | grep -v node_modules | grep -v "/dist/"
```

**Important**: `mcp-server-bundle` must be renamed BEFORE `mcp-server` in the
perl substitution list (longer match first). The perl script above handles this
because `mcp-server-bundle` appears before `mcp-server` in the substitution list.

**This rename is committed as a SEPARATE commit** from the subtree merge. The
commit message must be:
```
chore(prd-pipeline): rename @prd-gen/* -> @agentic/prd-* namespace
```
This preserves the audit trail: you can `git diff HEAD~1` on the rename commit
and see only namespace string changes, with zero business logic changes.

---

## 4. `package.json` Reconciliation

### Problem

The source repo has its own root `package.json` that acts as the pnpm workspace
root covering `packages/*`. After migration, this root `package.json` becomes
`packages/prd-pipeline/package.json` — but in the monorepo context it is NOT
the workspace root. The monorepo's root `pnpm-workspace.yaml` is the workspace
root.

### Solution

**Step 4a**: The source repo's `pnpm-workspace.yaml` (`packages: ["packages/*"]`)
moves to `packages/prd-pipeline/pnpm-workspace.yaml`. It must NOT be used by
the monorepo's pnpm. Rename it to `packages/prd-pipeline/pnpm-workspace.yaml.migrated`
(disabled) and add a comment explaining its historical origin.

**Step 4b**: Update the monorepo root `pnpm-workspace.yaml` to include the
prd-pipeline sub-packages. The current monorepo workspace is:
```yaml
packages:
  - "packages/*"
  - "packages/mcp-servers/*"
```
Add:
```yaml
  - "packages/prd-pipeline/packages/*"
```
This makes all 10 `@agentic/prd-*` packages visible to the monorepo's pnpm.

**Step 4c**: The source repo's root `package.json` becomes
`packages/prd-pipeline/package.json`. Update it:
- Remove `"name": "prd-spec-generator"` → replace with `"name": "@agentic/prd-pipeline"`
- Keep `scripts.bundle` (the esbuild invocation that builds `mcp-server/index.js`),
  updating the input path: `packages/mcp-server/dist/index.js` →
  `packages/prd-pipeline/packages/mcp-server/dist/index.js` if run from monorepo root,
  OR keep as-is if run from `packages/prd-pipeline/` (preferred — run bundle script
  from within the sub-root).
- Keep `pnpm.onlyBuiltDependencies: ["better-sqlite3"]` — this must also appear
  in the monorepo root `package.json` or `pnpm-workspace.yaml` so that native
  builds run on install.

**Step 4d**: Add `better-sqlite3` to the monorepo root `package.json`'s
`pnpm.onlyBuiltDependencies` array (see ADR-002).

**Final workspace layout** (monorepo `pnpm-workspace.yaml` after migration):
```yaml
packages:
  - "packages/*"
  - "packages/mcp-servers/*"
  - "packages/prd-pipeline/packages/*"
```

The 10 prd-pipeline sub-packages are now first-class members of the monorepo
workspace. `pnpm -r build` will build them. `vitest run` from the root will
discover their test files (see §6 below).

---

## 5. `mcp-server/index.js` Bundle

### Current state

In the source repo:
- `mcp-server/index.js` is the pre-built ESM bundle, committed to git.
- `mcp-server/package.json` names it `@prd-gen/mcp-server-bundle`.
- `.mcp.json` references it as `"${CLAUDE_PLUGIN_ROOT}/mcp-server/index.js"`.
- `.claude-plugin/plugin.json` sets `"mcpServers": "./.mcp.json"`.

### After migration

All these files move to `packages/prd-pipeline/`:
- `packages/prd-pipeline/mcp-server/index.js` — bundle, preserved byte-for-byte
- `packages/prd-pipeline/mcp-server/package.json` — name updated to `@agentic/prd-mcp-server-bundle`
- `packages/prd-pipeline/.mcp.json` — path unchanged (still `${CLAUDE_PLUGIN_ROOT}/mcp-server/index.js`)

**The `.mcp.json` path does not need to change** because `CLAUDE_PLUGIN_ROOT`
is set to the directory containing the plugin's `plugin.json`. After the
`.claude-plugin/plugin.json` is rewritten to live at
`packages/prd-pipeline/.claude-plugin/plugin.json`, the Claude marketplace will
set `CLAUDE_PLUGIN_ROOT` to `packages/prd-pipeline/`, and
`${CLAUDE_PLUGIN_ROOT}/mcp-server/index.js` resolves to
`packages/prd-pipeline/mcp-server/index.js` — correct.

**Verification**:
```bash
# File exists
ls -la packages/prd-pipeline/mcp-server/index.js

# File is executable (chmod +x was applied in source repo's pnpm bundle script)
test -x packages/prd-pipeline/mcp-server/index.js && echo "executable" || echo "NOT executable"

# .mcp.json still references the correct relative path
grep "mcp-server/index.js" packages/prd-pipeline/.mcp.json
# Expected: "args": ["${CLAUDE_PLUGIN_ROOT}/mcp-server/index.js"]
```

---

## 6. `.claude-plugin/` Collision

### Problem

The source repo has:
```
.claude-plugin/
  plugin.json
  marketplace.json
```
at the repo root. After filter-repo rewrite, these become:
```
packages/prd-pipeline/.claude-plugin/
  plugin.json
  marketplace.json
```
The monorepo convention (per `MISSION.md` §4.4 in the template) is:
```
.claude-plugin/<plugin-name>/plugin.json
```
at the monorepo root.

### Resolution

Two sub-cases:

**Sub-case A: monorepo does not yet have a root `.claude-plugin/` directory**
(confirmed: no `plugin.json` files found in the monorepo). In this case the
simplest path is to leave the plugin manifest at
`packages/prd-pipeline/.claude-plugin/plugin.json` and register it as the
plugin root. The Claude marketplace sets `CLAUDE_PLUGIN_ROOT` to the directory
containing `plugin.json`, which will be `packages/prd-pipeline/.claude-plugin/`.
The `mcpServers` field in `plugin.json` is `"./.mcp.json"` — this resolves to
`packages/prd-pipeline/.claude-plugin/.mcp.json` which is WRONG.

**Sub-case B (correct resolution)**: after migration, rewrite `plugin.json`
`mcpServers` field from `"./.mcp.json"` to `"../.mcp.json"` (one directory up
from `.claude-plugin/` to `packages/prd-pipeline/`). This correctly resolves
`${CLAUDE_PLUGIN_ROOT}` to `packages/prd-pipeline/` so that
`${CLAUDE_PLUGIN_ROOT}/mcp-server/index.js` still works.

**Rewrite path for `plugin.json`**:
```
packages/prd-pipeline/.claude-plugin/plugin.json
```
`mcpServers` field: change `"./.mcp.json"` → `"../.mcp.json"`

**If the monorepo later adds a root `.claude-plugin/` directory** (per the
template convention), a symlink or a re-copy of the manifest to
`.claude-plugin/prd-pipeline/plugin.json` at the monorepo root is the clean
solution, but that is deferred to the plugin-manifest-design worktree
(`port/plugin-manifest-design`). This is flagged in ADR-003.

**The rename commit** also patches `plugin.json`:
- Update `"name": "prd-spec-generator"` → `"name": "prd-pipeline"`
- Update `"repository"` and `"homepage"` to point to the monorepo

---

## 7. Test Count Preservation

### Baseline

`pnpm test` in the source repo currently reports **267 passing** tests (stated
in the mission spec; consistent with the marketplace.json description of
"248 tests" which was the count at v0.3.0 release — the current HEAD has ~267).

### vitest workspace integration

The source repo's `vitest.workspace.ts` discovers tests via:
```ts
defineWorkspace(["packages/*/vitest.config.ts"])
```
After migration, this file lives at `packages/prd-pipeline/vitest.workspace.ts`.

The monorepo root needs to also discover prd-pipeline tests. Two options:

**Option A** (preferred): the monorepo root `vitest.workspace.ts` (if it exists)
or the root vitest config adds a glob:
```ts
defineWorkspace([
  "packages/*/vitest.config.ts",
  "packages/mcp-servers/*/vitest.config.ts",
  "packages/prd-pipeline/packages/*/vitest.config.ts",   // ADD THIS
])
```

**Option B**: run `pnpm test` from `packages/prd-pipeline/` separately using
its own `vitest.workspace.ts`. This keeps test discovery isolated but means
the monorepo root `pnpm test` will not include prd-pipeline tests.

The migration script uses Option A. The rename commit updates the monorepo root
vitest workspace file. If no root vitest workspace file exists, the script
creates one. The invariant is that `pnpm test` from the monorepo root must
report ≥ 267 passing.

**Verification command**:
```bash
cd /Users/cdeust/Developments/agentic-ai
pnpm test 2>&1 | grep "Tests " | tail -1
# Expected: "Tests  267 passed" (or higher)
```

---

## 8. Step-by-Step Procedure

Steps are ordered by the happens-before relation. Each step is a separate git
commit (except steps that are mechanical prerequisites). An operator who runs
SCRIPT.sh gets all of these automatically.

### Step 0: Preconditions (operator checks manually, not in script)

- [ ] `git filter-repo` is installed: `git filter-repo --version`
- [ ] Source repo HEAD is `342f15f` (Add preflight step): `git -C /Users/cdeust/Developments/prd-spec-generator log --oneline -1`
- [ ] Monorepo working tree is clean: `git -C /Users/cdeust/Developments/agentic-ai status --short`
- [ ] Operating on a feature branch (SCRIPT.sh creates `feat/prd-spec-migration` automatically)

### Step 1: Clone source repo into a throw-away working copy

```bash
git clone /Users/cdeust/Developments/prd-spec-generator /tmp/prd-spec-generator-migration
```
We operate on the clone, not the original, because filter-repo is destructive
(it rewrites the clone's history in place).

### Step 2: Rewrite history with filter-repo

```bash
cd /tmp/prd-spec-generator-migration
git filter-repo --to-subdirectory-filter packages/prd-pipeline/
```

After this command:
- Every file in the repo is now under `packages/prd-pipeline/`
- All 17 commits have new SHAs but the same subjects and parent-child ordering
- The clone has no remote (filter-repo removes it for safety)

**Verify (I1 + I2)**:
```bash
git log --oneline | wc -l
# Must be 17

git log --oneline | head -1
# Subject must be "Add preflight step that probes Cortex (and ai-architect) at startup"

git log --oneline | tail -1
# Subject must be "Initial release: PRD Spec Generator v2.0.0"

git show --stat HEAD | head -5
# All paths must start with packages/prd-pipeline/
```

### Step 3: Add the rewritten history as a remote in the monorepo

```bash
cd /Users/cdeust/Developments/agentic-ai
git checkout -b feat/prd-spec-migration
git remote add prd-spec-migration /tmp/prd-spec-generator-migration
git fetch prd-spec-migration
```

### Step 4: Merge the rewritten history into the monorepo

```bash
git merge --allow-unrelated-histories prd-spec-migration/main \
  --no-ff \
  -m "feat(prd-pipeline): import prd-spec-generator history (17 commits rewritten to packages/prd-pipeline/)"
```

`--no-ff` is intentional: we want a single explicit merge commit that marks
the join point between the monorepo's history and the imported history. This
merge commit is the only "fabricated" causal link. Everything before it has
clean linear ancestry.

**Verify (I1 post-merge)**:
```bash
git log --oneline -- packages/prd-pipeline/ | wc -l
# Must be ≥ 17 (17 rewritten + 1 merge commit = 18)

git log --oneline -- packages/prd-pipeline/ | grep "Initial release"
# Must match "Initial release: PRD Spec Generator v2.0.0"
```

### Step 5: Remove the temporary remote

```bash
git remote remove prd-spec-migration
```

### Step 6: `package.json` reconciliation (separate commit)

```bash
# Disable the prd-pipeline's own pnpm-workspace.yaml
mv packages/prd-pipeline/pnpm-workspace.yaml \
   packages/prd-pipeline/pnpm-workspace.yaml.migrated

# Update monorepo root pnpm-workspace.yaml
# Add: "packages/prd-pipeline/packages/*"
perl -pi -e 's|  - "packages/mcp-servers/\*"|  - "packages/mcp-servers/*"\n  - "packages/prd-pipeline/packages/*"|' \
  pnpm-workspace.yaml

# Update packages/prd-pipeline/package.json name field
perl -pi -e 's|"name": "prd-spec-generator"|"name": "@agentic/prd-pipeline"|' \
  packages/prd-pipeline/package.json

# Add better-sqlite3 to monorepo root pnpm.onlyBuiltDependencies (if not present)
# (handled in SCRIPT.sh via node/jq patching)

git add pnpm-workspace.yaml \
        packages/prd-pipeline/package.json \
        packages/prd-pipeline/pnpm-workspace.yaml.migrated
git commit -m "chore(workspace): integrate prd-pipeline packages into monorepo pnpm workspace"
```

### Step 7: `.claude-plugin/` path fix (separate commit)

```bash
# Fix the mcpServers reference in plugin.json
perl -pi -e 's|"mcpServers": "\./\.mcp\.json"|"mcpServers": "../.mcp.json"|' \
  packages/prd-pipeline/.claude-plugin/plugin.json

# Update plugin name and repository
perl -pi -e 's|"name": "prd-spec-generator"|"name": "prd-pipeline"|' \
  packages/prd-pipeline/.claude-plugin/plugin.json

git add packages/prd-pipeline/.claude-plugin/plugin.json
git commit -m "chore(prd-pipeline): fix .claude-plugin/ mcpServers path after subtree move"
```

### Step 8: vitest workspace integration (separate commit)

```bash
# Update/create monorepo root vitest workspace
# Adds packages/prd-pipeline/packages/*/vitest.config.ts glob
# (SCRIPT.sh handles this with a node script to avoid YAML/TS parsing issues)

git add vitest.workspace.ts   # or wherever the root vitest config lives
git commit -m "chore(test): add prd-pipeline packages to monorepo vitest workspace"
```

### Step 9: Namespace rename (separate commit, must be AFTER Steps 4–8)

```bash
# Execute the perl codemod from §3
grep -rl "@prd-gen/" packages/prd-pipeline/ \
  --include="*.ts" --include="*.json" --include="*.yaml" --include="*.yml" \
  | grep -v node_modules | grep -v "/dist/" \
  | xargs perl -pi -e '...'

# Verify I3
grep -r "@prd-gen/" packages/prd-pipeline/ \
  --include="*.ts" --include="*.json" --include="*.yaml" --include="*.yml" \
  | grep -v node_modules | grep -v "/dist/"
# Must return 0 lines

git add -u packages/prd-pipeline/
git commit -m "chore(prd-pipeline): rename @prd-gen/* -> @agentic/prd-* namespace"
```

### Step 10: pnpm install and lockfile commit

```bash
pnpm install
git add pnpm-lock.yaml
git commit -m "chore(deps): regenerate pnpm-lock.yaml after prd-pipeline integration"
```

### Step 11: Verification run

```bash
pnpm test
# Must show ≥ 267 passing (I5)

grep -r "@prd-gen/" packages/prd-pipeline/ --include="*.ts" --include="*.json" | grep -v node_modules | grep -v dist
# Must return 0 (I3)

ls -la packages/prd-pipeline/mcp-server/index.js
# Must exist (I4)

test -x packages/prd-pipeline/mcp-server/index.js && echo "PASS" || echo "FAIL"
# Must print PASS (I4)
```

---

## 9. ADR: Architecture Decision Records

### ADR-001: Bundle preservation vs regeneration

**Decision**: Preserve the pre-built `mcp-server/index.js` bundle byte-for-byte
from the source repo's last commit (`342f15f`). Do NOT regenerate during migration.

**Rationale**: The bundle is a verified artifact produced from the source at a
known HEAD. Regenerating it would require running `pnpm build && pnpm bundle`
against the renamed packages, which introduces a new build step with its own
failure modes. The conservative default is preservation. The bundle can be
regenerated later as a deliberate step with its own PR.

**Risk**: The bundle's internal references to `@prd-gen/` package names are
baked into the compiled output. Since the bundle is ESM and imports are resolved
at bundle-time (esbuild bundles all dependencies), there are no runtime `@prd-gen/`
imports in the bundle itself — only in the source TypeScript. So preserving the
pre-built bundle is safe; the namespace rename only affects source files.

**Consequence**: `packages/prd-pipeline/mcp-server/index.js` is committed to
git as a binary artifact. This is consistent with the source repo's practice.

### ADR-002: `better-sqlite3` native build in monorepo

**Decision**: Add `better-sqlite3` to the monorepo root `package.json`'s
`pnpm.onlyBuiltDependencies` array.

**Rationale**: `better-sqlite3` requires a native compile step during
`pnpm install`. In the source repo this is declared in the root `package.json`.
In the monorepo, the root `package.json` controls which packages are allowed to
run their `install` scripts. Without this, `better-sqlite3` will fail to build
and `@agentic/prd-core` will be broken.

**Risk**: low. `better-sqlite3` is a well-known package; adding it to the allow
list is standard practice.

### ADR-003: `.claude-plugin/` convention alignment

**Decision**: During this migration, leave the plugin manifest at
`packages/prd-pipeline/.claude-plugin/plugin.json` (the natural output of
filter-repo + no further moves). Do NOT create a monorepo-root
`.claude-plugin/prd-pipeline/plugin.json` in this PR.

**Rationale**: The monorepo's plugin-manifest convention is being designed in
a parallel worktree (`port/plugin-manifest-design`). Moving the manifest to
the monorepo root prematurely would create a conflict with that work. The
conservative default is to leave it in place and let the plugin-manifest-design
worktree decide the canonical layout.

**Consequence**: The marketplace install path for prd-pipeline during this
migration will be `packages/prd-pipeline/` as the CLAUDE_PLUGIN_ROOT.
This is correct. A future PR can symlink or move the manifest.

### ADR-004: `tsconfig.base.json` module resolution update

**Decision**: In the rename commit (Step 9), also update
`packages/prd-pipeline/tsconfig.base.json` to change `"module": "Node16"` and
`"moduleResolution": "Node16"` to `"module": "NodeNext"` and
`"moduleResolution": "NodeNext"` to match the monorepo's standard.

**Rationale**: The monorepo's root `tsconfig.base.json` uses `NodeNext`.
Mismatched module resolutions across a single pnpm workspace cause subtle import
failures. Aligning them in the rename commit keeps the audit trail clean (the
module resolution change is clearly tagged as part of the namespace rename /
integration step, not a separate PR).

**Risk**: `NodeNext` is a strict superset of `Node16` for ESM. The source
packages already use `"type": "module"` and `.js` extensions in import paths
(confirmed by spot-checking `packages/mcp-server/src/index.ts`). No runtime
failures expected.
