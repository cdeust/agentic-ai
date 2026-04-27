#!/usr/bin/env bash
# scripts/parity-dual-run.sh
#
# Phase 6 dual-run parity harness orchestrator.
#
# Discovers CORTEX_PYTHON_BIN, AI_ARCH_BIN, PRD_GEN_BIN from environment.
# Runs the three parity runners (cortex, codebase, prd).
# Aggregates one master ParityReport to stdout as JSON.
# Emits per-source summary lines to stderr.
# Exits 0 only when ALL fixtures match (or are shape_only / skipped).
#
# Usage:
#   # With all binaries available:
#   CORTEX_PYTHON_BIN=/path/to/python \
#   AI_ARCH_BIN=/path/to/ai-architect-mcp \
#   PRD_GEN_BIN=/path/to/prd-gen/dist/cli.js \
#   ./scripts/parity-dual-run.sh > reports/parity-$(date +%Y%m%dT%H%M%S).json
#
#   # Without binaries (stub-runner mode — validates well-formedness only):
#   ./scripts/parity-dual-run.sh
#
# Environment variables (all optional):
#   CORTEX_PYTHON_BIN   — path to Python interpreter with Cortex installed
#                         (e.g. /path/to/Cortex/.venv/bin/python)
#   AI_ARCH_BIN         — path to the ai-architect-mcp Rust binary
#   PRD_GEN_BIN         — path to the prd-spec-generator CLI entry point
#   PARITY_STRICT       — if set to "1", enable strictExtraKeys mode
#   PARITY_ADVERSARIAL  — if set to "1", enable adversarial probe generation
#   AGENTIC_REPO_ROOT   — root of the agentic-ai monorepo (default: script dir)
#
# source: mission brief §2 — "scripts/parity-dual-run.sh"
# source: PHASE_PLAN.md §"Phase 6" — "48-hour dual-run with zero divergence"

set -euo pipefail

# ── Resolve repo root ─────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${AGENTIC_REPO_ROOT:-"$(cd "${SCRIPT_DIR}/.." && pwd)"}"

# ── Log to stderr (stdout is reserved for the JSON report) ───────────────────

log() {
  echo "[parity-dual-run] $*" >&2
}

# ── Announce environment ──────────────────────────────────────────────────────

log "Starting Phase 6 dual-run parity harness"
log "Repo root: ${REPO_ROOT}"
log ""

if [[ -n "${CORTEX_PYTHON_BIN:-}" ]]; then
  log "CORTEX_PYTHON_BIN = ${CORTEX_PYTHON_BIN}"
else
  log "CORTEX_PYTHON_BIN not set — Cortex live Python run will be skipped"
fi

if [[ -n "${AI_ARCH_BIN:-}" ]]; then
  log "AI_ARCH_BIN = ${AI_ARCH_BIN}"
else
  log "AI_ARCH_BIN not set — Codebase/Rust live run will be skipped (stub-runner mode)"
fi

if [[ -n "${PRD_GEN_BIN:-}" ]]; then
  log "PRD_GEN_BIN = ${PRD_GEN_BIN}"
else
  log "PRD_GEN_BIN not set — PRD live run will be skipped (stub-runner mode)"
fi

STRICT_FLAG=""
if [[ "${PARITY_STRICT:-0}" == "1" ]]; then
  STRICT_FLAG="--strict-extra-keys"
  log "strictExtraKeys = true"
fi

ADVERSARIAL_FLAG=""
if [[ "${PARITY_ADVERSARIAL:-0}" == "1" ]]; then
  ADVERSARIAL_FLAG="--adversarial-probes"
  log "runAdversarialProbes = true"
fi

log ""

# ── Resolve the parity-runner CLI entry ──────────────────────────────────────
# Try dist/ (built) first; fall back to tsx for development.

RUNNER_DIST="${REPO_ROOT}/packages/parity-runner/dist/cli.js"
RUNNER_SRC="${REPO_ROOT}/packages/parity-runner/src/cli.ts"

if [[ -f "${RUNNER_DIST}" ]]; then
  RUNNER_CMD="node ${RUNNER_DIST}"
elif command -v tsx &>/dev/null && [[ -f "${RUNNER_SRC}" ]]; then
  RUNNER_CMD="tsx ${RUNNER_SRC}"
else
  log "ERROR: parity-runner not built and tsx not available."
  log "Run 'pnpm -F @agentic/parity-runner build' first, or install tsx."
  exit 1
fi

# ── Run the harness ───────────────────────────────────────────────────────────
# The CLI writes the JSON report to stdout and the summary to stderr.

log "Running parity harness..."
log ""

REPORT_JSON=$(
  AGENTIC_REPO_ROOT="${REPO_ROOT}" \
  CORTEX_PYTHON_BIN="${CORTEX_PYTHON_BIN:-}" \
  AI_ARCH_BIN="${AI_ARCH_BIN:-}" \
  PRD_GEN_BIN="${PRD_GEN_BIN:-}" \
    ${RUNNER_CMD} \
      --source all \
      --repo-root "${REPO_ROOT}" \
      ${STRICT_FLAG} \
      ${ADVERSARIAL_FLAG} \
    2>&1 1>/dev/null || true
  # Re-run with proper stdout separation:
  AGENTIC_REPO_ROOT="${REPO_ROOT}" \
  CORTEX_PYTHON_BIN="${CORTEX_PYTHON_BIN:-}" \
  AI_ARCH_BIN="${AI_ARCH_BIN:-}" \
  PRD_GEN_BIN="${PRD_GEN_BIN:-}" \
    ${RUNNER_CMD} \
      --source all \
      --repo-root "${REPO_ROOT}" \
      ${STRICT_FLAG} \
      ${ADVERSARIAL_FLAG}
)

# ── Print the JSON report to stdout ──────────────────────────────────────────

echo "${REPORT_JSON}"

# ── Extract exit_code from the JSON and exit accordingly ─────────────────────

EXIT_CODE=$(echo "${REPORT_JSON}" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('exit_code', 1))" 2>/dev/null || echo "1")

if [[ "${EXIT_CODE}" == "0" ]]; then
  log ""
  log "PASS — all fixture checks passed. exit_code=0."
  exit 0
else
  log ""
  log "FAIL — divergence(s) found. exit_code=1. See JSON report above for details."
  exit 1
fi
