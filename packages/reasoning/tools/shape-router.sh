#!/usr/bin/env bash
# shape-router.sh — Route a problem to genius agents by matching problem shapes
#
# Usage:
#   tools/shape-router.sh "<problem description or shape keyword>"
#
# Searches INDEX.md for matching shapes and outputs the agent(s) + key moves.
# Exit codes: 0 match found, 1 no match

set -euo pipefail

# Path resolution: ZETETIC_AGENTS env → ~/.claude/agents → plugin-relative → git root
resolve_agents_dir() {
  [[ -n "${ZETETIC_AGENTS:-}" ]] && [[ -d "$ZETETIC_AGENTS" ]] && { echo "$ZETETIC_AGENTS"; return; }
  [[ -d "$HOME/.claude/agents/genius" ]] && { echo "$HOME/.claude/agents"; return; }
  local script_dir; script_dir="$(cd "$(dirname "$0")" && pwd)"
  local plugin_dir; plugin_dir="$(dirname "$script_dir")"
  [[ -d "$plugin_dir/agents" ]] && { echo "$plugin_dir/agents"; return; }
  local git_root; git_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  [[ -n "$git_root" ]] && [[ -d "$git_root/agents" ]] && { echo "$git_root/agents"; return; }
  echo "agents"  # fallback
}

AGENTS_DIR="$(resolve_agents_dir)"
INDEX="$AGENTS_DIR/genius/INDEX.md"

QUERY="${1:-}"
[[ -z "$QUERY" ]] && { echo "usage: $0 \"<problem description or keyword>\"" >&2; exit 1; }

# Search the index for matching shapes
matches=$(grep -i "$QUERY" "$INDEX" 2>/dev/null | grep -E '^\| \*\*' | head -10)

if [[ -z "$matches" ]]; then
  # Try broader search
  matches=$(grep -i "$QUERY" "$INDEX" 2>/dev/null | grep -E '^\|' | grep -v '^\| Shape' | head -10)
fi

if [[ -z "$matches" ]]; then
  echo "No matching shapes found for: $QUERY"
  echo "Try broader keywords or check agents/genius/INDEX.md directly."
  exit 1
fi

echo "Matching shapes for: $QUERY"
echo ""
echo "$matches"
echo ""
echo "Consult agents/genius/INDEX.md for full shape descriptions and agent details."
