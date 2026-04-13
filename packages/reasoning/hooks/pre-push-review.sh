#!/usr/bin/env bash
# pre-push-review.sh — Check for zetetic violations before push
set -euo pipefail

# Command guard: only fire on git push
HOOK_INPUT=""
if ! [ -t 0 ]; then HOOK_INPUT="$(timeout 3 cat 2>/dev/null)" || HOOK_INPUT=""; fi
if command -v jq &>/dev/null; then
  BASH_CMD=$(echo "$HOOK_INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || echo "")
else
  BASH_CMD=$(echo "$HOOK_INPUT" | grep -oE '"command":\s*"[^"]*"' 2>/dev/null | head -1 | sed 's/.*"command":\s*"//' | sed 's/"$//' || echo "")
fi
if ! echo "$BASH_CMD" | grep -q 'git push' 2>/dev/null; then exit 0; fi

# Path resolution: CLAUDE_PLUGIN_ROOT → script-relative → git root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$SCRIPT_DIR")}"
TOOLS="${PLUGIN_ROOT}/tools"
[[ ! -d "$TOOLS" ]] && TOOLS="$(git rev-parse --show-toplevel 2>/dev/null || pwd)/tools"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Graceful degradation: if tools don't exist, skip checks
if [[ ! -x "$TOOLS/zetetic-checker.sh" ]]; then
  echo "WARNING: zetetic-checker.sh not found — skipping pre-push checks." >&2
  exit 0
fi

TRACKING="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref '@{upstream}' 2>/dev/null || echo '')"
[[ -z "$TRACKING" ]] && exit 0

CHANGED_FILES=()
while IFS= read -r f; do
  [[ -f "$REPO_ROOT/$f" ]] && CHANGED_FILES+=("$REPO_ROOT/$f")
done < <(git -C "$REPO_ROOT" diff "$TRACKING"...HEAD --name-only 2>/dev/null)

[[ ${#CHANGED_FILES[@]} -eq 0 ]] && exit 0

"$TOOLS/zetetic-checker.sh" --files "${CHANGED_FILES[@]}" 2>&1 || {
  echo "BLOCKED: Zetetic violations in files being pushed." >&2
  exit 2
}

"$TOOLS/difficulty-book-manager.sh" check 2>&1 || {
  echo "WARNING: Pushing with unaddressed difficulty-book entries." >&2
}

exit 0
