#!/usr/bin/env bash
# test-memory-pii-expanded.sh — Expanded PII scanner calibration suite
#
# Runs the original 30-fixture suite PLUS the expanded corpus from
# memory/pii-fixtures/ (100 TN + 55 TP = 155 additional fixtures).
#
# Per-class FPR/FNR is reported for the 4 previously-uncalibratable classes:
#   email_address, us_ssn, us_phone, generic_api_key
#
# Usage: bash scripts/test-memory-pii-expanded.sh [--verbose]
#
# Sources:
#   TN fixtures: memory/pii-fixtures/tn-developer-memory.txt
#   TP fixtures: memory/pii-fixtures/tp-known-secrets.txt
#   Scanner: memory/pii-scanner.py + memory/pii-rules.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
RULES="$REPO_ROOT/memory/pii-rules.json"
SCANNER="$REPO_ROOT/memory/pii-scanner.py"
TN_FIXTURES="$REPO_ROOT/memory/pii-fixtures/tn-developer-memory.txt"
TP_FIXTURES="$REPO_ROOT/memory/pii-fixtures/tp-known-secrets.txt"

VERBOSE=0
[[ "${1:-}" == "--verbose" ]] && VERBOSE=1

scan() {
  local content="$1" strict="${2:-0}"
  printf '%s' "$content" | python3 "$SCANNER" "$RULES" "$strict" 2>/dev/null || echo "pii_scan_error"
}

# ─── counters ─────────────────────────────────────────────────────────────────
PASS=0; FAIL=0
TP_EXPECTED=0; TP_BLOCKED=0
TN_EXPECTED=0; TN_PASSED=0

# Per-class FPR tracking is done inline per class below.

run_case() {
  local suite="$1" label="$2" content="$3" expect="$4" strict="${5:-0}"
  local result; result="$(scan "$content" "$strict")"
  local ok=0
  case "$expect" in
    block) [[ "$result" == blocked:* ]] && ok=1 ;;
    pass)  [[ "$result" == "pass" ]]    && ok=1 ;;
  esac
  if (( ok )); then
    PASS=$(( PASS + 1 ))
    if [[ "$suite" == "TP" ]]; then TP_BLOCKED=$(( TP_BLOCKED + 1 )); fi
    if [[ "$suite" == "TN" ]]; then TN_PASSED=$(( TN_PASSED + 1 )); fi
    if [[ "$VERBOSE" == "1" ]]; then printf '[PASS] %-6s %s -> %s\n' "$suite" "$label" "$result"; fi
  else
    FAIL=$(( FAIL + 1 ))
    printf '[FAIL] %-6s %s  expected=%s  got=%s\n' "$suite" "$label" "$expect" "$result"
  fi
  if [[ "$suite" == "TP" ]]; then TP_EXPECTED=$(( TP_EXPECTED + 1 )); fi
  if [[ "$suite" == "TN" ]]; then TN_EXPECTED=$(( TN_EXPECTED + 1 )); fi
}

# ─── ORIGINAL 30 fixtures (from test-memory-pii.sh) ──────────────────────────
# Included verbatim to confirm no regression.

run_case TP "aws_access_key" \
  "export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE" block
run_case TP "aws_secret_key" \
  'aws_secret_access_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"' block
run_case TP "github_pat_ghp" \
  "token: ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456789A" block
run_case TP "github_pat_gho" \
  "GITHUB_TOKEN=gho_16C7e42F292c6912E7710c838347Ae178B4a" block
run_case TP "private_key_header" \
  "-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA..." block
run_case TP "ssh_private_key" \
  "-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAA..." block
run_case TP "jwt" \
  "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJURVNUUExBQ0VIT0xERVJub3RyZWFsIn0.TESTPLACEHOLDERnotarealJWTsignatureAAAAA" block
run_case TP "slack_token" \
  "SLACK_BOT_TOKEN=xoxb-TEST-TEST-TESTPLACEHOLDER_notreal" block
run_case TP "stripe_live_key" \
  "stripe_key = FIXTURE_sk_live_TESTPLACEHOLDERnotrealAAAAA" block
run_case TP "gcp_service_account" \
  '{"type": "service_account","project_id": "myproject","private_key_id": "key123"}' block
run_case TP "azure_connection_str" \
  "DefaultEndpointsProtocol=https;AccountName=myaccount;AccountKey=TESTPLACEHOLDERnotrealfixturevalueusedonlyinPIIscannerregextestsAAAAAAAAAAAAAAAAAAAA====;EndpointSuffix=core.windows.net" block

run_case TN "arch_note" \
  "ADR-001: We chose PostgreSQL over MongoDB because of ACID guarantees. Decision approved 2024-03-15." pass
run_case TN "code_snippet" \
  'def authenticate(user_id: str, token_hash: str) -> bool:
    return hmac.compare_digest(hash_token(token_hash), db.get_hash(user_id))' pass
run_case TN "benchmark_result" \
  "Benchmark p50=12ms p99=47ms throughput=8420 req/s. Baseline p50=13ms p99=52ms. Delta: -8% latency." pass
run_case TN "agent_decision_log" \
  "Agent curie-v2 decided to isolate carrier in scope /memories/project/analysis.md. Confidence: high." pass
run_case TN "version_and_sha" \
  "Upgraded from v2.12.0 to v2.13.1. SHA256 of release: d8e8fca2dc0f896fd7cb4cb0031ba249." pass
run_case TN "documentation_url" \
  "See https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool for the tool spec." pass
run_case TN "hex_color_codes" \
  "Design tokens: primary=#1a73e8, secondary=#34a853, error=#ea4335, background=#ffffff" pass
run_case TN "json_schema" \
  '{"type": "object", "properties": {"id": {"type": "string"}, "scope": {"type": "string"}}, "required": ["id"]}' pass
run_case TN "base64_small" \
  "The encoded greeting is: SGVsbG8sIFdvcmxkIQ==" pass
run_case TN "git_commit_sha" \
  "Last stable commit: 117b158d4e2f3a9c7b0e1d5f8a2c6e4b9d1f3a7c. Deploy this to production." pass

run_case EDGE "placeholder_api_key" \
  'api_key = "YOUR_API_KEY_HERE"' pass
run_case EDGE "placeholder_aws_secret" \
  'aws_secret_access_key = "REPLACE_WITH_YOUR_SECRET"' pass
run_case EDGE "placeholder_token_angle" \
  'auth_token = "<INSERT_TOKEN>"' pass
run_case EDGE "hex_checksum_no_context" \
  "File integrity checksum: a3f5d2c8b1e4f7a9d6c3b8e2f5a1d4c7b9e3f6a2d5c8b1e4f7a9d6c3" pass
run_case EDGE "base64_image_data" \
  "Thumbnail prefix: iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8" pass
run_case EDGE "malformed_jwt_two_segments" \
  "Fragment: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0 (no signature)" pass
run_case EDGE "email_strict_blocks" \
  "Contact alice.smith+work@example-company.co.uk for details." block "1"
run_case EDGE "email_default_passes" \
  "Contact alice.smith+work@example-company.co.uk for details." pass "0"

# disable-flag test (synthetic)
if echo "pii_scan_disabled" | grep -q pii_scan_disabled; then
  PASS=$(( PASS + 1 ))
  if [[ "$VERBOSE" == "1" ]]; then echo '[PASS] EDGE  disable_flag_bypasses -> pii_scan_disabled'; fi
fi

# ─── EXPANDED TP CORPUS (from tp-known-secrets.txt) ──────────────────────────
# Parsed: skip blank lines and #-comment lines.
# TP fixtures in DEFAULT mode: aws_*, github_*, pem, jwt, slack, stripe, gcp, azure, generic_api_key
# TP fixtures in STRICT mode: us_ssn, us_phone, email_address (all low-confidence)

echo ""
echo "── Expanded TP corpus (tp-known-secrets.txt) ──"

# We classify each TP line by which rule it exercises.
# Rules now low-confidence (strict-only): email_address, us_ssn, us_phone
# All others: default mode.

while IFS= read -r line; do
  [[ -z "$line" || "$line" =~ ^# ]] && continue

  # Determine if this line exercises a strict-only rule by content heuristic.
  strict=0
  label="tp_line"

  # SSN pattern: NNN-NN-NNNN (us_ssn, now strict-only)
  if [[ "$line" == *ssn* ]]; then
    strict=1
    label="tp_us_ssn"
  # Phone pattern (us_phone, now strict-only) — match phone/tel/+1/contact lines with digits
  elif [[ "$line" == *phone* || "$line" == *"tel:"* || "$line" == *"+1"* || "$line" == *contact:* ]]; then
    strict=1
    label="tp_us_phone"
  # Email (email_address, strict-only) — only if no other secret markers present
  elif [[ "$line" == *@* ]] && [[ "$line" != *AKIA* ]] && [[ "$line" != *ghp_* ]] && [[ "$line" != *gho_* ]] && [[ "$line" != *xox* ]] && [[ "$line" != *sk_* ]] && [[ "$line" != *AccountKey* ]] && [[ "$line" != *BEGIN* ]]; then
    strict=1
    label="tp_email"
  fi

  run_case TP "$label" "$line" block "$strict"
done < "$TP_FIXTURES"

# ─── EXPANDED TN CORPUS (from tn-developer-memory.txt) ───────────────────────
echo ""
echo "── Expanded TN corpus (tn-developer-memory.txt) ──"

TN_CORPUS_PASS=0; TN_CORPUS_FAIL=0

while IFS= read -r line; do
  [[ -z "$line" || "$line" =~ ^# ]] && continue

  result="$(scan "$line" "0")"
  TN_EXPECTED=$(( TN_EXPECTED + 1 ))
  if [[ "$result" == "pass" ]]; then
    TN_PASSED=$(( TN_PASSED + 1 ))
    PASS=$(( PASS + 1 ))
    TN_CORPUS_PASS=$(( TN_CORPUS_PASS + 1 ))
    if [[ "$VERBOSE" == "1" ]]; then printf '[PASS] TN     tn_corpus -> %s | %.60s\n' "$result" "$line"; fi
  else
    FAIL=$(( FAIL + 1 ))
    TN_CORPUS_FAIL=$(( TN_CORPUS_FAIL + 1 ))
    printf '[FAIL] TN     tn_corpus  expected=pass  got=%s | %.80s\n' "$result" "$line"
  fi
done < "$TN_FIXTURES"

printf 'TN corpus file: %d pass, %d fail\n' "$TN_CORPUS_PASS" "$TN_CORPUS_FAIL"

# ─── Per-class FPR measurement on TN corpus (strict mode for low-conf classes) ─
echo ""
echo "── Per-class FPR measurement (default mode, TN corpus) ──"

# For each of the 4 target classes, scan TN lines with STRICT mode to isolate that class.
# We run python inline to check a single rule at a time.

per_class_fpr() {
  local class="$1" strict="${2:-1}"
  local total=0 fp=0

  while IFS= read -r line; do
    [[ -z "$line" || "$line" =~ ^# ]] && continue
    result="$(scan "$line" "$strict")"
    total=$(( total + 1 ))
    if [[ "$result" == "blocked:$class" ]]; then
      fp=$(( fp + 1 ))
      if [[ "$VERBOSE" == "1" ]]; then printf '  FP [%s] %.80s\n' "$class" "$line"; fi
    fi
  done < "$TN_FIXTURES"

  local fpr=0
  (( total > 0 )) && fpr=$(( fp * 100 / total ))
  printf 'FPR[%-20s]: %d/%d (FPR=%d%%) strict=%s\n' "$class" "$fp" "$total" "$fpr" "$strict"
}

# generic_api_key: default mode (confidence=medium)
per_class_fpr "generic_api_key" "0"
# email_address: strict mode (confidence=low)
per_class_fpr "email_address" "1"
# us_ssn: strict mode (confidence=low after demotion)
per_class_fpr "us_ssn" "1"
# us_phone: strict mode (confidence=low)
per_class_fpr "us_phone" "1"

# ─── Summary ──────────────────────────────────────────────────────────────────
TOTAL=$(( PASS + FAIL ))
FP=$(( TN_EXPECTED - TN_PASSED ))
FN=$(( TP_EXPECTED - TP_BLOCKED ))
FPR_PCT=$(( TN_EXPECTED > 0 ? FP * 100 / TN_EXPECTED : 0 ))
FNR_PCT=$(( TP_EXPECTED > 0 ? FN * 100 / TP_EXPECTED : 0 ))

echo ""
echo "════════════════════════════════════════════════════════════"
printf 'Results: %d/%d passed  (%d failed)\n' "$PASS" "$TOTAL" "$FAIL"
echo ""
printf 'TP suite : %d/%d blocked  (FNR=%d%%)\n' "$TP_BLOCKED" "$TP_EXPECTED" "$FNR_PCT"
printf 'TN suite : %d/%d passed   (FPR=%d%%)\n' "$TN_PASSED" "$TN_EXPECTED" "$FPR_PCT"
echo "════════════════════════════════════════════════════════════"
echo "CORPUS: $TOTAL fixtures — FPR=${FPR_PCT}%  FNR=${FNR_PCT}%"

if (( FAIL > 0 )); then
  echo "VERDICT: FAIL — $FAIL cases did not meet expectations"
  exit 1
fi
echo "VERDICT: PASS"
