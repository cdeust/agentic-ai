#!/usr/bin/env bash
# skill-runner.sh — Resolve and display a skill's procedure for Claude to follow
#
# Usage:
#   tools/skill-runner.sh <skill-name>
#
# Searches skills/ recursively for <name>.md, prints its procedure and zetetic gates.
# Exit codes: 0 found, 1 not found

set -euo pipefail

# Path resolution: ZETETIC_SKILLS env → ~/.claude/skills → plugin-relative → git root
resolve_skills_dir() {
  [[ -n "${ZETETIC_SKILLS:-}" ]] && [[ -d "$ZETETIC_SKILLS" ]] && { echo "$ZETETIC_SKILLS"; return; }
  [[ -d "$HOME/.claude/skills" ]] && { echo "$HOME/.claude/skills"; return; }
  local script_dir; script_dir="$(cd "$(dirname "$0")" && pwd)"
  local plugin_dir; plugin_dir="$(dirname "$script_dir")"
  [[ -d "$plugin_dir/skills" ]] && { echo "$plugin_dir/skills"; return; }
  local git_root; git_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  [[ -n "$git_root" ]] && [[ -d "$git_root/skills" ]] && { echo "$git_root/skills"; return; }
  echo "skills"  # fallback
}

SKILLS_DIR="$(resolve_skills_dir)"

NAME="${1:-}"
[[ -z "$NAME" ]] && { echo "usage: $0 <skill-name>" >&2; exit 1; }

# Search for the skill file
SKILL_FILE=$(find "$SKILLS_DIR" -name "${NAME}.md" -not -name "_*" 2>/dev/null | head -1)

if [[ -z "$SKILL_FILE" ]]; then
  echo "Skill not found: $NAME" >&2
  echo "" >&2
  echo "Available skills:" >&2
  find "$SKILLS_DIR" -name "*.md" -not -name "_*" | xargs -I{} basename {} .md | sort | sed 's/^/  /' >&2
  exit 1
fi

echo "=== Skill: $NAME ==="
echo "File: $SKILL_FILE"
echo ""

# Extract and display key sections
awk '
/^---$/ { fm++; next }
fm < 2 { next }
fm >= 2 { print }
' "$SKILL_FILE"
