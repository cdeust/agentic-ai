#!/usr/bin/env bash
# post-tool-error-routing.sh — Suggest diagnostic genius agent when a tool call fails
# Runs after PostToolUseFailure; reads context from stdin JSON.
set -euo pipefail

# Read hook context from stdin
HOOK_INPUT=""
if ! [ -t 0 ]; then HOOK_INPUT="$(timeout 3 cat 2>/dev/null)" || HOOK_INPUT=""; fi
[[ -z "$HOOK_INPUT" ]] && exit 0

# Extract tool name and error from stdin JSON
if command -v jq &>/dev/null; then
  TOOL=$(echo "$HOOK_INPUT" | jq -r '.tool_name // empty' 2>/dev/null || echo "")
  ERROR=$(echo "$HOOK_INPUT" | jq -r '.error // .tool_error // empty' 2>/dev/null || echo "")
else
  TOOL=$(echo "$HOOK_INPUT" | grep -oE '"tool_name":\s*"[^"]*"' 2>/dev/null | head -1 | sed 's/.*"tool_name":\s*"//' | sed 's/"$//' || echo "")
  ERROR=$(echo "$HOOK_INPUT" | grep -oE '"error":\s*"[^"]*"' 2>/dev/null | head -1 | sed 's/.*"error":\s*"//' | sed 's/"$//' || echo "")
fi

[[ -z "$ERROR" ]] && exit 0
ERROR_LOWER="$(echo "$ERROR" | tr '[:upper:]' '[:lower:]')"

suggest() {
  echo "Suggested genius agent: $1"
  echo "Reason: $2"
  echo "Invoke with: /genius-invoke $1 \"$ERROR\""
}

# Build / compilation errors
if echo "$ERROR_LOWER" | grep -qE 'compile|build|syntax|parse|undefined|import|module not found|cannot find'; then
  suggest "dijkstra" "Build/compile error — structured correctness analysis"
  exit 0
fi

# Test failures
if echo "$ERROR_LOWER" | grep -qE 'test.*fail|assert|expect.*to|mismatch|not equal|test.*error'; then
  suggest "fisher" "Test failure — experimental design and statistical reasoning"
  exit 0
fi

# Timeout / performance
if echo "$ERROR_LOWER" | grep -qE 'timeout|timed.out|deadline|too slow|exceeded.*time|oom|out of memory'; then
  suggest "erlang" "Timeout/capacity issue — queuing theory and capacity planning"
  exit 0
fi

# Permission / access errors
if echo "$ERROR_LOWER" | grep -qE 'permission|denied|forbidden|eacces|not permitted|chmod'; then
  suggest "hamilton" "Permission error — defensive design and failure handling"
  exit 0
fi

# Auth / credential errors
if echo "$ERROR_LOWER" | grep -qE 'auth|unauthorized|401|403|token|credential|login|certificate'; then
  suggest "rejewski" "Auth/credential error — reverse engineering and decipherment"
  exit 0
fi

# Type / contract errors
if echo "$ERROR_LOWER" | grep -qE 'type.*error|cannot assign|incompatible|contract|interface|trait'; then
  suggest "liskov" "Type/contract error — substitutability and composability analysis"
  exit 0
fi

# No match — no suggestion
exit 0
