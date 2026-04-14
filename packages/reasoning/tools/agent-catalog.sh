#!/usr/bin/env bash
# agent-catalog.sh — List, search, and describe zetetic agents
#
# Usage:
#   tools/agent-catalog.sh [--team|--genius|--all] [--shape <shape>] [--search <keyword>]
#
# Exit codes: 0 success, 1 no matches, 2 usage error

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
GENIUS_DIR="$AGENTS_DIR/genius"

MODE="all"; SHAPE=""; SEARCH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --team)   MODE="team";   shift ;;
    --genius) MODE="genius"; shift ;;
    --all)    MODE="all";    shift ;;
    --shape)  SHAPE="$2";    shift 2 ;;
    --search) SEARCH="$2";   shift 2 ;;
    -h|--help) sed -n '2,/^$/p' "$0" | sed 's/^# \?//'; exit 0 ;;
    *) echo "error: unknown option: $1" >&2; exit 2 ;;
  esac
done

print_agent() {
  local file="$1" type="$2"
  local name; name="$(basename "$file" .md)"
  local desc; desc="$(awk '/^description:/{sub(/^description: *>? */, ""); gsub(/^ +/, ""); print; found=1} found && /^  /{gsub(/^ +/, ""); printf " %s", $0} found && !/^  /{exit}' "$file" | head -c 70)"
  printf "  %-18s %-7s %s\n" "$name" "$type" "$desc"
}

found=0
printf "  %-18s %-7s %s\n" "AGENT" "TYPE" "DESCRIPTION"
printf "  %-18s %-7s %s\n" "-----" "----" "-----------"

if [[ "$MODE" == "team" || "$MODE" == "all" ]]; then
  for f in "$AGENTS_DIR"/*.md; do
    [[ ! -f "$f" ]] && continue
    [[ -n "$SEARCH" ]] && ! grep -qi "$SEARCH" "$f" 2>/dev/null && continue
    print_agent "$f" "team"; found=1
  done
fi

if [[ "$MODE" == "genius" || "$MODE" == "all" ]]; then
  for f in "$GENIUS_DIR"/*.md; do
    [[ ! -f "$f" ]] && continue
    [[ "$(basename "$f")" == "INDEX.md" ]] && continue
    [[ -n "$SEARCH" ]] && ! grep -qi "$SEARCH" "$f" 2>/dev/null && continue
    [[ -n "$SHAPE" ]] && ! grep -qi "$SHAPE" "$f" 2>/dev/null && continue
    print_agent "$f" "genius"; found=1
  done
fi

[[ "$found" -eq 0 ]] && { echo "No agents found." >&2; exit 1; }
