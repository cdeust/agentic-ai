#!/usr/bin/env bash
# check-source-citations.sh — Pre-commit hook that scans staged .ts files for
# numeric literals with 3+ significant digits that lack an adjacent // source: comment.
#
# Rationale: coding-standards.md §3.1 — "No magic numbers. Every numeric constant
# has a name or a source comment."
# coding-standards.md §8 — "Every hardcoded number must come from paper equations,
# paper experimental results, or measured ablation data from own benchmarks."
#
# Pattern lifted from: zetetic-team-subagents/hooks/pre-commit-zetetic.sh
# (staged-file scanning approach and graceful-degradation pattern).
#
# What "3+ significant digits" means:
#   - Integers: 100, 500, 1000, 0.001, 3.14, 30000 → require // source:
#   - Single/double digit integers: 0, 1, 2, 10, 99 → exempt
#   - Common programming constants by exemption list (see EXEMPT_NUMBERS below).
#
# Detection strategy:
#   1. Get staged .ts files via `git diff --cached --name-only`.
#   2. For each file, scan for lines matching NUMERIC_PATTERN.
#   3. Check if the matching line OR the immediately preceding line contains
#      a // source: comment.
#   4. If a violation is found, print it and exit 2 (blocks commit).
#
# Exit codes:
#   0 — no violations
#   1 — internal error (git unavailable, etc.)
#   2 — violations found (blocks commit)
#
# source: pre-commit-zetetic.sh — staged-file scanning pattern.
# source: coding-standards.md §8 — numeric constant citation rule.

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────────

# Minimum significant-digit threshold.
# source: coding-standards.md §3.1 — "≥3 significant digits has a // source: comment"
# source: MISSION.md §3.6
MIN_DIGITS=3  # source: coding-standards.md §3.1 — threshold is 3

# Numbers exempt from citation even if they have 3+ significant digits.
# These are standard programming constants whose semantics are universally known.
# source: zetetic-team-subagents/rules/coding-standards.md §3.1 note — "name or source comment"
#         (-1, 0, 1, 2 are already excluded by the regex; these are additional exemptions)
EXEMPT_PATTERN='(100|255|256|360|365|1000|1024|2048|4096|8080|3000|8000|8443)'

# Regex: numeric literal with 3+ significant digits.
# Matches: integers 100+, decimals with 3+ sig-fig (e.g., 3.14, 0.001, 1.23e-4),
#          hex literals with 3+ hex digits (0x1FF etc.).
# Does NOT match: 0, 1, 2, single-digit floats (0.5), two-digit integers (10–99).
#
# Pattern breakdown:
#   ([0-9]{3,})           — integer with 3+ digits (100, 500, 3000, …)
#   ([0-9]+\.[0-9]{2,})   — decimal with 2+ fractional digits (3.14, 0.001, …)
#   ([0-9]{2,}\.[0-9]+)   — decimal with 2+ integer digits (10.5, 30.0, …)
#   (0x[0-9a-fA-F]{3,})   — hex literal with 3+ hex digits (0x1FF, 0xDEAD, …)
#   (1e[0-9]+|[0-9]+e[+-]?[0-9]+) — scientific notation
#
# source: GNU grep extended regex — POSIX ERE.
NUMERIC_REGEX='([0-9]{3,}|[0-9]+\.[0-9]{2,}|[0-9]{2,}\.[0-9]+|0x[0-9a-fA-F]{3,}|[0-9]+[eE][+-]?[0-9]+)'

# Source-citation comment pattern (on the same line or the line above).
# source: coding-standards.md §8 — "// source: <citation>" form.
SOURCE_COMMENT_PATTERN='//\s*source:'

# ── Dependency guard ───────────────────────────────────────────────────────────

if ! command -v git &>/dev/null; then
  echo "check-source-citations: git not found — skipping." >&2
  exit 0
fi

# ── Get staged TypeScript files ────────────────────────────────────────────────

STAGED_TS_FILES=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null \
  | grep '\.ts$' \
  | grep -v '\.d\.ts$' \
  || true)

if [[ -z "$STAGED_TS_FILES" ]]; then
  exit 0
fi

# ── Scan each file ─────────────────────────────────────────────────────────────

VIOLATIONS=()

while IFS= read -r file; do
  # Skip files that don't exist (deleted between staging and hook run).
  [[ -f "$file" ]] || continue

  # Skip test files — magic numbers are permitted in tests.
  if echo "$file" | grep -qE '(\.test\.ts|\.spec\.ts|__tests__|\.parity\.test\.ts)'; then
    continue
  fi

  # Skip generated / dist files.
  if echo "$file" | grep -qE '(dist/|node_modules/)'; then
    continue
  fi

  line_number=0
  prev_line=""

  while IFS= read -r line; do
    line_number=$((line_number + 1))

    # Does this line contain a numeric literal matching the pattern?
    if ! echo "$line" | grep -qE "$NUMERIC_REGEX"; then
      prev_line="$line"
      continue
    fi

    # Is this line itself a comment or type annotation? Skip.
    trimmed="${line#"${line%%[! ]*}"}"  # ltrim
    if echo "$trimmed" | grep -qE '^(//|/\*|\*|import type|export type)'; then
      prev_line="$line"
      continue
    fi

    # Does the line contain an exempt number only (no non-exempt numeric literal)?
    # Extract all numeric literals and check each against the exempt list.
    # Strategy: remove exempt numbers then re-check.
    line_without_exempt=$(echo "$line" | sed -E "s/\b$EXEMPT_PATTERN\b//g")
    if ! echo "$line_without_exempt" | grep -qE "$NUMERIC_REGEX"; then
      prev_line="$line"
      continue
    fi

    # Does the current line already have a source comment?
    if echo "$line" | grep -qE "$SOURCE_COMMENT_PATTERN"; then
      prev_line="$line"
      continue
    fi

    # Does the previous line have a source comment?
    if echo "$prev_line" | grep -qE "$SOURCE_COMMENT_PATTERN"; then
      prev_line="$line"
      continue
    fi

    # Violation found.
    VIOLATIONS+=("$file:$line_number: $line")

    prev_line="$line"
  done < "$file"

done <<< "$STAGED_TS_FILES"

# ── Report ─────────────────────────────────────────────────────────────────────

if [[ ${#VIOLATIONS[@]} -eq 0 ]]; then
  exit 0
fi

echo "" >&2
echo "╔══════════════════════════════════════════════════════════════════════╗" >&2
echo "║  SOURCE CITATION VIOLATION — commit blocked                         ║" >&2
echo "║  coding-standards.md §8: every number ≥3 sig-digits needs          ║" >&2
echo "║  an adjacent '// source: <citation>' comment.                       ║" >&2
echo "╚══════════════════════════════════════════════════════════════════════╝" >&2
echo "" >&2
echo "Violations found in staged files:" >&2
echo "" >&2

for v in "${VIOLATIONS[@]}"; do
  echo "  CITATION-REQUIRED: $v" >&2
done

echo "" >&2
echo "Fix: add '// source: <paper, benchmark, or empirical measurement>' on" >&2
echo "     the same line or the line immediately before the numeric constant." >&2
echo "     Example: const TIMEOUT_MS = 30_000; // source: measured p99 latency, 2026-04-26" >&2
echo "" >&2

exit 2
