#!/usr/bin/env bash
# pre-commit-zetetic.sh — Enforce zetetic standard before commits
# Blocks commit if: invented constants, unsourced claims, or TODOs without difficulty-book refs.
set -euo pipefail

# Command guard: only fire on git commit (matcher: "Bash" fires on ALL Bash calls)
HOOK_INPUT=""
if ! [ -t 0 ]; then HOOK_INPUT="$(timeout 3 cat 2>/dev/null)" || HOOK_INPUT=""; fi
if command -v jq &>/dev/null; then
  BASH_CMD=$(echo "$HOOK_INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || echo "")
else
  BASH_CMD=$(echo "$HOOK_INPUT" | grep -oE '"command":\s*"[^"]*"' 2>/dev/null | head -1 | sed 's/.*"command":\s*"//' | sed 's/"$//' || echo "")
fi
if ! echo "$BASH_CMD" | grep -q 'git commit' 2>/dev/null; then exit 0; fi

# Path resolution: CLAUDE_PLUGIN_ROOT → script-relative → git root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$SCRIPT_DIR")}"
TOOLS="${PLUGIN_ROOT}/tools"
[[ ! -d "$TOOLS" ]] && TOOLS="$(git rev-parse --show-toplevel 2>/dev/null || pwd)/tools"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Graceful degradation: if tools don't exist, skip checks (don't block commits)
if [[ ! -x "$TOOLS/zetetic-checker.sh" ]]; then
  echo "WARNING: zetetic-checker.sh not found — skipping pre-commit checks." >&2
  exit 0
fi

output=$("$TOOLS/zetetic-checker.sh" --staged 2>&1) || {
  echo "BLOCKED: Zetetic violations in staged files." >&2
  echo "$output" >&2
  exit 2
}

"$TOOLS/difficulty-book-manager.sh" check 2>&1 || {
  echo "WARNING: Difficulty book has unaddressed hardest case." >&2
}

exit 0
