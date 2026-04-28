#!/usr/bin/env bash
# shape-router.sh — Route a problem to genius agents by matching problem shapes
#
# Usage:
#   tools/shape-router.sh "<problem description or shape keyword>"
#
# Searches INDEX.md for matching shapes and outputs the agent(s) + key moves.
# Exit codes: 0 match found, 1 no match

set -euo pipefail

# Resolve agent directory: env var → ~/.claude/agents → plugin-relative → git root
_resolve_agents_dir() {
  local d
  d="${ZETETIC_AGENTS:-}"
  [[ -n "$d" && -d "$d/genius" ]] && { echo "$d"; return; }
  d="$HOME/.claude/agents"
  [[ -d "$d/genius" ]] && { echo "$d"; return; }
  d="$(cd "$(dirname "$0")/.." && pwd)/agents"
  [[ -d "$d/genius" ]] && { echo "$d"; return; }
  d="$(git rev-parse --show-toplevel 2>/dev/null || pwd)/agents"
  echo "$d"
}

AGENTS_DIR="$(_resolve_agents_dir)"
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
