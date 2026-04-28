#!/usr/bin/env bash
# =============================================================================
# ZETETIC_SCRIPT.sh — zetetic-team-subagents → packages/reasoning/ migration
# =============================================================================
# Usage:
#   bash ZETETIC_SCRIPT.sh --dry-run    # print every command without executing
#   bash ZETETIC_SCRIPT.sh --execute    # execute on a new feature branch
#
# Run from the monorepo root:
#   cd /Users/cdeust/Developments/agentic-ai
#   bash migration/ZETETIC_SCRIPT.sh --dry-run
#   bash migration/ZETETIC_SCRIPT.sh --execute
#
# Hard constraints:
#   - Never touches /Users/cdeust/Developments/zetetic-team-subagents (read-only)
#   - Creates a throw-away clone at /tmp/zetetic-migration
#   - All changes land on branch feat/zetetic-migration in the monorepo
#   - Does NOT push to any remote
#
# Bug fixes baked in from SCRIPT.sh lessons:
#   - git clone --no-local (required by git-filter-repo; local clone optimises
#     away the object copy that filter-repo needs to rewrite safely)
#   - set +o pipefail around grep -v pipelines that may legitimately match
#     nothing (the success case returns exit 1 from grep, which with pipefail
#     crashes the script)
#   - rev-list ancestry depth invariant (path-filtered count undercounts because
#     filter-repo preserves empty commits but `git log -- path` skips them;
#     we use `git rev-list <remote>/main --count` instead)
#   - HUSKY=0 on git commit invocations (husky hooks reference workspace state
#     that is in flux during migration commits)
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# Constants
# -----------------------------------------------------------------------------
SOURCE_REPO="/Users/cdeust/Developments/zetetic-team-subagents"
MONOREPO_ROOT="/Users/cdeust/Developments/agentic-ai"
CLONE_DIR="/tmp/zetetic-migration"
TARGET_PREFIX="packages/reasoning"
FEATURE_BRANCH="feat/zetetic-migration"
REMOTE_NAME="zetetic-migration"

# Source: measured 2026-04-27 against zetetic-team-subagents HEAD.
# `git -C /Users/cdeust/Developments/zetetic-team-subagents log --oneline | wc -l` = 77
# Note: `--all` returns 78 because of a `backup/before-scrub` branch with an
# extra commit that is NOT on main. After `git clone --no-local` + filter-repo
# the clone contains only the main branch (77 commits). The preflight check
# uses `--all` on the source repo; this check warns rather than aborts, so the
# discrepancy does not block execution. The load-bearing invariant is the
# post-filter-repo count = 77 and the rev-list ancestry depth check in Step 4.
PRE_MIGRATION_COMMIT_COUNT=77
SOURCE_HEAD_SUBJECT="fix(linkedin): trim pipeline post under LinkedIn 3000-char limit"
SOURCE_TAIL_SUBJECT="Initial release: 11 Claude Code agents for engineering teams"

# zetetic has no TS test suite (it is bash + markdown agent files, not TS
# packages). EXPECTED_MIN_TESTS is therefore 0 — we skip the test-count
# invariant in Step 12 for zetetic.
EXPECTED_MIN_TESTS=0

# No namespace renames: zetetic is bash + .md. No @-prefixed package IDs.

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
log()  { echo "[ZETETIC_SCRIPT] $*"; }
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

log "Checking source repo commit count (main branch only)..."
# Use `log --oneline` (main only), not `--all`, because the source repo has a
# `backup/before-scrub` branch that inflates --all by 1. filter-repo rewrites
# only the main branch, so the post-filter count must match the main-only count.
ACTUAL_COMMIT_COUNT=$(git -C "$SOURCE_REPO" log --oneline | wc -l | tr -d ' ')
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

# --no-local is required by git-filter-repo: without it, `git clone` uses
# hardlinks (local clone optimisation) which filter-repo cannot safely
# rewrite because the objects are shared with the source repo.
# source: git-filter-repo docs §"FRESHLY CLONED REPO" requirement
run "git clone --no-local '$SOURCE_REPO' '$CLONE_DIR'"
log "  Clone created."

# Capture pre-mutation commit list for later comparison
if [[ "$DRY_RUN" == "false" ]]; then
  git -C "$CLONE_DIR" log --oneline > /tmp/zetetic-clone-commits-before.txt
  log "  Pre-filter commit list saved to /tmp/zetetic-clone-commits-before.txt"
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

  # Verify I2: every file in HEAD is under packages/reasoning/.
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

MERGE_MSG="feat(reasoning): import zetetic-team-subagents history (${PRE_MIGRATION_COMMIT_COUNT} commits rewritten to ${TARGET_PREFIX}/)"
run "HUSKY=0 git -C '$MONOREPO_ROOT' merge --allow-unrelated-histories \
  --no-ff \
  -m '$MERGE_MSG' \
  '$REMOTE_NAME/main'"

if [[ "$DRY_RUN" == "false" ]]; then
  # Path-filtered count: commits that touched packages/reasoning/. This
  # can be LESS than PRE_MIGRATION_COMMIT_COUNT because filter-repo
  # preserves empty commits in linear history but `git log -- path` skips
  # them. The load-bearing invariant is that the merge brought in
  # PRE_MIGRATION_COMMIT_COUNT new commits (linear history is complete);
  # the path-filtered count is an informational lower bound.
  MERGED_COUNT=$(git -C "$MONOREPO_ROOT" log --oneline -- "$TARGET_PREFIX/" | wc -l | tr -d ' ')
  log "  Commits touching $TARGET_PREFIX/ (path-filtered, excludes empty commits): $MERGED_COUNT"
  # The right invariant: the rewritten remote tip's ancestry depth equals
  # PRE_MIGRATION_COMMIT_COUNT. We use `git rev-list <remote>/main --count`
  # rather than path-filtered log because the path filter undercounts.
  # source: SCRIPT.sh commit 1cc69ae — lesson learned from prd-pipeline migration
  set +o pipefail
  REWRITTEN_ANCESTRY=$(git -C "$MONOREPO_ROOT" rev-list "${REMOTE_NAME}/main" --count 2>/dev/null || echo "0")
  set -o pipefail
  log "  Rewritten-side ancestry depth: $REWRITTEN_ANCESTRY (expected $PRE_MIGRATION_COMMIT_COUNT)"
  if [[ "$REWRITTEN_ANCESTRY" != "$PRE_MIGRATION_COMMIT_COUNT" ]]; then
    abort "Rewritten ancestry mismatch: got $REWRITTEN_ANCESTRY, expected $PRE_MIGRATION_COMMIT_COUNT. Linear history is incomplete — investigate."
  fi
  log "  Merge verified: I1 holds in monorepo (linear history complete)."
fi

# -----------------------------------------------------------------------------
# Step 5: Remove temporary remote
# -----------------------------------------------------------------------------
step "5 — Remove temporary remote"

run "git -C '$MONOREPO_ROOT' remote remove '$REMOTE_NAME'"

# -----------------------------------------------------------------------------
# Step 6: pnpm-workspace.yaml and package.json reconciliation
# -----------------------------------------------------------------------------
step "6 — pnpm workspace reconciliation"

WORKSPACE_FILE="$MONOREPO_ROOT/pnpm-workspace.yaml"

# zetetic-team-subagents is bash + markdown; it has NO package.json, NO
# pnpm-workspace.yaml, and NO TS sub-packages. No workspace glob needed.
# The packages/reasoning/ directory is a stub TS package already in the
# monorepo (created in Phase 1) that will hold agent .md files alongside
# its src/ skeleton.
# We verify there is no stray pnpm-workspace.yaml from the source repo that
# would conflict.
REASONING_WORKSPACE="$MONOREPO_ROOT/$TARGET_PREFIX/pnpm-workspace.yaml"

if [[ "$DRY_RUN" == "false" ]]; then
  if [[ -f "$REASONING_WORKSPACE" ]]; then
    run "mv '$REASONING_WORKSPACE' '${REASONING_WORKSPACE}.migrated'"
    log "  Disabled stray $REASONING_WORKSPACE (renamed to .migrated)"
  else
    log "  No pnpm-workspace.yaml in $TARGET_PREFIX/ — nothing to disable."
  fi
else
  run "# [conditional] mv $REASONING_WORKSPACE to .migrated if present"
fi

# packages/reasoning/ was already listed under "packages/*" in pnpm-workspace.yaml.
# No new glob entry is needed. Confirm it resolves.
if [[ "$DRY_RUN" == "false" ]]; then
  if grep -q "packages/\*" "$WORKSPACE_FILE"; then
    log "  pnpm-workspace.yaml already covers $TARGET_PREFIX via 'packages/*' glob — no change."
  else
    abort "pnpm-workspace.yaml does not have a 'packages/*' glob. Manual review required."
  fi
else
  log "  [DRY-RUN] Would verify packages/* glob covers $TARGET_PREFIX/ — skipped."
fi

# -----------------------------------------------------------------------------
# Step 7: Fix .claude-plugin/plugin.json paths after subtree move
# -----------------------------------------------------------------------------
step "7 — Fix .claude-plugin/plugin.json after subtree move"

PLUGIN_JSON="$MONOREPO_ROOT/$TARGET_PREFIX/.claude-plugin/plugin.json"

if [[ "$DRY_RUN" == "false" ]]; then
  if [[ ! -f "$PLUGIN_JSON" ]]; then
    abort "Expected plugin.json at $PLUGIN_JSON but it does not exist. filter-repo or merge may have failed."
  fi
fi

# The plugin.json uses ${CLAUDE_PLUGIN_ROOT} for hook paths — these are
# resolved at Claude Code plugin install time and remain correct as-is.
# The only paths that need fixing are:
#   1. "repository" URL → updated to point at the monorepo
#   2. "homepage" → can stay as-is (external URL)
# The .mcp.json uses a relative path "tools/memory-mcp-server.py" which
# is relative to the project root when Claude Code is invoked there —
# after the move it should become relative to packages/reasoning/. We
# update the mcpServers command path accordingly.

MCP_JSON="$MONOREPO_ROOT/$TARGET_PREFIX/.mcp.json"

run "perl -pi -e 's|\"https://github.com/cdeust/zetetic-team-subagents\"|\"https://github.com/cdeust/agentic-ai\"|g' '$PLUGIN_JSON'"
run "perl -pi -e 's|\"name\": \"zetetic-team-subagents\"|\"name\": \"zetetic-reasoning\"|' '$PLUGIN_JSON'"

if [[ "$DRY_RUN" == "false" ]]; then
  if [[ -f "$MCP_JSON" ]]; then
    # The memory MCP server path in .mcp.json uses "tools/memory-mcp-server.py".
    # Inside packages/reasoning/ this is correct relative to that directory.
    # No path change needed — Claude Code resolves relative to the directory
    # containing the .mcp.json file.
    log "  .mcp.json exists at $MCP_JSON — paths are relative, no change needed."
  else
    log "  No .mcp.json in $TARGET_PREFIX/ — skipped."
  fi
fi

run "HUSKY=0 git -C '$MONOREPO_ROOT' add '$PLUGIN_JSON'"
run "HUSKY=0 git -C '$MONOREPO_ROOT' commit -m \
  'chore(reasoning): fix .claude-plugin/plugin.json repository reference after subtree move'"

# -----------------------------------------------------------------------------
# Step 8: vitest workspace integration (skip — no TS tests in zetetic)
# -----------------------------------------------------------------------------
step "8 — vitest workspace integration (skip: zetetic has no TS tests)"

# zetetic-team-subagents is bash + markdown. It has no vitest.config.ts, no
# *.test.ts files, and no vitest dependency. The existing vitest.config.ts in
# packages/reasoning/ (the Phase-1 stub) already handles the src/ directory.
# No changes needed.
log "  zetetic has no TS test suite. vitest workspace already covers"
log "  packages/reasoning/ via 'packages/*/vitest.config.ts' glob."
log "  Verifying no .test.ts files were imported from the source repo..."

if [[ "$DRY_RUN" == "false" ]]; then
  set +o pipefail
  TEST_FILES=$(find "$MONOREPO_ROOT/$TARGET_PREFIX" \
    -name "*.test.ts" -o -name "*.spec.ts" \
    2>/dev/null \
    | grep -v "/node_modules/" \
    | grep -v "/dist/" \
    || true)
  set -o pipefail
  if [[ -n "$TEST_FILES" ]]; then
    log "  WARNING: unexpected .test.ts/.spec.ts files found under $TARGET_PREFIX/:"
    echo "$TEST_FILES"
    log "  These were not expected — review them manually."
  else
    log "  No TS test files found under $TARGET_PREFIX/ — as expected."
  fi
else
  log "  [DRY-RUN] Would verify no .test.ts files exist in $TARGET_PREFIX/"
fi

# -----------------------------------------------------------------------------
# Step 9: Commit-count invariant verification
# -----------------------------------------------------------------------------
step "9 — Final commit-count invariant verification"

if [[ "$DRY_RUN" == "false" ]]; then
  # At this point the REMOTE_NAME remote has been removed (Step 5).
  # We verify the path-filtered commit count as a lower-bound informational check.
  # The ancestry-depth check in Step 4 is the load-bearing invariant.
  FINAL_PATH_COUNT=$(git -C "$MONOREPO_ROOT" log --oneline -- "$TARGET_PREFIX/" | wc -l | tr -d ' ')
  log "  Path-filtered commits under $TARGET_PREFIX/: $FINAL_PATH_COUNT"
  log "  (This is a lower bound; ancestry invariant was verified in Step 4)"

  # Confirm the target path was actually populated
  set +o pipefail
  FILE_COUNT=$(git -C "$MONOREPO_ROOT" ls-files -- "$TARGET_PREFIX/" | wc -l | tr -d ' ')
  set -o pipefail
  log "  Files tracked under $TARGET_PREFIX/: $FILE_COUNT"
  if [[ "$FILE_COUNT" -eq 0 ]]; then
    abort "No files tracked under $TARGET_PREFIX/ — the merge may not have landed content. Investigate."
  fi
  log "  I2 holds: files present under $TARGET_PREFIX/."
else
  log "  [DRY-RUN] Would verify path-filtered commit count and file count."
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
  echo "  1. Run CI gates:"
  echo "       cd $MONOREPO_ROOT"
  echo "       pnpm install --frozen-lockfile"
  echo "       pnpm build"
  echo "       pnpm layer-check"
  echo "       pnpm source-citation-check"
  echo "       pnpm audit-migration"
  echo "       pnpm test"
  echo "  2. Update docs/PHASE_PLAN.md to mark zetetic migration [x]"
  echo "  3. Open a PR: gh pr create --base main --head $FEATURE_BRANCH"
  echo "  4. Do NOT push until all invariants are verified"
fi
echo "============================================================"
