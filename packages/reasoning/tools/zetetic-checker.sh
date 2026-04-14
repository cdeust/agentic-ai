#!/usr/bin/env bash
# zetetic-checker.sh — Scan code for zetetic standard violations
#
# Usage:
#   tools/zetetic-checker.sh --staged              # check only lines added in staged diff (commit gate)
#   tools/zetetic-checker.sh --files <f1> <f2> ... # check specific files (review / CI)
#   tools/zetetic-checker.sh --full                # recursively scan tracked files (audit sweep)
#
# Checks:
#   - UNSOURCED (error): absolute claims ("always", "never", "obviously", "clearly") without a citation
#   - MAGIC_NUMBER (warning): floats with ≥3 decimals without a `# source:` / `// source:` annotation
#   - TODO_NO_REF (warning): TODO/FIXME/HACK without a difficulty-book or issue reference
#
# Severity model:
#   - UNSOURCED is always blocking (near-zero false-positive rate; matches explicit epistemic overreach).
#   - MAGIC_NUMBER / TODO_NO_REF are warnings by default. They block only when ZETETIC_PROFILE=strict.
#   - ZETETIC_PROFILE must be declared in .zetetic.conf (committed, auditable) — no silent env override.
#
# Exit codes: 0 clean, 1 violations found (errors in default; errors OR warnings in strict), 2 usage error.
#
# Rule provenance: enforces rules/coding-standards.md §8 (Zetetic Source Discipline).

set -euo pipefail

# ── Defaults ───────────────────────────────────────────────────────────
# Always skip: generated / lock / binary-ish files. The zetetic standard targets authored code.
ZETETIC_SKIP_PATHS_ALWAYS='Cargo\.lock$|package-lock\.json$|yarn\.lock$|pnpm-lock\.yaml$|poetry\.lock$|Gemfile\.lock$|composer\.lock$|target/|node_modules/|dist/|build/|\.git/|\.venv/|vendor/|\.sqlx/'
ZETETIC_SKIP_EXT_ALWAYS='\.(lock|svg|png|jpg|jpeg|gif|webp|pdf|min\.js|min\.css)$'

# Default-skip-but-configurable: data / config formats. Teams may re-enable via .zetetic.conf.
ZETETIC_SKIP_EXT_DEFAULT='\.(json|yaml|yml|toml|csv|sql|tsv|xml)$'

# Always process .md excluded (per original behavior — docs aren't algorithms).
ZETETIC_SKIP_EXT_DOCS='\.md$'

# Profile — must be declared in .zetetic.conf. No default; absence means "standard".
ZETETIC_PROFILE="${ZETETIC_PROFILE:-standard}"

# ── Project-local config ──────────────────────────────────────────────
# Only files/paths may be overridden by project config. Rule semantics (which checks exist) cannot be disabled.
load_project_config() {
  local repo_root; repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  for cfg in "$repo_root/.zetetic.conf" "$repo_root/.claude/zetetic.conf"; do
    if [[ -f "$cfg" ]]; then
      # Source in subshell first to detect forbidden rule overrides
      local forbidden
      forbidden=$(grep -E '^[[:space:]]*(DISABLE_UNSOURCED|DISABLE_MAGIC_NUMBER|DISABLE_TODO_NO_REF|SKIP_RULE|EXCLUDE_RULE)=' "$cfg" 2>/dev/null || true)
      if [[ -n "$forbidden" ]]; then
        echo "ERROR: $cfg contains forbidden rule-exclusion directive:" >&2
        echo "$forbidden" >&2
        echo "The zetetic-checker config may override file/path exclusions and ZETETIC_PROFILE only." >&2
        echo "Rules themselves (UNSOURCED, MAGIC_NUMBER, TODO_NO_REF) cannot be disabled." >&2
        exit 2
      fi
      # shellcheck disable=SC1090
      source "$cfg"
      return
    fi
  done
}
load_project_config

# Validate profile value
case "$ZETETIC_PROFILE" in
  strict|standard|permissive) ;;
  *) echo "ERROR: ZETETIC_PROFILE must be strict|standard|permissive (got: $ZETETIC_PROFILE)" >&2; exit 2 ;;
esac

# ── Argument parsing ───────────────────────────────────────────────────
MODE=""
FILES=()
if [[ "${1:-}" == "--staged" ]]; then
  MODE="staged"
elif [[ "${1:-}" == "--files" ]]; then
  MODE="files"; shift
  FILES=("$@")
elif [[ "${1:-}" == "--full" ]]; then
  MODE="full"
else
  sed -n '2,/^$/s/^# \?//p' "$0"
  exit 2
fi

# ── Should-skip decision ──────────────────────────────────────────────
should_skip_file() {
  local f="$1"
  # Always-skip paths
  [[ "$f" =~ $ZETETIC_SKIP_PATHS_ALWAYS ]] && return 0
  # Always-skip extensions (binaries, auto-generated)
  [[ "$f" =~ $ZETETIC_SKIP_EXT_ALWAYS ]] && return 0
  # Docs
  [[ "$f" =~ $ZETETIC_SKIP_EXT_DOCS ]] && return 0
  # Default-skip data/config — unless project re-enabled via .zetetic.conf
  if [[ "${ZETETIC_CHECK_DATA_FORMATS:-false}" != "true" ]]; then
    [[ "$f" =~ $ZETETIC_SKIP_EXT_DEFAULT ]] && return 0
  fi
  # Binary detection
  if [[ -f "$f" ]]; then
    file -b --mime-type "$f" 2>/dev/null | grep -q "^text/" || return 0
  fi
  return 1
}

# ── Collect files + lines ──────────────────────────────────────────────
# Produces tab-separated output: "<path>\t<line_num>\t<line_content>"
collect_lines_staged() {
  # Use -U0 to get only added lines with line numbers (preserves authorial responsibility)
  # Handle renamed files: --diff-filter includes R, and we re-scan the whole file's added side
  local file line_num
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    should_skip_file "$file" && continue
    # For each added line in the diff, extract the new line number
    # `git diff -U0` output: `@@ -a,b +c,d @@` then `+content`
    git diff --cached -U0 --diff-filter=ACMR -- "$file" 2>/dev/null | awk -v file="$file" '
      /^@@/ {
        # Parse +c,d — new starting line
        match($0, /\+[0-9]+/); new_line = substr($0, RSTART+1, RLENGTH-1) + 0
        next
      }
      /^\+/ && !/^\+\+\+/ {
        # Emit: file, new_line, line content (strip leading +)
        printf "%s\t%d\t%s\n", file, new_line, substr($0, 2)
        new_line++
      }
    '
  done < <(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null)
}

collect_lines_files() {
  local file line_num
  for file in "${FILES[@]}"; do
    [[ ! -f "$file" ]] && continue
    should_skip_file "$file" && continue
    line_num=0
    while IFS= read -r line; do
      line_num=$((line_num + 1))
      printf '%s\t%d\t%s\n' "$file" "$line_num" "$line"
    done < "$file"
  done
}

collect_lines_full() {
  local repo_root; repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  local file line_num
  while IFS= read -r file; do
    [[ -z "$file" ]] && continue
    should_skip_file "$file" && continue
    line_num=0
    while IFS= read -r line; do
      line_num=$((line_num + 1))
      printf '%s\t%d\t%s\n' "$file" "$line_num" "$line"
    done < "$repo_root/$file"
  done < <(cd "$repo_root" && git ls-files 2>/dev/null)
}

# ── Checks ─────────────────────────────────────────────────────────────
ERRORS=0
WARNINGS=0

check_line() {
  local file="$1" line_num="$2" line="$3"

  # UNSOURCED — absolute claims without citation. Always an error.
  if echo "$line" | grep -qiE '(#|//|/\*|\*|"|'"'"').*\b(always|never|obviously|clearly|everyone knows)\b' 2>/dev/null; then
    if ! echo "$line" | grep -qiE 'source:|ref:|see:|citation:|cite:' 2>/dev/null; then
      echo "UNSOURCED   (error)    $file:$line_num: $(echo "$line" | head -c 80)"
      ERRORS=$((ERRORS + 1))
    fi
  fi

  # MAGIC_NUMBER — floats with 3+ decimals (the canonical unsourced-literal smell).
  # Integer tuning params (batch_size=128, epochs=50) are NOT flagged — use review + naming conventions.
  if echo "$line" | grep -qE '[^a-zA-Z_0-9."]([0-9]+\.[0-9]{3,})' 2>/dev/null; then
    if ! echo "$line" | grep -qiE 'source:|ref:|#.*from|//.*from|version|test|assert|approx|expect|tolerance|epsilon|pi|tau|e_|ln|log' 2>/dev/null; then
      local severity="warn"
      [[ "$ZETETIC_PROFILE" == "strict" ]] && severity="error"
      echo "MAGIC_NUMBER ($severity)    $file:$line_num: $(echo "$line" | head -c 80)"
      if [[ "$severity" == "error" ]]; then
        ERRORS=$((ERRORS + 1))
      else
        WARNINGS=$((WARNINGS + 1))
      fi
    fi
  fi

  # TODO_NO_REF — TODO/FIXME/HACK without difficulty-book or issue reference.
  if echo "$line" | grep -qiE '\b(TODO|FIXME|HACK|XXX)\b' 2>/dev/null; then
    if ! echo "$line" | grep -qiE 'difficulty.book|DB#|db-entry|tracked|issue|#[0-9]|[A-Z]+-[0-9]+' 2>/dev/null; then
      local severity="warn"
      [[ "$ZETETIC_PROFILE" == "strict" ]] && severity="error"
      echo "TODO_NO_REF  ($severity)    $file:$line_num: $(echo "$line" | head -c 80)"
      if [[ "$severity" == "error" ]]; then
        ERRORS=$((ERRORS + 1))
      else
        WARNINGS=$((WARNINGS + 1))
      fi
    fi
  fi
}

# ── Project-local extension (optional) ────────────────────────────────
# If present, sourced before running checks. Extension scripts can add checks that increment
# ERRORS/WARNINGS. They cannot disable built-in checks (see load_project_config guard).
load_project_extension() {
  local repo_root; repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  for ext in "$repo_root/.zetetic-check.sh" "$repo_root/.claude/zetetic-check.sh"; do
    if [[ -f "$ext" ]]; then
      # shellcheck disable=SC1090
      source "$ext"
      return
    fi
  done
}
load_project_extension

# ── Main loop ──────────────────────────────────────────────────────────
case "$MODE" in
  staged) COLLECT=collect_lines_staged ;;
  files)  COLLECT=collect_lines_files ;;
  full)   COLLECT=collect_lines_full ;;
esac

while IFS=$'\t' read -r file line_num line; do
  [[ -z "$file" ]] && continue
  check_line "$file" "$line_num" "$line"
done < <($COLLECT)

# ── Summary ────────────────────────────────────────────────────────────
echo ""
echo "Profile: $ZETETIC_PROFILE  ($MODE mode)"
echo "Errors:   $ERRORS  (blocking)"
echo "Warnings: $WARNINGS  (informational — promoted to errors when profile=strict)"

if [[ "$ZETETIC_PROFILE" == "permissive" ]]; then
  # Permissive never blocks, but still reports.
  echo "PASSED (permissive): all findings are informational."
  exit 0
fi

if [[ $ERRORS -gt 0 ]]; then
  echo "FAILED: $ERRORS blocking violation(s)."
  [[ "$ZETETIC_PROFILE" == "strict" ]] && echo "       (MAGIC_NUMBER and TODO_NO_REF promoted to errors under strict profile.)"
  exit 1
fi

echo "PASSED: no blocking violations."
exit 0
