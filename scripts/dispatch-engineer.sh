#!/usr/bin/env bash
# dispatch-engineer.sh — atomic worktree spawn + install + path print.
#
# Usage:   ./scripts/dispatch-engineer.sh <branch>
# Example: ./scripts/dispatch-engineer.sh port/fix-worktree-isolation
#
# This is the MANDATORY wrapper for the orchestrator to use BEFORE dispatching
# every parallel engineer agent. It guarantees:
#   1. The parent worktree is clean before a child is spawned.
#   2. The branch does not already exist (prevents double-dispatch).
#   3. Dependencies are installed in the new worktree.
#   4. The engineer receives an unambiguous path to work in.
#
# source: docs/CONTRIBUTING_WORKTREE_PROTOCOL.md §2

set -euo pipefail

branch="${1:?usage: dispatch-engineer.sh <branch>}"
repo="$(git rev-parse --show-toplevel)"

# ── 1. Verify parent worktree is clean ────────────────────────────────────────
cd "$repo"

dirty_unstaged="$(git diff --name-only)"
dirty_untracked="$(git ls-files --others --exclude-standard)"
dirty_unstaged_filtered=$(echo "$dirty_unstaged" | grep -v '^packages/memory/__tests__/recall/expected/.*\.tsoutput\.json$' || true)
dirty_untracked_filtered=$(echo "$dirty_untracked" | grep -v '^packages/memory/__tests__/recall/expected/.*\.tsoutput\.json$' || true)

if [[ -n "$dirty_unstaged_filtered$dirty_untracked_filtered" ]]; then
  echo "ERROR: parent worktree dirty. Clean before dispatching." >&2
  [[ -n "$dirty_unstaged_filtered" ]] && echo "  modified: $dirty_unstaged_filtered" >&2
  [[ -n "$dirty_untracked_filtered" ]] && echo "  untracked: $dirty_untracked_filtered" >&2
  exit 1
fi

# ── 2. Spawn worktree (spawn-worktree.sh enforces branch-uniqueness) ──────────
worktree_path="$(bash "$repo/scripts/spawn-worktree.sh" "$branch")"

# ── 3. Print absolute path for the engineer prompt ────────────────────────────
# The spawn script prints ENGINEER_WORKTREE_PATH=<path> on stdout.
echo
echo "$worktree_path"
echo
echo "Include this in the engineer's prompt:"
echo "  'Work in ${worktree_path#ENGINEER_WORKTREE_PATH=}; cd there once and never cd out.'"
