# Post-Migration Verification Checklist

**Run from**: `/Users/cdeust/Developments/agentic-ai` (monorepo root)  
**Branch**: `feat/prd-spec-migration`  
**All items below are runnable assertions with expected outputs.**

---

## Invariant Reference

| ID | Property | Required for merge |
|---|---|---|
| I1 | History completeness — all 17 source commits present | YES |
| I2 | Path correctness — all files under `packages/prd-pipeline/` | YES |
| I3 | Namespace isolation — zero `@prd-gen/` in tracked source | YES |
| I4 | Bundle reachability — `mcp-server/index.js` exists and is executable | YES |
| I5 | Test count non-regression — ≥ 267 passing | YES |

---

## 1. Commit History (Invariant I1)

### 1.1 Total commits imported

```bash
git log --oneline -- packages/prd-pipeline/ | wc -l
```
**Expected**: `>= 17`  
**Rationale**: 17 rewritten source commits plus the merge commit = 18 minimum.

### 1.2 Oldest commit subject preserved

```bash
git log --oneline -- packages/prd-pipeline/ | tail -1
```
**Expected**: line containing `Initial release: PRD Spec Generator v2.0.0`

### 1.3 Newest imported commit subject preserved

```bash
git log --oneline -- packages/prd-pipeline/ | grep "preflight"
```
**Expected**: line containing `Add preflight step that probes Cortex (and ai-architect) at startup`

### 1.4 All 5 landmark subjects present

Run each of these; each must return exactly 1 line:

```bash
git log --oneline -- packages/prd-pipeline/ | grep "Initial release: PRD Spec Generator v2.0.0" | wc -l
# Expected: 1

git log --oneline -- packages/prd-pipeline/ | grep "Phase 3 + 4: deterministic pipeline reducer" | wc -l
# Expected: 1

git log --oneline -- packages/prd-pipeline/ | grep "Marketplace plugin distribution" | wc -l
# Expected: 1

git log --oneline -- packages/prd-pipeline/ | grep "Remove license-tier system" | wc -l
# Expected: 1

git log --oneline -- packages/prd-pipeline/ | grep "Add preflight step that probes Cortex" | wc -l
# Expected: 1
```

### 1.5 Causal order preserved (topological check)

```bash
git log --format="%s" -- packages/prd-pipeline/ | grep -n "Initial release"
```
**Expected**: highest line number in the output (oldest commit at the bottom).

```bash
git log --format="%s" -- packages/prd-pipeline/ | grep -n "Add preflight step"
```
**Expected**: lowest line number (newest commit at the top).

---

## 2. File Count and Path Correctness (Invariant I2)

### 2.1 No tracked file exists outside `packages/prd-pipeline/` that was introduced by the migration

```bash
git diff main..HEAD --name-only | grep -v "^packages/prd-pipeline/" | grep -v "^pnpm-workspace.yaml" | grep -v "^pnpm-lock.yaml" | grep -v "^package.json" | grep -v "^vitest.workspace.ts"
```
**Expected**: empty output (0 lines)  
**Note**: `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `package.json`, and
`vitest.workspace.ts` at the root are legitimately modified by the migration.

### 2.2 Key source files are present at expected paths

```bash
ls packages/prd-pipeline/packages/core/src/domain/agent.ts
# Expected: file listed without error

ls packages/prd-pipeline/packages/validation/src/hard-output-rules/index.ts
# Expected: file listed without error

ls packages/prd-pipeline/packages/orchestration/src/handlers/preflight.ts
# Expected: file listed without error (this is the HEAD commit's new file)

ls packages/prd-pipeline/packages/mcp-server/src/index.ts
# Expected: file listed without error
```

### 2.3 All 10 package directories present

```bash
for pkg in benchmark core ecosystem-adapters mcp-server meta-prompting orchestration skill strategy validation verification; do
  test -d "packages/prd-pipeline/packages/$pkg" && echo "OK: $pkg" || echo "MISSING: $pkg"
done
```
**Expected**: 10 lines, all starting with `OK:`.

### 2.4 File count delta

```bash
# Count tracked files added under packages/prd-pipeline/
git diff main..HEAD --diff-filter=A --name-only | grep "^packages/prd-pipeline/" | wc -l
```
**Expected**: >= 180 (the source repo has ~280 tracked file additions across all
commits; many are intermediate states of the same file, so the HEAD-only count
is lower — dominated by the current working tree file count).

Alternative: count files in HEAD tree:
```bash
git ls-tree -r HEAD --name-only | grep "^packages/prd-pipeline/" | wc -l
```
**Expected**: >= 100 tracked files under `packages/prd-pipeline/`.

---

## 3. Namespace Rename Completeness (Invariant I3)

### 3.1 Zero `@prd-gen/` in tracked TypeScript source files

```bash
grep -r "@prd-gen/" packages/prd-pipeline/ \
  --include="*.ts" \
  | grep -v node_modules | grep -v "/dist/"
```
**Expected**: empty output (0 lines)

### 3.2 Zero `@prd-gen/` in tracked JSON files

```bash
grep -r "@prd-gen/" packages/prd-pipeline/ \
  --include="*.json" \
  | grep -v node_modules | grep -v "/dist/"
```
**Expected**: empty output (0 lines)

### 3.3 All 10 packages have correct `@agentic/prd-*` names

```bash
for pkg in benchmark core ecosystem-adapters mcp-server meta-prompting orchestration skill strategy validation verification; do
  NAME=$(cat "packages/prd-pipeline/packages/$pkg/package.json" | python3 -c "import sys,json; print(json.load(sys.stdin).get('name','?'))" 2>/dev/null || echo "?")
  echo "$pkg: $NAME"
done
```
**Expected**:
```
benchmark: @agentic/prd-benchmark
core: @agentic/prd-core
ecosystem-adapters: @agentic/prd-ecosystem-adapters
mcp-server: @agentic/prd-mcp-server
meta-prompting: @agentic/prd-meta-prompting
orchestration: @agentic/prd-orchestration
skill: @agentic/prd-skill
strategy: @agentic/prd-strategy
validation: @agentic/prd-validation
verification: @agentic/prd-verification
```

### 3.4 Rename is a standalone commit (audit trail)

```bash
git log --oneline | grep "rename @prd-gen"
```
**Expected**: exactly 1 line, message: `chore(prd-pipeline): rename @prd-gen/* -> @agentic/prd-* namespace`

```bash
git show --stat $(git log --format="%H" | xargs git log --oneline --format="%H %s" | grep "rename @prd-gen" | awk '{print $1}') | grep "\.ts\|\.json" | head -5
```
**Expected**: only `.ts` and `.json` files in the diff — no other file types,
no logic changes.

---

## 4. Bundle Path (Invariant I4)

### 4.1 Bundle file exists

```bash
ls -la packages/prd-pipeline/mcp-server/index.js
```
**Expected**: file listed with size > 0 bytes.

### 4.2 Bundle is executable

```bash
test -x packages/prd-pipeline/mcp-server/index.js && echo "PASS: executable" || echo "FAIL: not executable"
```
**Expected**: `PASS: executable`

### 4.3 Bundle starts with ESM shebang

```bash
head -1 packages/prd-pipeline/mcp-server/index.js
```
**Expected**: `#!/usr/bin/env node` (or similar shebang line)

### 4.4 `.mcp.json` references the correct relative path

```bash
grep "mcp-server/index.js" packages/prd-pipeline/.mcp.json
```
**Expected**: line containing `${CLAUDE_PLUGIN_ROOT}/mcp-server/index.js`

### 4.5 `plugin.json` mcpServers field points to `../.mcp.json`

```bash
grep "mcpServers" packages/prd-pipeline/.claude-plugin/plugin.json
```
**Expected**: `"mcpServers": "../.mcp.json"`

### 4.6 Plugin root resolves correctly (path algebra check)

Given `CLAUDE_PLUGIN_ROOT = packages/prd-pipeline/` (the directory containing
`packages/prd-pipeline/.claude-plugin/plugin.json`'s parent):
```bash
python3 -c "
import os
plugin_json = 'packages/prd-pipeline/.claude-plugin/plugin.json'
plugin_root = os.path.dirname(os.path.dirname(plugin_json))  # one up from .claude-plugin/
bundle = os.path.join(plugin_root, 'mcp-server', 'index.js')
print('CLAUDE_PLUGIN_ROOT:', plugin_root)
print('bundle path:', bundle)
print('exists:', os.path.exists(bundle))
"
```
**Expected**:
```
CLAUDE_PLUGIN_ROOT: packages/prd-pipeline
bundle path: packages/prd-pipeline/mcp-server/index.js
exists: True
```

---

## 5. Test Count (Invariant I5)

### 5.1 Monorepo vitest workspace includes prd-pipeline

```bash
grep "prd-pipeline" vitest.workspace.ts
```
**Expected**: line containing `packages/prd-pipeline/packages/*/vitest.config.ts`

### 5.2 Test count ≥ 267

```bash
pnpm test 2>&1 | grep -E "Tests |passed|failed" | tail -3
```
**Expected**: output contains a passing count ≥ 267 and 0 failed.

Example expected output:
```
Tests  267 passed (267)
```

### 5.3 All prd-pipeline test suites discovered

```bash
pnpm test 2>&1 | grep "prd-pipeline" | head -20
```
**Expected**: lines showing test files from `packages/prd-pipeline/packages/*/`.

### 5.4 No test suite errors (distinct from test failures)

```bash
pnpm test 2>&1 | grep -i "error\|Error" | grep -v "Test " | grep -v "passed\|failed" | head -10
```
**Expected**: empty or only vitest-internal messages, no package resolution errors.

---

## 6. Workspace Integration

### 6.1 pnpm-workspace.yaml includes prd-pipeline

```bash
grep "prd-pipeline" pnpm-workspace.yaml
```
**Expected**: `  - "packages/prd-pipeline/packages/*"`

### 6.2 pnpm install succeeds

```bash
pnpm install --frozen-lockfile && echo "PASS" || echo "FAIL"
```
**Expected**: `PASS`

### 6.3 All prd-pipeline packages are visible to pnpm

```bash
pnpm ls -r --depth=0 2>/dev/null | grep "@agentic/prd-" | wc -l
```
**Expected**: `10` (one line per prd package)

### 6.4 better-sqlite3 in monorepo onlyBuiltDependencies

```bash
python3 -c "
import json
pkg = json.load(open('package.json'))
deps = pkg.get('pnpm', {}).get('onlyBuiltDependencies', [])
print('better-sqlite3 present:', 'better-sqlite3' in deps)
"
```
**Expected**: `better-sqlite3 present: True`

### 6.5 prd-pipeline's own pnpm-workspace.yaml is disabled

```bash
ls packages/prd-pipeline/pnpm-workspace.yaml 2>/dev/null && echo "FAIL: file still active" || echo "PASS: file disabled"
ls packages/prd-pipeline/pnpm-workspace.yaml.migrated 2>/dev/null && echo "PASS: .migrated exists" || echo "FAIL: .migrated missing"
```
**Expected**:
```
PASS: file disabled
PASS: .migrated exists
```

---

## 7. tsconfig Alignment (ADR-004)

### 7.1 prd-pipeline tsconfig.base.json uses NodeNext

```bash
grep "moduleResolution" packages/prd-pipeline/tsconfig.base.json
```
**Expected**: `"moduleResolution": "NodeNext"`

```bash
grep '"module"' packages/prd-pipeline/tsconfig.base.json
```
**Expected**: `"module": "NodeNext"`

---

## 8. Commit Log Shape

### 8.1 Expected commit sequence on feat/prd-spec-migration

The commits introduced by this migration (newest first) should be:

```bash
git log --oneline main..HEAD
```

**Expected sequence** (newest first):
```
<sha> chore(deps): regenerate pnpm-lock.yaml after prd-pipeline integration
<sha> chore(prd-pipeline): align tsconfig.base.json to NodeNext module resolution (ADR-004)
<sha> chore(prd-pipeline): rename @prd-gen/* -> @agentic/prd-* namespace
<sha> chore(test): add prd-pipeline packages to monorepo vitest workspace
<sha> chore(prd-pipeline): fix .claude-plugin/ mcpServers path and repo references after subtree move
<sha> chore(workspace): integrate prd-pipeline packages into monorepo pnpm workspace
<sha> feat(prd-pipeline): import prd-spec-generator history (17 commits rewritten to packages/prd-pipeline/)
```

Then, looking into the imported history:
```bash
git log --oneline main..HEAD -- packages/prd-pipeline/ | tail -17
```
**Expected**: the 17 rewritten source commits, oldest at the bottom
(`Initial release: PRD Spec Generator v2.0.0`).

---

## 9. Pre-Migration Reference Cross-Check

### 9.1 Compare pre-migration commit subjects to rewritten subjects

```bash
# Extract subjects from the pre-migration snapshot
grep "^[* |]*[0-9a-f]\{7\}" migration/PRE_MIGRATION_COMMIT_GRAPH.txt | sed 's/^[* |]*//' | awk '{$1=""; print $0}' | sed 's/^ //'
```
**Expected**: 17 lines matching the subjects in the monorepo:
```bash
git log --format="%s" -- packages/prd-pipeline/ | head -17
```
These two outputs must be identical (same subjects, same order top-to-bottom).

---

## Pass/Fail Summary Template

Copy and fill in before signing off on the PR:

| Check | Command | Result | Pass? |
|---|---|---|---|
| 1.1 Commit count ≥ 17 | `git log --oneline -- packages/prd-pipeline/ \| wc -l` | | |
| 1.2 Oldest commit subject | `git log -- packages/prd-pipeline/ \| tail -1` | | |
| 1.3 Newest imported subject | `git log --oneline -- packages/prd-pipeline/ \| grep "preflight"` | | |
| 2.3 All 10 packages present | loop check | | |
| 3.1 Zero @prd-gen/ in .ts | grep | 0 lines | |
| 3.2 Zero @prd-gen/ in .json | grep | 0 lines | |
| 4.1 Bundle file exists | ls | | |
| 4.2 Bundle executable | test -x | PASS | |
| 4.4 .mcp.json path correct | grep | | |
| 4.5 plugin.json path correct | grep | | |
| 5.2 Test count ≥ 267 | pnpm test | | |
| 6.1 workspace includes prd-pipeline | grep | | |
| 6.2 pnpm install | --frozen-lockfile | PASS | |
| 7.1 NodeNext in tsconfig | grep | | |

**All items must be PASS before the PR is merged.**
