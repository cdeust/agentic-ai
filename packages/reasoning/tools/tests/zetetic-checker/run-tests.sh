#!/usr/bin/env bash
# Regression tests for tools/zetetic-checker.sh
# Proves: (a) true positives fire, (b) sourced constants pass, (c) lock files skip,
#         (d) integer hyperparameters don't fire, (e) issue references count as tracking.

set -euo pipefail

cd "$(dirname "$0")"
CHECKER="../../zetetic-checker.sh"

PASS=0
FAIL=0

expect() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "  PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $name — expected '$expected', got '$actual'"
    FAIL=$((FAIL + 1))
  fi
}

run_check() {
  # $1: fixture file, $2: what grep-pattern to match in output (empty = expect zero errors)
  local fixture="$1"
  local grep_pattern="${2:-}"

  local output; output=$(bash "$CHECKER" --files "$fixture" 2>&1 || true)
  if [[ -z "$grep_pattern" ]]; then
    # Expect no findings (or only warnings, not errors). Check for "PASSED" or "permissive".
    if echo "$output" | grep -qE 'PASSED|all findings are informational'; then
      echo "clean"
    else
      echo "has-findings:$(echo "$output" | grep -c 'UNSOURCED\|MAGIC_NUMBER\|TODO_NO_REF' || echo 0)"
    fi
  else
    if echo "$output" | grep -q "$grep_pattern"; then
      echo "match"
    else
      echo "no-match"
    fi
  fi
}

echo "=== zetetic-checker regression tests ==="

# 1. True positive: unsourced 0.9995 MUST fire MAGIC_NUMBER
expect "unsourced float fires MAGIC_NUMBER" \
  "match" \
  "$(run_check fixture-true-positive.py 'MAGIC_NUMBER')"

# 2. Sourced float MUST pass (no MAGIC_NUMBER finding)
output=$(bash "$CHECKER" --files fixture-sourced.py 2>&1 || true)
if echo "$output" | grep -q 'MAGIC_NUMBER'; then
  echo "  FAIL: sourced float silenced — got MAGIC_NUMBER anyway"
  FAIL=$((FAIL + 1))
else
  echo "  PASS: sourced float silenced"
  PASS=$((PASS + 1))
fi

# 3. Absolute claim without citation MUST fire UNSOURCED (error)
expect "absolute claim fires UNSOURCED" \
  "match" \
  "$(run_check fixture-absolute-claim.py 'UNSOURCED')"

# 4. TODO with issue reference MUST pass
output=$(bash "$CHECKER" --files fixture-todo-issue-ref.py 2>&1 || true)
if echo "$output" | grep -q 'TODO_NO_REF'; then
  echo "  FAIL: TODO with #264 silenced — got TODO_NO_REF anyway"
  FAIL=$((FAIL + 1))
else
  echo "  PASS: TODO with issue ref silenced"
  PASS=$((PASS + 1))
fi

# 5. TODO without reference MUST fire TODO_NO_REF
expect "TODO without ref fires TODO_NO_REF" \
  "match" \
  "$(run_check fixture-todo-no-ref.py 'TODO_NO_REF')"

# 6. Cargo.lock MUST be skipped entirely (0 findings)
output=$(bash "$CHECKER" --files fixture-Cargo.lock 2>&1 || true)
findings=$(echo "$output" | grep -cE 'UNSOURCED|MAGIC_NUMBER|TODO_NO_REF' || true)
if [[ "$findings" -eq 0 ]]; then
  echo "  PASS: Cargo.lock skipped (no findings)"
  PASS=$((PASS + 1))
else
  echo "  FAIL: Cargo.lock produced $findings findings (expected 0)"
  FAIL=$((FAIL + 1))
fi

# 7. Integer hyperparameters MUST NOT fire MAGIC_NUMBER (documented blind spot)
output=$(bash "$CHECKER" --files fixture-integer-hyperparam.py 2>&1 || true)
if echo "$output" | grep -q 'MAGIC_NUMBER'; then
  echo "  FAIL: integer hyperparam fired MAGIC_NUMBER (should be blind-spot)"
  FAIL=$((FAIL + 1))
else
  echo "  PASS: integer hyperparam not flagged (documented blind spot)"
  PASS=$((PASS + 1))
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[[ $FAIL -eq 0 ]] || exit 1
exit 0
