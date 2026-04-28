#!/usr/bin/env bash
# =============================================================================
# SCRIPT.sh — prd-spec-generator → packages/prd-pipeline/ migration
# =============================================================================
# Usage:
#   bash SCRIPT.sh --dry-run    # print every command without executing
#   bash SCRIPT.sh --execute    # execute on a new feature branch
#
# Run from the monorepo root:
#   cd /Users/cdeust/Developments/agentic-ai
#   bash worktrees/port-migrate-prd-spec/migration/SCRIPT.sh --dry-run
#   bash worktrees/port-migrate-prd-spec/migration/SCRIPT.sh --execute
#
# Hard constraints:
#   - Never touches /Users/cdeust/Developments/prd-spec-generator (read-only source)
#   - Creates a throw-away clone at /tmp/prd-spec-generator-migration
#   - All changes land on branch feat/prd-spec-migration in the monorepo
#   - Does NOT push to any remote
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Constants
# -----------------------------------------------------------------------------
SOURCE_REPO="/Users/cdeust/Developments/prd-spec-generator"
MONOREPO_ROOT="/Users/cdeust/Developments/agentic-ai"
CLONE_DIR="/tmp/prd-spec-generator-migration"
TARGET_PREFIX="packages/prd-pipeline"
FEATURE_BRANCH="feat/prd-spec-migration"
REMOTE_NAME="prd-spec-migration"

PRE_MIGRATION_COMMIT_COUNT=123
SOURCE_HEAD_SUBJECT="docs(phase4): regen bundle + README/About reflect Phase 4 closed-loop shipped"
SOURCE_TAIL_SUBJECT="Initial release: PRD Spec Generator v2.0.0"
EXPECTED_MIN_TESTS=583
# source: re-baselined 2026-04-28 against prd-spec-generator HEAD 5bb7dd9
# (was 17 commits / 267 tests at original SCRIPT.sh authoring 2026-04-26).
# Phase-4 closed-loop + Wave-F production-pilot work landed between
# 2026-04-26 and 2026-04-28; total +106 commits, +316 tests since the
# original baseline. Verified `pnpm test` in prd-spec-generator: 58 files,
# 583 passing tests at HEAD 5bb7dd9. The user explicitly confirmed
# 2026-04-28 that the source repo is now stabilized; safe to migrate.

# Namespace rename pairs: "OLD:NEW" — longer names MUST come before shorter names
# that share a prefix (mcp-server-bundle before mcp-server)
RENAME_PAIRS=(
  "@prd-gen/benchmark:@agentic/prd-benchmark"
  "@prd-gen/core:@agentic/prd-core"
  "@prd-gen/ecosystem-adapters:@agentic/prd-ecosystem-adapters"
  "@prd-gen/mcp-server-bundle:@agentic/prd-mcp-server-bundle"
  "@prd-gen/mcp-server:@agentic/prd-mcp-server"
  "@prd-gen/meta-prompting:@agentic/prd-meta-prompting"
  "@prd-gen/orchestration:@agentic/prd-orchestration"
  "@prd-gen/skill:@agentic/prd-skill"
  "@prd-gen/strategy:@agentic/prd-strategy"
  "@prd-gen/validation:@agentic/prd-validation"
  "@prd-gen/verification:@agentic/prd-verification"
)

# -----------------------------------------------------------------------------
# Mode flag
# -----------------------------------------------------------------------------
MODE="${1:-}"
if [[ "$MODE" != "--dry-run" && "$MODE" != "--execute" ]]; then
  echo "Usage: $0 --dry-run | --execute" >&2
  exit 1
fi

DRY_RUN=false
if [[ "$MODE" == "--dry-run" ]]; then
  DRY_RUN=true
fi

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
log()  { echo "[SCRIPT] $*"; }
step() { echo ""; echo "==> STEP: $*"; }

# run: in dry-run mode, print the command; in execute mode, run it
run() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "  [DRY-RUN] $*"
  else
    eval "$@"
  fi
}

# assert: always run (even in dry-run) — these are read-only checks
assert() {
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "  [ASSERT]  $*"
  else
    eval "$@"
  fi
}

abort() {
  echo "[ABORT] $*" >&2
  exit 1
}

# -----------------------------------------------------------------------------
# Step 0: Preflight checks
# -----------------------------------------------------------------------------
step "0 — Preflight checks"

log "Checking git-filter-repo is installed..."
if ! command -v git-filter-repo &>/dev/null && ! git filter-repo --version &>/dev/null 2>&1; then
  abort "git-filter-repo is not installed.
  Install it:
    brew install git-filter-repo        # macOS
    pip install git-filter-repo         # cross-platform
  Then re-run this script."
fi
log "  git-filter-repo: OK"

log "Checking source repo exists at $SOURCE_REPO..."
if [[ ! -d "$SOURCE_REPO/.git" ]]; then
  abort "Source repo not found at $SOURCE_REPO"
fi
log "  Source repo: OK"

log "Checking source repo HEAD commit..."
ACTUAL_HEAD_SUBJECT=$(git -C "$SOURCE_REPO" log --oneline -1 --format="%s")
if [[ "$ACTUAL_HEAD_SUBJECT" != "$SOURCE_HEAD_SUBJECT" ]]; then
  abort "Source repo HEAD is '$ACTUAL_HEAD_SUBJECT', expected '$SOURCE_HEAD_SUBJECT'.
  The source repo may have new commits. Update SOURCE_HEAD_SUBJECT and
  PRE_MIGRATION_COMMIT_COUNT in this script, then re-run."
fi
log "  Source HEAD: OK ($ACTUAL_HEAD_SUBJECT)"

log "Checking source repo commit count..."
ACTUAL_COMMIT_COUNT=$(git -C "$SOURCE_REPO" log --all --oneline | wc -l | tr -d ' ')
if [[ "$ACTUAL_COMMIT_COUNT" != "$PRE_MIGRATION_COMMIT_COUNT" ]]; then
  log "  WARNING: expected $PRE_MIGRATION_COMMIT_COUNT commits, found $ACTUAL_COMMIT_COUNT."
  log "  Proceeding, but update PRE_MIGRATION_COMMIT_COUNT if this is intentional."
else
  log "  Commit count: OK ($ACTUAL_COMMIT_COUNT)"
fi

log "Checking monorepo root..."
if [[ ! -d "$MONOREPO_ROOT/.git" ]]; then
  abort "Monorepo root not found at $MONOREPO_ROOT"
fi

log "Checking monorepo working tree is clean..."
DIRTY=$(git -C "$MONOREPO_ROOT" status --short)
if [[ -n "$DIRTY" ]]; then
  abort "Monorepo working tree is not clean. Commit or stash changes first.
  Dirty files:
$DIRTY"
fi
log "  Monorepo working tree: clean"

log "Checking feature branch does not already exist..."
if git -C "$MONOREPO_ROOT" rev-parse --verify "$FEATURE_BRANCH" &>/dev/null; then
  abort "Branch $FEATURE_BRANCH already exists in the monorepo.
  Delete it first: git -C $MONOREPO_ROOT branch -D $FEATURE_BRANCH"
fi
log "  Feature branch available: OK"

log "Preflight complete."

# -----------------------------------------------------------------------------
# Step 1: Clone source repo
# -----------------------------------------------------------------------------
step "1 — Clone source repo into $CLONE_DIR"

if [[ -d "$CLONE_DIR" ]]; then
  log "  Removing existing clone at $CLONE_DIR..."
  run "rm -rf '$CLONE_DIR'"
fi

run "git clone --no-local '$SOURCE_REPO' '$CLONE_DIR'"
log "  Clone created."

# Capture pre-mutation commit list for later comparison
if [[ "$DRY_RUN" == "false" ]]; then
  git -C "$CLONE_DIR" log --oneline > /tmp/prd-spec-clone-commits-before.txt
  log "  Pre-filter commit list saved to /tmp/prd-spec-clone-commits-before.txt"
fi

# -----------------------------------------------------------------------------
# Step 2: Rewrite history with filter-repo
# -----------------------------------------------------------------------------
step "2 — Rewrite history: all paths → $TARGET_PREFIX/"

run "git -C '$CLONE_DIR' filter-repo --to-subdirectory-filter '$TARGET_PREFIX/'"

if [[ "$DRY_RUN" == "false" ]]; then
  POST_COUNT=$(git -C "$CLONE_DIR" log --oneline | wc -l | tr -d ' ')
  log "  Post-filter commit count: $POST_COUNT (expected $PRE_MIGRATION_COMMIT_COUNT)"
  if [[ "$POST_COUNT" != "$PRE_MIGRATION_COMMIT_COUNT" ]]; then
    abort "Commit count mismatch after filter-repo. Expected $PRE_MIGRATION_COMMIT_COUNT, got $POST_COUNT."
  fi

  POST_HEAD=$(git -C "$CLONE_DIR" log --oneline -1 --format="%s")
  if [[ "$POST_HEAD" != "$SOURCE_HEAD_SUBJECT" ]]; then
    abort "HEAD subject mismatch after filter-repo. Expected '$SOURCE_HEAD_SUBJECT', got '$POST_HEAD'."
  fi

  POST_TAIL=$(git -C "$CLONE_DIR" log --oneline --format="%s" | tail -1)
  if [[ "$POST_TAIL" != "$SOURCE_TAIL_SUBJECT" ]]; then
    abort "Root commit subject mismatch. Expected '$SOURCE_TAIL_SUBJECT', got '$POST_TAIL'."
  fi

  # Verify I2: every file in HEAD is under packages/prd-pipeline/.
  # Note: grep exits 1 when nothing matches (all files ARE under the prefix —
  # the success case). With `set -o pipefail` that crashes the script, so we
  # disable pipefail just for this check.
  set +o pipefail
  OUTSIDE_PREFIX=$(git -C "$CLONE_DIR" ls-files | grep -v "^$TARGET_PREFIX/" | wc -l | tr -d ' ')
  set -o pipefail
  if [[ "$OUTSIDE_PREFIX" != "0" ]]; then
    abort "filter-repo left $OUTSIDE_PREFIX files outside $TARGET_PREFIX/:
$(git -C "$CLONE_DIR" ls-files | grep -v "^$TARGET_PREFIX/" || true)"
  fi

  log "  History rewrite verified: I1 + I2 hold."
fi

# -----------------------------------------------------------------------------
# Step 3: Create feature branch in monorepo, add remote, fetch
# -----------------------------------------------------------------------------
step "3 — Graft rewritten history into monorepo"

run "git -C '$MONOREPO_ROOT' checkout -b '$FEATURE_BRANCH'"
run "git -C '$MONOREPO_ROOT' remote add '$REMOTE_NAME' '$CLONE_DIR'"
run "git -C '$MONOREPO_ROOT' fetch '$REMOTE_NAME'"

# -----------------------------------------------------------------------------
# Step 4: Merge rewritten history
# -----------------------------------------------------------------------------
step "4 — Merge rewritten history (--allow-unrelated-histories --no-ff)"

MERGE_MSG="feat(prd-pipeline): import prd-spec-generator history (${PRE_MIGRATION_COMMIT_COUNT} commits rewritten to ${TARGET_PREFIX}/)"
run "git -C '$MONOREPO_ROOT' merge --allow-unrelated-histories \
  --no-ff \
  -m '$MERGE_MSG' \
  '$REMOTE_NAME/main'"

if [[ "$DRY_RUN" == "false" ]]; then
  MERGED_COUNT=$(git -C "$MONOREPO_ROOT" log --oneline -- "$TARGET_PREFIX/" | wc -l | tr -d ' ')
  log "  Commits visible under $TARGET_PREFIX/: $MERGED_COUNT"
  # +1 for the merge commit itself
  EXPECTED=$((PRE_MIGRATION_COMMIT_COUNT + 1))
  if [[ "$MERGED_COUNT" -lt "$PRE_MIGRATION_COMMIT_COUNT" ]]; then
    abort "Too few commits under $TARGET_PREFIX/ after merge: got $MERGED_COUNT, need ≥ $PRE_MIGRATION_COMMIT_COUNT"
  fi
  log "  Merge verified: I1 holds in monorepo."
fi

# -----------------------------------------------------------------------------
# Step 5: Remove temporary remote
# -----------------------------------------------------------------------------
step "5 — Remove temporary remote"

run "git -C '$MONOREPO_ROOT' remote remove '$REMOTE_NAME'"

# -----------------------------------------------------------------------------
# Step 6: package.json / workspace reconciliation
# -----------------------------------------------------------------------------
step "6 — Reconcile pnpm workspace and package.json"

WORKSPACE_FILE="$MONOREPO_ROOT/pnpm-workspace.yaml"
PRP_PKG="$MONOREPO_ROOT/$TARGET_PREFIX/package.json"
PRP_WORKSPACE="$MONOREPO_ROOT/$TARGET_PREFIX/pnpm-workspace.yaml"

# 6a: Disable prd-pipeline's own pnpm-workspace.yaml
if [[ "$DRY_RUN" == "false" ]]; then
  if [[ -f "$PRP_WORKSPACE" ]]; then
    run "mv '$PRP_WORKSPACE' '${PRP_WORKSPACE}.migrated'"
    log "  Disabled $PRP_WORKSPACE (renamed to .migrated)"
  fi
else
  run "mv '$PRP_WORKSPACE' '${PRP_WORKSPACE}.migrated'"
fi

# 6b: Add prd-pipeline packages glob to monorepo pnpm-workspace.yaml
log "  Adding packages/prd-pipeline/packages/* to $WORKSPACE_FILE..."
run "perl -pi -e 's|  - \"packages/mcp-servers/\*\"|  - \"packages/mcp-servers/*\"\n  - \"packages/prd-pipeline/packages/*\"|' '$WORKSPACE_FILE'"

# 6c: Rename prd-pipeline root package name
log "  Updating prd-pipeline root package name to @agentic/prd-pipeline..."
run "perl -pi -e 's|\"name\": \"prd-spec-generator\"|\"name\": \"@agentic/prd-pipeline\"|' '$PRP_PKG'"

# 6d: Ensure better-sqlite3 is in monorepo root pnpm.onlyBuiltDependencies
MONO_PKG="$MONOREPO_ROOT/package.json"
log "  Checking monorepo root package.json for better-sqlite3 in onlyBuiltDependencies..."
if [[ "$DRY_RUN" == "false" ]]; then
  if ! grep -q "better-sqlite3" "$MONO_PKG"; then
    # Use node to patch the JSON safely
    node -e "
      const fs = require('fs');
      const pkg = JSON.parse(fs.readFileSync('$MONO_PKG', 'utf8'));
      if (!pkg.pnpm) pkg.pnpm = {};
      if (!pkg.pnpm.onlyBuiltDependencies) pkg.pnpm.onlyBuiltDependencies = [];
      if (!pkg.pnpm.onlyBuiltDependencies.includes('better-sqlite3')) {
        pkg.pnpm.onlyBuiltDependencies.push('better-sqlite3');
      }
      fs.writeFileSync('$MONO_PKG', JSON.stringify(pkg, null, 2) + '\n');
    "
    log "  Added better-sqlite3 to monorepo root pnpm.onlyBuiltDependencies"
  else
    log "  better-sqlite3 already present in monorepo root package.json"
  fi
else
  run "# [node patch]: add better-sqlite3 to $MONO_PKG pnpm.onlyBuiltDependencies"
fi

run "git -C '$MONOREPO_ROOT' add \
  '$WORKSPACE_FILE' \
  '$PRP_PKG' \
  '${PRP_WORKSPACE}.migrated' \
  '$MONO_PKG'"
run "git -C '$MONOREPO_ROOT' commit -m \
  'chore(workspace): integrate prd-pipeline packages into monorepo pnpm workspace'"

# -----------------------------------------------------------------------------
# Step 7: .claude-plugin/ path fix
# -----------------------------------------------------------------------------
step "7 — Fix .claude-plugin/plugin.json mcpServers path"

PLUGIN_JSON="$MONOREPO_ROOT/$TARGET_PREFIX/.claude-plugin/plugin.json"

run "perl -pi -e 's|\"mcpServers\": \"\./\\.mcp\\.json\"|\"mcpServers\": \"../.mcp.json\"|' '$PLUGIN_JSON'"
run "perl -pi -e 's|\"name\": \"prd-spec-generator\"|\"name\": \"prd-pipeline\"|' '$PLUGIN_JSON'"
run "perl -pi -e 's|https://github.com/cdeust/prd-spec-generator|https://github.com/cdeust/agentic-ai|g' '$PLUGIN_JSON'"

run "git -C '$MONOREPO_ROOT' add '$PLUGIN_JSON'"
run "git -C '$MONOREPO_ROOT' commit -m \
  'chore(prd-pipeline): fix .claude-plugin/ mcpServers path and repo references after subtree move'"

# -----------------------------------------------------------------------------
# Step 8: vitest workspace integration
# -----------------------------------------------------------------------------
step "8 — Add prd-pipeline packages to monorepo vitest workspace"

VITEST_WORKSPACE="$MONOREPO_ROOT/vitest.workspace.ts"

if [[ "$DRY_RUN" == "false" ]]; then
  if [[ ! -f "$VITEST_WORKSPACE" ]]; then
    # Create a new vitest workspace file
    cat > "$VITEST_WORKSPACE" << 'VITEST_EOF'
import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/*/vitest.config.ts",
  "packages/mcp-servers/*/vitest.config.ts",
  "packages/prd-pipeline/packages/*/vitest.config.ts",
]);
VITEST_EOF
    log "  Created $VITEST_WORKSPACE"
  else
    # Patch existing file to add the prd-pipeline glob if not present
    if ! grep -q "prd-pipeline" "$VITEST_WORKSPACE"; then
      node -e "
        const fs = require('fs');
        let content = fs.readFileSync('$VITEST_WORKSPACE', 'utf8');
        // Add prd-pipeline glob before the closing ]
        content = content.replace(
          /(\s*\]\s*\)\s*;\s*$)/,
          ',\n  \"packages/prd-pipeline/packages/*/vitest.config.ts\",\n\$1'
        );
        fs.writeFileSync('$VITEST_WORKSPACE', content);
      "
      log "  Patched $VITEST_WORKSPACE to include prd-pipeline packages"
    else
      log "  $VITEST_WORKSPACE already includes prd-pipeline (skipped)"
    fi
  fi
else
  run "# [create/patch $VITEST_WORKSPACE]: add packages/prd-pipeline/packages/*/vitest.config.ts"
fi

run "git -C '$MONOREPO_ROOT' add '$VITEST_WORKSPACE'"
run "git -C '$MONOREPO_ROOT' commit -m \
  'chore(test): add prd-pipeline packages to monorepo vitest workspace'"

# -----------------------------------------------------------------------------
# Step 9: Namespace rename @prd-gen/* -> @agentic/prd-*
# -----------------------------------------------------------------------------
step "9 — Namespace rename: @prd-gen/* -> @agentic/prd-*"

log "  Building perl substitution expression..."

# Build perl substitution string from RENAME_PAIRS array
PERL_SUBST=""
for pair in "${RENAME_PAIRS[@]}"; do
  OLD="${pair%%:*}"
  NEW="${pair##*:}"
  # Escape special regex chars in OLD (@ and /)
  OLD_ESC=$(echo "$OLD" | sed 's|@|\\@|g; s|/|\\/|g')
  if [[ -n "$PERL_SUBST" ]]; then
    PERL_SUBST="${PERL_SUBST}; "
  fi
  PERL_SUBST="${PERL_SUBST}s|${OLD_ESC}|${NEW}|g"
done

log "  Perl substitution: $PERL_SUBST"

# Find files to rename (exclude node_modules, dist, .migrated, binary files)
RENAME_FILES=$(
  grep -rl "@prd-gen/" "$MONOREPO_ROOT/$TARGET_PREFIX/" \
    --include="*.ts" --include="*.json" --include="*.yaml" --include="*.yml" \
    2>/dev/null \
  | grep -v "/node_modules/" \
  | grep -v "/dist/" \
  | grep -v "\.migrated$" \
  || true
)

if [[ -z "$RENAME_FILES" ]]; then
  log "  WARNING: no files found containing @prd-gen/ — namespace rename may already be done"
else
  FILE_COUNT=$(echo "$RENAME_FILES" | wc -l | tr -d ' ')
  log "  Renaming $FILE_COUNT files..."

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "  [DRY-RUN] Would run perl -pi -e '$PERL_SUBST' on $FILE_COUNT files:"
    echo "$RENAME_FILES" | head -20 | sed 's/^/    /'
    if [[ "$FILE_COUNT" -gt 20 ]]; then
      echo "    ... and $((FILE_COUNT - 20)) more"
    fi
  else
    echo "$RENAME_FILES" | xargs perl -pi -e "$PERL_SUBST"

    # Verify I3
    REMAINING=$(
      grep -r "@prd-gen/" "$MONOREPO_ROOT/$TARGET_PREFIX/" \
        --include="*.ts" --include="*.json" --include="*.yaml" --include="*.yml" \
        2>/dev/null \
      | grep -v "/node_modules/" \
      | grep -v "/dist/" \
      | grep -v "\.migrated$" \
      || true
    )
    if [[ -n "$REMAINING" ]]; then
      abort "Namespace rename incomplete — @prd-gen/ still found:
$REMAINING"
    fi
    log "  I3 holds: zero @prd-gen/ references remain in tracked source files."
  fi
fi

# Also update the pnpm-lock.yaml if it exists in prd-pipeline
PRP_LOCK="$MONOREPO_ROOT/$TARGET_PREFIX/pnpm-lock.yaml"
if [[ -f "$PRP_LOCK" ]]; then
  if [[ "$DRY_RUN" == "false" ]]; then
    perl -pi -e "$PERL_SUBST" "$PRP_LOCK"
    log "  Renamed @prd-gen/ references in $PRP_LOCK"
  else
    run "# perl rename on $PRP_LOCK"
  fi
fi

run "git -C '$MONOREPO_ROOT' add -u '$MONOREPO_ROOT/$TARGET_PREFIX/'"
run "git -C '$MONOREPO_ROOT' commit -m \
  'chore(prd-pipeline): rename @prd-gen/* -> @agentic/prd-* namespace'"

# -----------------------------------------------------------------------------
# Step 10: tsconfig.base.json module resolution alignment (ADR-004)
# -----------------------------------------------------------------------------
step "10 — Align tsconfig.base.json module resolution to NodeNext"

PRP_TSCONFIG="$MONOREPO_ROOT/$TARGET_PREFIX/tsconfig.base.json"

if [[ -f "$PRP_TSCONFIG" ]]; then
  run "perl -pi -e \
    's|\"module\": \"Node16\"|\"module\": \"NodeNext\"|g; \
     s|\"moduleResolution\": \"Node16\"|\"moduleResolution\": \"NodeNext\"|g' \
    '$PRP_TSCONFIG'"

  if [[ "$DRY_RUN" == "false" ]]; then
    if git -C "$MONOREPO_ROOT" diff --quiet "$PRP_TSCONFIG"; then
      log "  tsconfig.base.json already uses NodeNext (no change needed)"
    else
      run "git -C '$MONOREPO_ROOT' add '$PRP_TSCONFIG'"
      run "git -C '$MONOREPO_ROOT' commit -m \
        'chore(prd-pipeline): align tsconfig.base.json to NodeNext module resolution (ADR-004)'"
    fi
  else
    run "git -C '$MONOREPO_ROOT' add '$PRP_TSCONFIG'"
    run "git -C '$MONOREPO_ROOT' commit -m \
      'chore(prd-pipeline): align tsconfig.base.json to NodeNext module resolution (ADR-004)'"
  fi
fi

# -----------------------------------------------------------------------------
# Step 11: pnpm install and lockfile commit
# -----------------------------------------------------------------------------
step "11 — pnpm install and lockfile update"

run "pnpm install --frozen-lockfile 2>/dev/null || pnpm install"

if [[ "$DRY_RUN" == "false" ]]; then
  if ! git -C "$MONOREPO_ROOT" diff --quiet "$MONOREPO_ROOT/pnpm-lock.yaml"; then
    run "git -C '$MONOREPO_ROOT' add '$MONOREPO_ROOT/pnpm-lock.yaml'"
    run "git -C '$MONOREPO_ROOT' commit -m \
      'chore(deps): regenerate pnpm-lock.yaml after prd-pipeline integration'"
  else
    log "  pnpm-lock.yaml unchanged (skipped commit)"
  fi
else
  run "git -C '$MONOREPO_ROOT' add pnpm-lock.yaml"
  run "git -C '$MONOREPO_ROOT' commit -m 'chore(deps): regenerate pnpm-lock.yaml after prd-pipeline integration'"
fi

# -----------------------------------------------------------------------------
# Step 12: Verification
# -----------------------------------------------------------------------------
step "12 — Post-migration verification"

if [[ "$DRY_RUN" == "false" ]]; then
  log "  Running pnpm test..."
  TEST_OUTPUT=$(cd "$MONOREPO_ROOT" && pnpm test 2>&1 || true)
  echo "$TEST_OUTPUT" | tail -5

  PASS_COUNT=$(echo "$TEST_OUTPUT" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+' | tail -1 || echo "0")
  if [[ -z "$PASS_COUNT" ]]; then PASS_COUNT=0; fi

  if [[ "$PASS_COUNT" -lt "$EXPECTED_MIN_TESTS" ]]; then
    log "  WARNING: test count $PASS_COUNT < expected $EXPECTED_MIN_TESTS"
    log "  I5 VIOLATED — investigate before merging"
  else
    log "  I5 holds: $PASS_COUNT tests passing (≥ $EXPECTED_MIN_TESTS)"
  fi

  log "  Checking I3 (no @prd-gen/ in tracked source)..."
  LEFTOVER=$(
    grep -r "@prd-gen/" "$MONOREPO_ROOT/$TARGET_PREFIX/" \
      --include="*.ts" --include="*.json" --include="*.yaml" --include="*.yml" \
      2>/dev/null \
    | grep -v "/node_modules/" | grep -v "/dist/" || true
  )
  if [[ -n "$LEFTOVER" ]]; then
    log "  I3 VIOLATED — @prd-gen/ still present:"
    echo "$LEFTOVER"
  else
    log "  I3 holds: zero @prd-gen/ references"
  fi

  log "  Checking I4 (bundle exists and is executable)..."
  BUNDLE="$MONOREPO_ROOT/$TARGET_PREFIX/mcp-server/index.js"
  if [[ -f "$BUNDLE" ]]; then
    if [[ -x "$BUNDLE" ]]; then
      log "  I4 holds: $BUNDLE exists and is executable"
    else
      log "  I4 PARTIAL: $BUNDLE exists but is NOT executable — run: chmod +x $BUNDLE"
    fi
  else
    log "  I4 VIOLATED: $BUNDLE does not exist"
  fi

  log "  Checking I1 (commit count)..."
  IMPORTED_COMMITS=$(git -C "$MONOREPO_ROOT" log --oneline -- "$TARGET_PREFIX/" | wc -l | tr -d ' ')
  if [[ "$IMPORTED_COMMITS" -ge "$PRE_MIGRATION_COMMIT_COUNT" ]]; then
    log "  I1 holds: $IMPORTED_COMMITS commits visible under $TARGET_PREFIX/"
  else
    log "  I1 VIOLATED: only $IMPORTED_COMMITS commits found, expected ≥ $PRE_MIGRATION_COMMIT_COUNT"
  fi

else
  log "  [DRY-RUN] Would run: pnpm test, grep checks for I3/I4/I1"
fi

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
echo ""
echo "============================================================"
if [[ "$DRY_RUN" == "true" ]]; then
  echo "  DRY-RUN COMPLETE"
  echo "  No changes were made."
  echo "  Review the commands above, then run:"
  echo "    $0 --execute"
else
  echo "  MIGRATION COMPLETE"
  echo ""
  echo "  Branch: $FEATURE_BRANCH"
  echo "  Target: $TARGET_PREFIX/"
  echo ""
  echo "  Next steps:"
  echo "  1. Review VERIFICATION.md and run all assertions"
  echo "  2. Open a PR: gh pr create --base main --head $FEATURE_BRANCH"
  echo "  3. Do NOT push until all invariants are verified"
fi
echo "============================================================"
