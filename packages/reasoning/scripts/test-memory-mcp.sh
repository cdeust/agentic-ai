#!/usr/bin/env bash
# test-memory-mcp.sh — Smoke test for memory-mcp-server.py
#
# Speaks JSON-RPC 2.0 (newline-delimited) to the server via stdin/stdout.
# Tests: initialize, tools/list, create, view, path-traversal, duplicate-create,
#        MEMORY_AGENT_ID propagation.
# Exit code: 0 = all pass, 1 = any failure.
#
# Usage: bash scripts/test-memory-mcp.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
SERVER="$REPO_ROOT/tools/memory-mcp-server.py"

# Isolated memory root for tests — never touches real ~/.claude/memories.
export MEMORY_ROOT="$(mktemp -d)"
export MEMORY_NO_AUDIT=1
export MEMORY_NO_ACL=1
export MEMORY_NO_SYNC=1
export MEMORY_AGENT_ID="test-agent-smoke"

PASS=0
FAIL=0
TRANSCRIPT=""

# ── helper: send one JSON-RPC request, capture response ─────────────────────

send_request() {
  # Usage: send_request <json_string>
  # Starts a fresh server process per call (stateless enough for smoke tests).
  local req="$1"
  printf '%s\n' "$req" \
    | MEMORY_AGENT_ID="$MEMORY_AGENT_ID" \
      MEMORY_ROOT="$MEMORY_ROOT" \
      MEMORY_NO_AUDIT="$MEMORY_NO_AUDIT" \
      MEMORY_NO_ACL="$MEMORY_NO_ACL" \
      MEMORY_NO_SYNC="$MEMORY_NO_SYNC" \
      python3 "$SERVER"
}

# ── test runner ──────────────────────────────────────────────────────────────

check() {
  local name="$1" response="$2" pattern="$3" expect_error="${4:-false}"
  TRANSCRIPT+="--- TEST: $name ---\n"
  TRANSCRIPT+="RESPONSE: $response\n"

  # Check for the expected pattern in the response.
  if ! echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); s=json.dumps(d); assert '$pattern' in s, repr(s)" 2>/dev/null; then
    echo "FAIL [$name]: expected pattern '$pattern' not found in: $response"
    FAIL=$((FAIL + 1))
    TRANSCRIPT+="RESULT: FAIL (pattern '$pattern' not found)\n\n"
    return
  fi

  # If test expects isError:true, verify it.
  if [[ "$expect_error" == "true" ]]; then
    if ! echo "$response" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('result',{}).get('isError') is True, 'isError not True'" 2>/dev/null; then
      echo "FAIL [$name]: expected isError:true but got: $response"
      FAIL=$((FAIL + 1))
      TRANSCRIPT+="RESULT: FAIL (isError not true)\n\n"
      return
    fi
  fi

  echo "PASS [$name]"
  PASS=$((PASS + 1))
  TRANSCRIPT+="RESULT: PASS\n\n"
}

# ── TEST 1: initialize ───────────────────────────────────────────────────────

R1=$(send_request '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}')
check "initialize" "$R1" "memory-mcp-server"

# ── TEST 2: tools/list — both tools present ──────────────────────────────────

R2=$(send_request '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}')
check "tools/list contains memory" "$R2" '"name": "memory"'
check "tools/list contains memory_extensions" "$R2" '"name": "memory_extensions"'

# ── TEST 3: create — success round-trip ─────────────────────────────────────

CREATE_REQ=$(cat <<'JSON'
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"memory","arguments":{"command":"create","path":"/memories/smoke/hello.md","file_text":"# Hello\nSmoke test content.\n"}}}
JSON
)
R3=$(send_request "$CREATE_REQ")
check "create success" "$R3" "File created successfully at: /memories/smoke/hello.md"

# ── TEST 4: view — read back the created file ────────────────────────────────

VIEW_REQ=$(cat <<'JSON'
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"memory","arguments":{"command":"view","path":"/memories/smoke/hello.md"}}}
JSON
)
R4=$(send_request "$VIEW_REQ")
check "view file content" "$R4" "Smoke test content"
check "view has line numbers" "$R4" "content of /memories/smoke/hello.md with line numbers:"

# ── TEST 5: view with view_range ─────────────────────────────────────────────

VIEWRANGE_REQ=$(cat <<'JSON'
{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"memory","arguments":{"command":"view","path":"/memories/smoke/hello.md","view_range":[1,1]}}}
JSON
)
R5=$(send_request "$VIEWRANGE_REQ")
check "view_range line 1 only" "$R5" "# Hello"

# ── TEST 6: path traversal — must fail with isError:true ────────────────────

TRAVERSAL_REQ=$(cat <<'JSON'
{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"memory","arguments":{"command":"view","path":"/memories/../etc/passwd"}}}
JSON
)
R6=$(send_request "$TRAVERSAL_REQ")
check "traversal isError" "$R6" "Error: path must begin with /memories" "true"

# ── TEST 7: duplicate create — verbatim error + isError:true ─────────────────

DUP_REQ=$(cat <<'JSON'
{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"memory","arguments":{"command":"create","path":"/memories/smoke/hello.md","file_text":"duplicate"}}}
JSON
)
R7=$(send_request "$DUP_REQ")
check "duplicate create isError" "$R7" "Error: File /memories/smoke/hello.md already exists" "true"

# ── TEST 8: MEMORY_AGENT_ID propagation (audit attribution) ──────────────────
# Create a file as a distinct agent, then read the audit log to confirm attribution.
# We enable auditing for this specific test only.

export MEMORY_NO_AUDIT=""  # enable audit
export MEMORY_AGENT_ID="attribution-test-agent"

ATTR_REQ=$(cat <<'JSON'
{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"memory","arguments":{"command":"create","path":"/memories/smoke/attributed.md","file_text":"attribution test"}}}
JSON
)
R8=$(send_request "$ATTR_REQ")
check "attribution create success" "$R8" "File created successfully at: /memories/smoke/attributed.md"

# Verify audit log contains the agent ID.
AUDIT_LOG="$MEMORY_ROOT/.audit.log"
if [[ -f "$AUDIT_LOG" ]] && grep -q "attribution-test-agent" "$AUDIT_LOG"; then
  echo "PASS [MEMORY_AGENT_ID in audit log]"
  PASS=$((PASS + 1))
  TRANSCRIPT+="--- TEST: MEMORY_AGENT_ID in audit log ---\nRESULT: PASS\n\n"
else
  echo "FAIL [MEMORY_AGENT_ID in audit log]: agent id not found in $AUDIT_LOG"
  FAIL=$((FAIL + 1))
  TRANSCRIPT+="--- TEST: MEMORY_AGENT_ID in audit log ---\nRESULT: FAIL\n\n"
fi

# Restore env.
export MEMORY_NO_AUDIT=1
export MEMORY_AGENT_ID="test-agent-smoke"

# ── TEST 9: memory_extensions search ─────────────────────────────────────────

SEARCH_REQ=$(cat <<'JSON'
{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"memory_extensions","arguments":{"command":"search","query":"Smoke test"}}}
JSON
)
R9=$(send_request "$SEARCH_REQ")
check "extensions search finds content" "$R9" "smoke"

# ── TEST 10: unknown method → JSON-RPC error ──────────────────────────────────

UNKNOWN_REQ='{"jsonrpc":"2.0","id":10,"method":"no/such/method","params":{}}'
R10=$(send_request "$UNKNOWN_REQ")
check "unknown method error" "$R10" "Method not found"

# ── cleanup ──────────────────────────────────────────────────────────────────

rm -rf "$MEMORY_ROOT"

# ── summary ──────────────────────────────────────────────────────────────────

echo ""
echo "=== JSON-RPC transcript ==="
printf '%b' "$TRANSCRIPT"
echo "==========================="
echo "Results: $PASS passed, $FAIL failed"

if (( FAIL > 0 )); then
  exit 1
fi
exit 0
