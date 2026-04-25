#!/usr/bin/env bash
# welcome.sh — Zetetic Codespace welcome banner.
#
# This is NOT a help message.  It is a live demonstration:
#   1. The zetetic-checker runs on its own hook scripts.
#   2. The result is printed verbatim — findings and all.
#   3. Three ceiling-raising one-liners are shown at the end.
#
# Runs as postStartCommand.  Safe to re-run at any time.

set -euo pipefail

TEAL="\033[1;38;2;127;187;179m"
WHITE="\033[38;2;224;224;224m"
BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
NC="\033[0m"

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-/workspaces/zetetic-team-subagents}"
CHECKER="${PLUGIN_ROOT}/tools/zetetic-checker.sh"

hr() { echo -e "${TEAL}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }

hr
echo -e "  ${WHITE}${BOLD}ZETETIC — 116 agents  16 lifecycle hooks  one standard${NC}"
hr
echo ""
echo -e "  Auditing this dev container with its own claim-gate..."
echo ""

# Run zetetic-checker on the hook scripts themselves.
# Output is indented two spaces and printed verbatim so the user sees a
# real audit result, not a canned message.
if [[ -x "$CHECKER" ]]; then
  "$CHECKER" \
    "${PLUGIN_ROOT}/hooks/pre-commit-zetetic.sh" \
    "${PLUGIN_ROOT}/hooks/pre-tool-secret-shield.py" \
    "${PLUGIN_ROOT}/scripts/setup.sh" \
    2>&1 | sed 's/^/  /' || true
else
  echo -e "  ${YELLOW}[warn]${NC} zetetic-checker not found — run: bash scripts/setup.sh install"
fi

echo ""
hr
echo ""
echo -e "  ${GREEN}The commit gate is live.${NC}  Prove it:"
echo -e "  ${TEAL}  echo 'THRESHOLD = 0.837' > /tmp/test.py"
echo -e "    cd /tmp && git init -q && git add test.py"
echo -e "    git commit -m \"add threshold\"${NC}"
echo -e "  Expected: ${BOLD}BLOCKED — magic number, no source annotation${NC}"
echo ""
echo -e "  ${GREEN}Route any problem to 97 reasoning patterns:${NC}"
echo -e "  ${TEAL}  /genius route \"should this retry loop be memoized?\"${NC}"
echo ""
echo -e "  ${GREEN}Audit a real paper-code epsilon mismatch (Kingma & Ba 2015):${NC}"
echo -e "  ${TEAL}  /paper-vs-code-audit arxiv:1412.6980 /workspaces/demo-audit/${NC}"
echo ""
echo -e "  ${GREEN}Run a sourced multi-agent research loop:${NC}"
echo -e "  ${TEAL}  /autoresearch-loop \"effect of label smoothing on calibration in transformers\"${NC}"
echo ""
hr
echo ""
