#!/usr/bin/env bash
# session-end.sh — Record session context before exit
set -euo pipefail

# Path resolution: CLAUDE_PLUGIN_ROOT → script-relative → git root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$SCRIPT_DIR")}"
TOOLS="${PLUGIN_ROOT}/tools"
[[ ! -d "$TOOLS" ]] && TOOLS="$(git rev-parse --show-toplevel 2>/dev/null || pwd)/tools"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Auto-save a minimal session summary
BRANCH="$(git -C "$REPO_ROOT" branch --show-current 2>/dev/null || echo 'unknown')"
LAST_COMMIT="$(git -C "$REPO_ROOT" log --oneline -1 2>/dev/null || echo 'none')"
UNCOMMITTED="$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"

"$TOOLS/session-store.sh" save "Branch: $BRANCH | Last: $LAST_COMMIT | Uncommitted: $UNCOMMITTED files" 2>/dev/null || true

echo "Session context saved." >&2
exit 0
