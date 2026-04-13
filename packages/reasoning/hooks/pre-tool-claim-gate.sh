#!/usr/bin/env bash
# pre-tool-claim-gate.sh — Check code content for zetetic violations before Write/Edit
# Catches hardcoded constants, magic numbers, and unsourced algorithms at edit time.
# Input: $1 = file path being written/edited, $2 = temp file with new content (or stdin)
set -euo pipefail

# Read hook context from stdin (Claude Code passes tool args as JSON)
HOOK_INPUT=""
if ! [ -t 0 ]; then
  HOOK_INPUT="$(timeout 3 cat 2>/dev/null)" || HOOK_INPUT=""
fi

# Extract file path from context
if command -v jq &>/dev/null; then
  FILE=$(echo "$HOOK_INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null || echo "")
else
  FILE=$(echo "$HOOK_INPUT" | grep -oE '"file_path":\s*"[^"]*"' 2>/dev/null | head -1 | sed 's/.*"file_path":\s*"//' | sed 's/"$//' || echo "")
fi

VIOLATIONS=0

[[ -z "$FILE" ]] && exit 0

# Only check code files, skip markdown/config
case "$FILE" in
  *.md|*.json|*.yaml|*.yml|*.toml|*.lock|*.txt|*.csv) exit 0 ;;
esac

# Extract content from hook context (new_string for Edit, content for Write)
if command -v jq &>/dev/null; then
  CONTENT=$(echo "$HOOK_INPUT" | jq -r '.tool_input.new_string // .tool_input.content // empty' 2>/dev/null || echo "")
else
  CONTENT=$(echo "$HOOK_INPUT" | grep -oE '"new_string":\s*"[^"]*"' 2>/dev/null | head -1 | sed 's/.*"new_string":\s*"//' | sed 's/"$//' || echo "")
  [[ -z "$CONTENT" ]] && CONTENT=$(echo "$HOOK_INPUT" | grep -oE '"content":\s*"[^"]*"' 2>/dev/null | head -1 | sed 's/.*"content":\s*"//' | sed 's/"$//' || echo "")
fi

[[ -z "$CONTENT" ]] && exit 0

line_num=0
while IFS= read -r line; do
  line_num=$((line_num + 1))

  # Magic numbers: 2+ digit numeric literals not annotated with source
  if echo "$line" | grep -qE '[^a-zA-Z_0-9][0-9]{2,}(\.[0-9]+)?' 2>/dev/null; then
    if ! echo "$line" | grep -qi "source:\|#.*from\|//.*from\|port\|status\|http\|errno\|exit\|range\|len\|size\|index\|offset\|version" 2>/dev/null; then
      echo "WARNING: Possible magic number at $FILE:$line_num — add '# source: <ref>' annotation"
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  fi

  # Threshold / constant assignment without source
  if echo "$line" | grep -qiE '(threshold|alpha|beta|gamma|epsilon|lambda|weight|factor|coefficient|decay)\s*[=:]\s*[0-9]' 2>/dev/null; then
    if ! echo "$line" | grep -qi "source:\|ref:\|from\|paper\|doi\|arxiv" 2>/dev/null; then
      echo "WARNING: Constant without citation at $FILE:$line_num — zetetic standard requires source"
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  fi

  # Algorithm implementation marker without citation
  if echo "$line" | grep -qiE '(algorithm|implementation of|based on|adapted from|following)\s' 2>/dev/null; then
    if ! echo "$line" | grep -qi "source:\|ref:\|doi\|arxiv\|http\|see:\|citation:" 2>/dev/null; then
      echo "WARNING: Algorithm reference without citation at $FILE:$line_num"
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  fi
done <<< "$CONTENT"

if [[ $VIOLATIONS -gt 0 ]]; then
  echo ""
  echo "Claim gate: $VIOLATIONS potential zetetic violation(s). Consider adding source annotations."
fi

exit 0
